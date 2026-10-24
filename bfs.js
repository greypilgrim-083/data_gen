// Single-file BFS dataset generation pipeline
// Flow per node: extractScenarios → generateConversation (per scenario) → extractSubtopics
// Visited-set deduplication happens in runBFS, not in the LLM prompts.

const { EXTRACTOR_PERSONAS, GENERATOR_PERSONAS } = require("./personas");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripReasoningAndMarkdown(text) {
  if (!text || typeof text !== "string") return "";
  // Strip reasoning models <think>...</think> tags (DeepSeek R1, QwQ, etc.)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Strip markdown code fences if wrapped in ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1];
  }
  return cleaned.trim();
}

function cleanJsonString(str) {
  return str
    // Remove trailing commas in arrays/objects: ,] or ,}
    .replace(/,\s*([\]}])/g, "$1")
    // Fix loose control characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, "");
}

function parseJsonArray(text) {
  const cleaned = stripReasoningAndMarkdown(text);
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    const candidate = cleanJsonString(match[0]);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fallback below
    }
  }

  // Fallback: extract list items by lines (e.g. "1. Scenario ...")
  const lines = cleaned.split("\n");
  const items = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const itemMatch = trimmed.match(/^(?:\d+[\.\)]|[-*•])\s*"?(.+?)"?$/);
    if (itemMatch && itemMatch[1] && itemMatch[1].length > 2) {
      items.push(itemMatch[1].replace(/^["']|["']$/g, "").trim());
    }
  }
  if (items.length > 0) return items;

  throw new Error("Failed to parse JSON array from LLM response");
}

function parseConversation(text) {
  const cleaned = stripReasoningAndMarkdown(text);
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(cleanJsonString(match[0]));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((msg) => ({
          role: (msg.role || msg.from || "").toLowerCase().includes("user") ||
                (msg.role || "").toLowerCase().includes("human")
            ? "user"
            : "assistant",
          content: msg.content || msg.value || msg.text || "",
        }));
      }
    } catch {
      // Fall through to regex-based fallback
    }
  }

  // Fallback: parse User / Assistant dialogue turns from text
  const regex = /(?:###\s*)?(?:User|Human|Student|Developer|Engineer|Assistant|AI|Tutor):\s*([\s\S]*?)(?=(?:###\s*)?(?:User|Human|Student|Developer|Engineer|Assistant|AI|Tutor):|$)/gi;
  const messages = [];
  let roleToggle = "user";
  let m;
  while ((m = regex.exec(cleaned)) !== null) {
    const content = m[1].trim();
    if (content) {
      messages.push({ role: roleToggle, content });
      roleToggle = roleToggle === "user" ? "assistant" : "user";
    }
  }
  if (messages.length >= 2) return messages;

  throw new Error("Failed to parse conversation dialogue from LLM response");
}

async function llm(messages, model, apiKey, retries = 3) {
  const cleanKey = (apiKey || "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!cleanKey) {
    throw new Error("OpenRouter API key is missing. Please provide your key in settings or set OPENROUTER_API_KEY in .env");
  }

  let attempt = 0;
  while (attempt <= retries) {
    try {
      console.log(`[API] -> Requesting ${model} (attempt ${attempt + 1}/${retries + 1}). Messages: ${messages.length}`);
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://datagen.local",
          "X-Title": "DataGen Synthetic Dataset Generator",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.8,
        }),
      });

      if (!res.ok) {
        let errBody = "";
        try {
          const errJson = await res.json();
          errBody = errJson?.error?.message || JSON.stringify(errJson);
        } catch {
          errBody = await res.text();
        }

        console.error(`[API ERROR] -> OpenRouter HTTP ${res.status}: ${errBody}`);

        // Immediate fail on non-retriable auth or billing errors
        if (res.status === 401) {
          throw new Error("OpenRouter Authentication Failed (401): Invalid API key.");
        }
        if (res.status === 402) {
          throw new Error("OpenRouter Payment Required (402): Insufficient account balance.");
        }
        if (res.status === 404) {
          throw new Error(`OpenRouter Model Not Found (404): "${model}" does not exist or is unavailable.`);
        }

        // Retriable statuses: 429 (rate-limit), 500, 502, 503, 504, 524
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10);
          const waitMs = (retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 2000) + Math.floor(Math.random() * 1000);
          console.warn(`[API WARN] Rate limit or server error (${res.status}). Retrying in ${waitMs}ms...`);
          await delay(waitMs);
          attempt++;
          continue;
        }

        throw new Error(`OpenRouter error (${res.status}): ${errBody}`);
      }

      const data = await res.json();
      if (!data.choices || !data.choices.length || !data.choices[0].message) {
        if (data.error) throw new Error(`OpenRouter API error: ${data.error.message || JSON.stringify(data.error)}`);
        throw new Error("OpenRouter returned empty response");
      }

      const choice = data.choices[0];
      const content = choice.message.content || choice.text || "";
      console.log(`[API] <- Response received from ${model}. Tokens: ${data.usage?.total_tokens || "unknown"}`);
      return content;
    } catch (err) {
      if (
        attempt >= retries ||
        err.message.includes("Authentication Failed") ||
        err.message.includes("Payment Required") ||
        err.message.includes("Model Not Found")
      ) {
        throw err;
      }
      attempt++;
      const waitMs = Math.pow(2, attempt) * 1500;
      console.warn(`[API WARN] Request failed (${err.message}). Retrying in ${waitMs}ms...`);
      await delay(waitMs);
    }
  }
}

