import json
import itertools
import re
import random
from collections import deque
from openai import OpenAI
from personas import GENERATOR_PERSONAS, EXTRACTOR_PERSONAS
from bson import ObjectId
import os
from dotenv import load_dotenv

load_dotenv()

MODEL = "llama-3.3-70b-versatile"

# Load keys from env or fallback to empty
api_keys_str = os.getenv("GROQ_API_KEYS", "")
API_KEYS = [k.strip() for k in api_keys_str.split(",") if k.strip()]
if not API_KEYS:
    print("Warning: GROQ_API_KEYS not found in environment!")
    API_KEYS = ["dummy_key"]

import time

_clients = [
    OpenAI(base_url="https://api.groq.com/openai/v1", api_key=key)
    for key in API_KEYS
]
_client_cycle = itertools.cycle(_clients)

def call_api(**kwargs) -> str:
    """Call the API, cycling keys. If a key fails, try the next one immediately. 
    If ALL keys fail in a row, then apply exponential backoff and retry."""
    delays = [5, 15, 30, 60, 120]
    num_keys = len(_clients)
    
    for attempt, delay in enumerate(delays + [None]):
        # Try every available key once before backing off
        for _ in range(num_keys):
            try:
                client = next(_client_cycle)
                return client.chat.completions.create(**kwargs).choices[0].message.content
            except Exception as e:
                # Key failed (likely 429), immediately try the next key in the cycle
                print(f"[API Warning] Key failed: {e}")
                continue
                
        # If we get here, EVERY key failed in a row. Now we sleep.
        if delay is None:
            raise Exception("All API keys are rate limited or invalid, and all retry attempts failed.")
        
        print(f"[API Exhausted attempt {attempt+1}] All keys currently rate limited — backing off for {delay}s")
        time.sleep(delay)


def strip_followup(text):
    if not text: return ""
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
        return {"conversations": [{"from": role_map.get(m["role"], m["role"]), "value": m["content"]} for m in messages]}
    if fmt == "alpaca":
        instruction = next((m["content"] for m in messages if m["role"] == "user"), "")
        output = next((m["content"] for m in messages if m["role"] == "assistant"), "")
        return {"instruction": instruction, "input": "", "output": output}
    return {"messages": messages}


def run_generation(config: dict, tasks: dict, task_id: str, records_col=None, datasets_col=None):
    MASTER_TOPIC = config["topic"]
    OUTPUT_FMT = config.get("output_format", "openai")
    MAX_OUTPUTS = config.get("max_outputs", 10)
    dataset_type = config.get("dataset_type", "multi_turn")
    user_id = tasks[task_id].get("userId")
    dataset_id = tasks[task_id].get("datasetId")

    def update(state=None, progress=None, topic=None):
        if state is not None: tasks[task_id]["state"] = state
        if progress is not None: tasks[task_id]["progress"] = progress
        if topic is not None: tasks[task_id]["topic"] = topic

    queue = deque([MASTER_TOPIC])
    vis = set([MASTER_TOPIC.lower()])
    done = 0

    while queue:
        if MAX_OUTPUTS > 0 and done >= MAX_OUTPUTS:
            break

        subtopic = queue.popleft()
        full_topic = MASTER_TOPIC if subtopic == MASTER_TOPIC else f"{MASTER_TOPIC} {subtopic}"
        update(topic=full_topic)

        generator_persona = random.choice(GENERATOR_PERSONAS)
        extractor_persona = random.choice(EXTRACTOR_PERSONAS)

        generator_system = generator_persona["system"].format(subtopic=full_topic)
        extractor_system = (
            extractor_persona["system"].format(subtopic=full_topic)
            + "\n\nCRITICAL: You are the USER in this conversation, not the assistant. Never generate code solutions, explanations, or follow-up offers. Only ask questions or respond as a user would."
        )

        extractor_output = call_api(
            messages=[{"role": "system", "content": extractor_system},
                      {"role": "user", "content": f"Initiate the {full_topic} scenario based on your persona."}],
            model=MODEL, max_tokens=1024, temperature=extractor_persona["temperature"]
        )

        extractor_output = strip_followup(extractor_output)
        if not extractor_output:
            continue

        final_dataset_history = [{"role": "user", "content": extractor_output}]
        api_messages = [
            {"role": "system", "content": generator_system},
            {"role": "user", "content": extractor_output}
        ]
        success = False

        for turn in range(10):
            window = api_messages[-4:] if len(api_messages) > 4 else api_messages[1:]
            if window and window[0]["role"] == "assistant": window = window[1:]
            gen_history = [api_messages[0]] + window

            gen_response = call_api(
                messages=gen_history, model=MODEL,
                max_tokens=1500, temperature=generator_persona["temperature"]
            )

            if not gen_response:
                break
            gen_response = strip_followup(gen_response)

            # Keyword extraction for BFS queue expansion
            kw_raw = call_api(
                messages=[
                    {"role": "system", "content": "Respond ONLY with a valid JSON array of strings. No markdown, no explanation."},
                    {"role": "user", "content": f"Extract technical keywords from this text related to {full_topic} that could each be a standalone chapter. Return as JSON array.\n\n{gen_response}"}
                ],
                model=MODEL, max_tokens=256, temperature=0.1
            )

            if kw_raw:
                try:
                    kws = json.loads(kw_raw.replace("```json", "").replace("```", "").strip())
                    if isinstance(kws, list):
                        for kw in kws:
                            if isinstance(kw, str) and kw.lower() not in vis:
                                queue.append(kw)
                                vis.add(kw.lower())
                except:
                    pass

            final_dataset_history.append({"role": "assistant", "content": gen_response})
            api_messages.append({"role": "assistant", "content": gen_response})

            if dataset_type == "single_turn":
                success = True
                break

            clean_history = [m for m in api_messages if m["role"] != "system"]
            initial_scenario = clean_history[0]
            recent = clean_history[-4:] if len(clean_history) > 4 else clean_history[1:]
            if recent and recent[0]["role"] == "user": recent = recent[1:]

            ext_msgs = [{"role": "system", "content": extractor_system}, initial_scenario] + recent
            if turn >= 8:
                ext_msgs.append({"role": "system", "content": "Time is up. Conclude and append TERMINATE."})

            ext_response = call_api(
                messages=ext_msgs, model=MODEL, max_tokens=1024
            )

            if not ext_response:
                break
            ext_response = strip_followup(ext_response)

            if "terminate" in ext_response.lower():
                success = True
                break

            final_dataset_history.append({"role": "user", "content": ext_response})
            api_messages.append({"role": "user", "content": ext_response})

        if success:
            record = parse(OUTPUT_FMT, final_dataset_history)
            done += 1
            update(progress=done)

            if user_id and dataset_id and records_col is not None:
                records_col.insert_one({"datasetId": dataset_id, "record": record})
            else:
                tasks[task_id]["records"].append(record)

    update(state="done", progress=done)
    if user_id and dataset_id and datasets_col is not None:
        datasets_col.update_one(
            {"_id": ObjectId(dataset_id)},
            {"$set": {"totalRecords": done, "status": "completed"}}
        )
