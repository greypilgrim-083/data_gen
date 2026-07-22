import os
import json
import itertools
import re
import random
from collections import deque
import time
import urllib.request
import urllib.error
import sys

from groq import Groq

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from personas import GENERATOR_PERSONAS, EXTRACTOR_PERSONAS

# ── Load config ───────────────────────────────────────────────────────────────

with open("bfs_config.json", "r") as f:
    config = json.load(f)

API_KEYS = config["api_keys"]
MASTER_TOPIC = config["topic"]
NUM_SEED = config["num_seed"]
OUTPUT_FILE = config["output_file"]
OUTPUT_FMT = config["output_format"]
MAX_OUTPUTS = config["max_outputs"]
NODE_URL = "http://localhost:3000"

MODEL = "llama-3.3-70b-versatile"

key_cycle = itertools.cycle(API_KEYS)

def make_client():
    time.sleep(2)
    return Groq(api_key=next(key_cycle))

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
        pass

def strip_followup(text):
    patterns = r'(let me know|would you like|feel free|do you want|shall i|should i|want me to|if you(?:\'d| would) like|any questions)'
    lines = text.rstrip().split('\n')
    while lines:
        last_line = lines[-1].strip()
        if not last_line or re.search(patterns, last_line, re.IGNORECASE):
            lines.pop()
        else:
            break
    return '\n'.join(lines).strip()

def parse(fmt, messages):
    if fmt == "sharegpt":
        role_map = {"user": "human", "assistant": "gpt", "system": "system"}
        convos = [{"from": role_map.get(m["role"], m["role"]), "value": m["content"]} for m in messages]
        return {"conversations": convos}
    if fmt == "alpaca":
        instruction = next((m["content"] for m in messages if m["role"] == "user"), "")
        output      = next((m["content"] for m in messages if m["role"] == "assistant"), "")
        return {"instruction": instruction, "input": "", "output": output}
    return {"messages": messages}

# --- AUTO-SEEDING THE QUEUE ---
seeder_prompt = f"List {NUM_SEED} subtopics within '{MASTER_TOPIC}'. Return ONLY a valid JSON list of strings. No markdown, no backticks."
try:
    raw_topics = make_client().chat.completions.create(
        messages=[{"role": "user", "content": seeder_prompt}],
        model=MODEL,
        max_tokens=2048,
        temperature=0.7
    ).choices[0].message.content

    raw_topics = re.sub(r'<think>.*?</think>', '', raw_topics, flags=re.DOTALL).strip()
    clean_json = raw_topics.replace("```json", "").replace("```", "").strip()
    generated_topics = json.loads(clean_json)
except Exception as e:
    print(f"Error seeding: {e}")
    generated_topics = [MASTER_TOPIC] # fallback

queue = deque(generated_topics)
vis = set()
done = 0