async function extractScenarios(topic, model, apiKey, extractorPersonas) {
  const personasList = extractorPersonas.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  const content = await llm(
    [
      {
        role: "system",
        content: `You are a curriculum designer. Given a topic, generate exactly ${extractorPersonas.length} realistic, scenario-based problem statements.
Each scenario MUST be tailored to a specific user persona provided below. Ensure extreme diversity based on the persona's context.

Personas:
${personasList}

Return ONLY a JSON array of strings in the exact order of the personas. No explanation, no markdown.
Example: ["A bootcamp student needs to reverse a linked list...", ...]`,
      },
      { role: "user", content: `Topic: ${topic}` },
    ],
    model,
    apiKey
  );

  return parseJsonArray(content);
}

async function generateConversation(scenario, topic, model, apiKey, turns = 5, extPersona, genPersona) {
  const extSystem = extPersona.system.replace(/{subtopic}/g, topic);
  const genSystem = genPersona.system.replace(/{subtopic}/g, topic);

  const content = await llm(
    [
      {
        role: "system",
        content: `You are simulating a realistic conversation about "${topic}".
Generate a multi-turn dialogue of exactly ${turns} exchanges (user + assistant alternating).

USER PERSONA (The human asking questions):
${extSystem}

ASSISTANT PERSONA (The AI answering):
${genSystem}

Rules:
- The user must stay entirely within character.
- The assistant must stay entirely within character.
- Do NOT output generic ping-pong. Make it feel incredibly realistic.
Return ONLY a JSON array: [{"role":"user","content":"..."},{"role":"assistant","content":"..."},...]`,
      },
      { role: "user", content: `Scenario: ${scenario}` },
    ],
    model,
    apiKey
  );

  return parseConversation(content);
}

async function extractSubtopics(conversation, model, apiKey) {
  const conversationText = conversation
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const content = await llm(
    [
      {
        role: "system",
        content: `Extract 5 specific subtopics mentioned or implied in this conversation that would be worth exploring further.
Return ONLY a JSON array of short topic strings (2-5 words each). No explanation.
Example: ["binary search trees", "time complexity analysis"]`,
      },
      { role: "user", content: conversationText },
    ],
    model,
    apiKey
  );

  try {
    return parseJsonArray(content);
  } catch {
    return [];
  }
}

// Converts internal conversation format to ShareGPT
function toShareGPT(conversation, topic, depth) {
  return {
    conversations: conversation.map((m) => ({
      from: m.role === "user" ? "human" : "gpt",
      value: m.content,
    })),
    metadata: { topic, depth },
  };
}

