// Single-file BFS dataset generation pipeline
// Flow per node: extractScenarios → generateConversation (per scenario) → extractSubtopics
// Visited-set deduplication happens in runBFS, not in the LLM prompts.

const { EXTRACTOR_PERSONAS, GENERATOR_PERSONAS } = require("./personas");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function llm(messages, model, apiKey) {
  console.log(`[API] -> Requesting ${model}. Messages snippet: ${JSON.stringify(messages).substring(0, 80)}...`);
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.replace(/[^\x20-\x7E]/g, "").trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0.8 }),
  });
  
  if (!res.ok) {
    const err = await res.text();
    console.error(`[API ERROR] -> OpenRouter responded with ${res.status}: ${err}`);
    throw new Error(`OpenRouter error: ${err}`);
  }
  
  const data = await res.json();
  console.log(`[API] <- Response received from ${model}. Tokens: ${data.usage?.total_tokens || 'unknown'}`);
  return data.choices[0].message.content;
}

async function extractScenarios(topic, model, apiKey, extractorPersonas) {
  const personasList = extractorPersonas.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
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
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Failed to parse scenarios JSON");
  return JSON.parse(match[0]);
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
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Failed to parse conversation JSON");
  return JSON.parse(match[0]);
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
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
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
async function* runBFS({ topic, maxDepth, maxNodes, branchingFactor, model, turns, apiKey, assistantPersona, onSample }) {
  const queue = [{ topic: topic || "unknown", depth: 0 }];
  const visited = new Set([(topic || "unknown").toLowerCase()]);
  const processedTopics = new Set();
  let totalSamples = 0;
  let processedCount = 0;
  const allSamples = [];

  while (queue.length > 0 && processedCount < maxNodes) {
    const { topic: currentTopic, depth: currentDepth } = queue.shift();
    processedCount++;
    processedTopics.add(currentTopic);

    yield { event: "node_start", topic: currentTopic, depth: currentDepth };

    // Select 10 random extractor personas for this node
    const nodeExtractors = [];
    for (let i = 0; i < 10; i++) {
      nodeExtractors.push(EXTRACTOR_PERSONAS[Math.floor(Math.random() * EXTRACTOR_PERSONAS.length)]);
    }

    let scenarios;
    try {
      scenarios = await extractScenarios(currentTopic, model, apiKey, nodeExtractors);
    } catch (e) {
      yield { event: "error", message: `Scenario extraction failed for "${currentTopic}": ${e.message}` };
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
        genPersona = GENERATOR_PERSONAS.find(p => p.name === assistantPersona) || GENERATOR_PERSONAS[0];
      } else {
        genPersona = GENERATOR_PERSONAS[Math.floor(Math.random() * GENERATOR_PERSONAS.length)];
      }

      let conversation;
      try {
        conversation = await generateConversation(scenario, currentTopic, model, apiKey, turns, extPersona, genPersona);
      } catch (e) {
        yield { event: "error", message: `Conversation generation failed: ${e.message}` };
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

module.exports = { runBFS };