# --- MAIN GENERATION LOOP ---
while queue:
    if MAX_OUTPUTS > 0 and done >= MAX_OUTPUTS:
        break

    subtopic = queue.popleft()
    full_topic = MASTER_TOPIC + " " + subtopic
    send({"type": "topic_start", "topic": full_topic})

    generator_persona = random.choice(GENERATOR_PERSONAS)
    extractor_persona = random.choice(EXTRACTOR_PERSONAS)

    generator_system = "/no_think " + generator_persona["system"].format(subtopic=full_topic)
    extractor_system = "/no_think " + extractor_persona["system"].format(subtopic=full_topic)
    extractor_system += "\n\nCRITICAL: You are the USER in this conversation, not the assistant. Never generate code solutions, explanations, or follow-up offers. Only ask questions or respond as a user would."

    temperature_ext = extractor_persona["temperature"]
    temperature_gen = generator_persona["temperature"]

    try:
        extractor_output = make_client().chat.completions.create(
            messages=[{"role": "system", "content": extractor_system},
                      {"role": "user", "content": f"Initiate the {full_topic} scenario based on your persona."}],
            model=MODEL,
            max_tokens=1024, temperature=temperature_ext
        ).choices[0].message.content
    except Exception as e:
        print(f"Error starting extractor: {e}")
        continue

    clean_extractor_output = re.sub(r'<think>.*?</think>', '', extractor_output, flags=re.DOTALL).strip()

    final_dataset_history = [{"role": "user", "content": clean_extractor_output}]
    api_messages = [
        {"role": "system", "content": generator_system},
        {"role": "user", "content": clean_extractor_output}
    ]

    success = False

    for turn in range(10):
        window = api_messages[-4:] if len(api_messages) > 4 else api_messages[1:]
        if window and window[0]["role"] == "assistant": window = window[1:]
        gen_history = [api_messages[0]] + window

        max_retries = 3
        gen_response = None
        for attempt in range(max_retries):
            try:
                gen_response = make_client().chat.completions.create(
                    messages=gen_history,
                    model=MODEL,
                    max_tokens=1500,
                    temperature=temperature_gen
                ).choices[0].message.content
                break
            except Exception as e:
                print(f"Error in generator turn: {e}")
                if attempt == max_retries - 1:
                    break
                time.sleep(5)

        if not gen_response:
            break

        clean_gen_response = re.sub(r'<think>.*?</think>', '', gen_response, flags=re.DOTALL).strip()
        clean_gen_response = strip_followup(clean_gen_response)

        # Keyword extraction for BFS queue expansion
        try:
            nnodes_response = make_client().chat.completions.create(
                messages=[
                    {"role": "system", "content": "You are a data extraction assistant. You must respond ONLY with a valid JSON array of strings. Do not include markdown blocks, explanations, or any other text."},
                    {"role": "user", "content": f"Extract all the technical keywords related to {full_topic} which can be a chapter in itself in the given conversation below. Return them as a JSON array like [\"keyword1\", \"keyword2\"].\n\n{clean_gen_response}"}
                ],
                model=MODEL,
                max_tokens=1500,
                temperature=0.1
            ).choices[0].message.content
            
            clean_nnodes = re.sub(r'<think>.*?</think>', '', nnodes_response, flags=re.DOTALL).strip()
            clean_nnodes = clean_nnodes.replace("```json", "").replace("```", "").strip()
            nnodes = json.loads(clean_nnodes)
            for keyword in nnodes:
                if keyword.lower() not in vis:
                    queue.append(keyword)
                    vis.add(keyword.lower())
        except Exception as e:
            print(f"Error extracting keywords: {e}")

        final_dataset_history.append({"role": "assistant", "content": clean_gen_response})
        api_messages.append({"role": "assistant", "content": clean_gen_response})

        if config.get("dataset_type") == "single_turn":
            success = True
            break

        clean_history = [m for m in api_messages if m["role"] != "system"]
        initial_scenario = clean_history[0]
        recent_conversation = clean_history[-4:] if len(clean_history) > 4 else clean_history[1:]
        if recent_conversation and recent_conversation[0]["role"] == "user": recent_conversation = recent_conversation[1:]

        extractor_messages = (
            [{"role": "system", "content": extractor_system}]
            + [initial_scenario]
            + recent_conversation
        )

        if turn >= 8:
            extractor_messages.append({
                "role": "system",
                "content": "CRITICAL SYSTEM OVERRIDE: Time is up. You MUST conclude the scenario entirely within this single response. Give your final thought, and then append the exact tag TERMINATE. Do not wait for a reply."
            })

        try:
            ext_response = make_client().chat.completions.create(
                messages=extractor_messages,
                model=MODEL,
                max_tokens=1024
            ).choices[0].message.content
        except Exception as e:
            print(f"Error in extractor turn: {e}")
            break

        clean_ext_response = strip_followup(re.sub(r'<think>.*?</think>', '', ext_response, flags=re.DOTALL).strip())

        if "terminate" in clean_ext_response.lower() or "TERMINATE" in clean_ext_response:
            success = True
            break

        final_dataset_history.append({"role": "user", "content": clean_ext_response})
        api_messages.append({"role": "user", "content": clean_ext_response})

    if success:
        record = parse(OUTPUT_FMT, final_dataset_history)
        with open(OUTPUT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        done += 1
        send({"type": "record_added", "total": done})

send({"type": "done"})