// Async generator — yields event objects the route handler streams as SSE
async function* runBFS({
  topic,
  maxDepth = 2,
  maxNodes = 10,
  branchingFactor = 3,
  model,
  turns = 5,
  apiKey,
  assistantPersona,
  scenariosPerNode,
  onSample,
}) {
  const queue = [{ topic: topic || "unknown", depth: 0 }];
  const visited = new Set([(topic || "unknown").toLowerCase()]);
  const processedTopics = new Set();
  let totalSamples = 0;
  let processedCount = 0;
  const allSamples = [];

  // Determine scenarios per topic (default to 3-5 to keep OpenRouter fast and reliable)
  const countPerNode = scenariosPerNode
    ? Math.max(1, Math.min(10, scenariosPerNode))
    : Math.min(Math.max(branchingFactor, 3), 5);

  while (queue.length > 0 && processedCount < maxNodes) {
    const { topic: currentTopic, depth: currentDepth } = queue.shift();
    processedCount++;
    processedTopics.add(currentTopic);

    yield { event: "node_start", topic: currentTopic, depth: currentDepth, processedCount, maxNodes };

    // Select extractor personas for this node
    const nodeExtractors = [];
    for (let i = 0; i < countPerNode; i++) {
      nodeExtractors.push(EXTRACTOR_PERSONAS[Math.floor(Math.random() * EXTRACTOR_PERSONAS.length)]);
    }

    let scenarios = [];
    try {
      scenarios = await extractScenarios(currentTopic, model, apiKey, nodeExtractors);
    } catch (e) {
      console.warn(`[BFS WARN] Scenario extraction failed for "${currentTopic}": ${e.message}`);
      if (processedCount === 1) {
        // Fatal if root node fails completely
        yield { event: "error", message: `Scenario extraction failed for root topic "${currentTopic}": ${e.message}` };
        return allSamples;
      }
      yield { event: "warning", message: `Skipping topic "${currentTopic}": ${e.message}` };
      continue;
    }

    yield { event: "scenarios_ready", topic: currentTopic, count: scenarios.length };

    let allSubtopics = [];

    // Safely zip scenarios with the personas used to generate them
    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      const extPersona = nodeExtractors[i] || EXTRACTOR_PERSONAS[0];

      let genPersona;
      if (assistantPersona && assistantPersona !== "random") {
        genPersona = GENERATOR_PERSONAS.find((p) => p.name === assistantPersona) || GENERATOR_PERSONAS[0];
      } else {
        genPersona = GENERATOR_PERSONAS[Math.floor(Math.random() * GENERATOR_PERSONAS.length)];
      }

      let conversation;
      try {
        conversation = await generateConversation(scenario, currentTopic, model, apiKey, turns, extPersona, genPersona);
      } catch (e) {
        console.warn(`[BFS WARN] Conversation failed for "${currentTopic}" scenario #${i + 1}: ${e.message}`);
        yield { event: "scenario_skip", topic: currentTopic, message: `Skipped conversation: ${e.message}` };
        continue;
      }

      const sample = toShareGPT(conversation, currentTopic, currentDepth);
      if (onSample) await onSample(sample);
      allSamples.push(sample);
      totalSamples++;

      yield { event: "convo_generated", topic: currentTopic, turns: conversation.length, totalSamples };

      if (currentDepth < maxDepth && allSubtopics.length === 0) {
        try {
          const subtopics = await extractSubtopics(conversation, model, apiKey);
          allSubtopics.push(...subtopics);
        } catch {
          // subtopic extraction failure is non-fatal
        }
      }
    }

    // Dedup and filter subtopics through visited set here (not in the LLM)
    if (currentDepth < maxDepth) {
      const newSubtopics = [...new Set(allSubtopics)]
        .filter((t) => typeof t === "string" && t.trim() !== "")
        .filter((t) => !visited.has(t.toLowerCase()))
        .slice(0, branchingFactor);

      for (const sub of newSubtopics) {
        visited.add(sub.toLowerCase());
        queue.push({ topic: sub, depth: currentDepth + 1 });
      }

      if (newSubtopics.length > 0) {
        yield { event: "subtopics_found", topic: currentTopic, subtopics: newSubtopics };
      }
    }

    yield { event: "node_done", topic: currentTopic, samplesAdded: scenarios.length };
  }

  yield { event: "job_complete", totalSamples, topicsCovered: [...processedTopics] };
  return allSamples;
}

module.exports = { runBFS, llm };
