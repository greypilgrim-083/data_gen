from groq import Groq
from collections import deque
import itertools
import re
import json
import time
import random
import urllib.request
import urllib.error
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from personas import GENERATOR_PERSONAS, EXTRACTOR_PERSONAS


# ── Load config written by Node.js before spawning this script ────────────────

with open("bfs_config.json", "r") as f:
    config = json.load(f)

API_KEYS     = config["api_keys"]
TOPIC        = config["topic"]
NUM_SEED     = config["num_seed"]
OUTPUT_FILE  = config["output_file"]
OUTPUT_FMT   = config["output_format"]   # openai | sharegpt | alpaca
MAX_OUTPUTS  = config["max_outputs"]     # 0 = unlimited
MAX_DEPTH    = config["max_depth"]
MODEL        = "groq/compound"
NODE_URL     = "http://localhost:3000"

key_cycle = itertools.cycle(API_KEYS)


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_client():
    time.sleep(1)
    return Groq(api_key=next(key_cycle))


def strip_think(text):
    return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()


def send(msg):
    """Post a log message or status dict to the Node.js server."""
    payload = json.dumps({"message": msg}).encode()
    req = urllib.request.Request(
        f"{NODE_URL}/log",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=3)
    except urllib.error.URLError:
        pass  # don't crash if node is temporarily busy


def parse(fmt, messages):
    """
    messages is a list of OpenAI-format dicts: [{role, content}, ...]
    Convert to the requested output format and return a dict ready for JSONL.
    """
    if fmt == "sharegpt":
        role_map = {"user": "human", "assistant": "gpt", "system": "system"}
        convos = [{"from": role_map.get(m["role"], m["role"]), "value": m["content"]} for m in messages]
        return {"conversations": convos}

    if fmt == "alpaca":
        instruction = next((m["content"] for m in messages if m["role"] == "user"), "")
        output      = next((m["content"] for m in messages if m["role"] == "assistant"), "")
        return {"instruction": instruction, "input": "", "output": output}

    # default: openai / chatml
    return {"messages": messages}


# ── Seed the BFS queue ────────────────────────────────────────────────────────

send(f"Seeding {NUM_SEED} subtopics for '{TOPIC}'...")

raw_seed = make_client().chat.completions.create(
    messages=[{"role": "user", "content": f"List {NUM_SEED} subtopics within '{TOPIC}'. Return ONLY a valid JSON array of strings. No markdown."}],
    model=MODEL,
    max_tokens=2048,
    temperature=0.7,
).choices[0].message.content

clean_seed = strip_think(raw_seed).replace("```json", "").replace("```", "").strip()
seeds = json.loads(clean_seed)
send(f"Got {len(seeds)} seed topics: {seeds[:4]}...")

# Queue stores (subtopic, depth) tuples — seeds start at depth 0
queue   = deque((s, 0) for s in seeds)
visited = set(s.lower() for s in seeds)
done    = 0


# ── BFS loop (very close to datagen_manual.py) ────────────────────────────────

while queue:

    if MAX_OUTPUTS > 0 and done >= MAX_OUTPUTS:
        send(f"Output limit ({MAX_OUTPUTS}) reached. Stopping.")
        break

    subtopic, depth = queue.popleft()
    full_topic = TOPIC + " " + subtopic

    send({"type": "topic_start", "topic": TOPIC, "subtopic": subtopic, "depth": depth})
    send({"type": "status", "current_topic": full_topic, "queue_size": len(queue), "done": done, "depth": depth})

    gen_persona = random.choice(GENERATOR_PERSONAS)
    ext_persona = random.choice(EXTRACTOR_PERSONAS)

    GENERATOR_SYSTEM = "/no_think " + gen_persona["system"].format(subtopic=full_topic)
    EXTRACTOR_SYSTEM = (
        "/no_think " + ext_persona["system"].format(subtopic=full_topic)
        + "\n\nCRITICAL: You are the USER. Never generate solutions. Only ask questions."
    )

    send(f"Personas: gen={gen_persona['name']}, ext={ext_persona['name']}")

    # -- Initial extractor message --
    extractor_output = make_client().chat.completions.create(
        messages=[
            {"role": "system", "content": EXTRACTOR_SYSTEM},
            {"role": "user",   "content": f"Initiate the {full_topic} scenario."},
        ],
        model=MODEL, max_tokens=1024, temperature=ext_persona["temperature"],
    ).choices[0].message.content

    extractor_output = strip_think(extractor_output)
    send({"type": "message", "role": "user", "content": extractor_output})

    # history is in OpenAI format throughout
    history = [{"role": "user", "content": extractor_output}]

    t = 10
    while t > 0:
        t -= 1

        # -- Generator turn --
        gen_messages = [{"role": "system", "content": GENERATOR_SYSTEM}] + history[-4:]
        generator_output = make_client().chat.completions.create(
            messages=gen_messages,
            model=MODEL, max_tokens=1500, temperature=gen_persona["temperature"],
        ).choices[0].message.content

        generator_output = strip_think(generator_output)
        history.append({"role": "assistant", "content": generator_output})
        send({"type": "message", "role": "assistant", "content": generator_output})

        # -- BFS expansion: extract keywords from generator output --
        if depth < MAX_DEPTH:
            kw_raw = make_client().chat.completions.create(
                messages=[
                    {"role": "system", "content": "Respond ONLY with a valid JSON array of strings. No explanation."},
                    {"role": "user",   "content": f"Extract technical keywords from the text below that could each be a standalone chapter on '{full_topic}'. Return as JSON array.\n\n{generator_output}"},
                ],
                model=MODEL, max_tokens=512, temperature=0.1,
            ).choices[0].message.content

            kw_clean = strip_think(kw_raw).replace("```json", "").replace("```", "").strip()
            try:
                keywords = json.loads(kw_clean)
                added = 0
                for kw in keywords:
                    if kw.lower() not in visited:
                        visited.add(kw.lower())
                        queue.append((kw, depth + 1))
                        added += 1
                if added:
                    send(f"BFS +{added} nodes at depth {depth+1} → queue size {len(queue)}")
                    send({"type": "queue_update", "items": [{"topic": t, "depth": d} for t, d in queue]})
            except json.JSONDecodeError:
                pass
        else:
            send(f"Max depth ({MAX_DEPTH}) reached — not expanding.")

        # -- Extractor follow-up --
        ext_messages = [{"role": "system", "content": EXTRACTOR_SYSTEM}] + history[-4:]
        extractor_output = make_client().chat.completions.create(
            messages=ext_messages,
            model=MODEL, max_tokens=1024, temperature=ext_persona["temperature"],
        ).choices[0].message.content

        extractor_output = strip_think(extractor_output)
        send({"type": "message", "role": "user", "content": extractor_output})
        history.append({"role": "user", "content": extractor_output})

        if "TERMINATE" in extractor_output:
            send(f"TERMINATE — saving record for '{full_topic}'")

            # history is OpenAI format → parse converts to requested format
            record = parse(OUTPUT_FMT, history)

            with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")

            done += 1
            send({"type": "record", "data": record, "topic": full_topic})
            break

send(f"Generation complete. Saved={done}")
send({"type": "done"})
