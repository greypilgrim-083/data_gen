import os
import json
import itertools
import re
import random
from groq import Groq
from collections import deque
from personas import GENERATOR_PERSONAS, EXTRACTOR_PERSONAS
import time
API_KEYS=[]
# uncomment this
# API_KEYS = [
#     "YOUR_GROQ_API_KEY_1",
#     "YOUR_GROQ_API_KEY_2",
# ]

key_cycle = itertools.cycle(API_KEYS)

def make_client():
    time.sleep(2)
    return Groq(api_key=next(key_cycle))

def strip_followup(text):
    """Strip trailing follow-up question lines from generator responses."""
    patterns = r'(let me know|would you like|feel free|do you want|shall i|should i|want me to|if you(?:\'d| would) like|any questions)'
    lines = text.rstrip().split('\n')
    
    while lines:
        # Check the last line, ignoring trailing whitespace
        last_line = lines[-1].strip()
        
        # Pop empty lines or lines matching the follow-up pattern
        if not last_line or re.search(patterns, last_line, re.IGNORECASE):
            lines.pop()
        else:
            # Stop as soon as we hit standard text
            break
            
    return '\n'.join(lines).strip()

MODEL = "qwen/qwen3-32b"
MASTER_TOPIC = "typescript"
NUM_TOPICS_TO_GENERATE = 20
output_file = "agent_dynamic_data.jsonl"

# --- AUTO-SEEDING THE QUEUE ---
print(f"Auto-generating {NUM_TOPICS_TO_GENERATE} subtopics for: {MASTER_TOPIC}...")
seeder_prompt = f"List {NUM_TOPICS_TO_GENERATE} subtopics within '{MASTER_TOPIC}'. Return ONLY a valid JSON list of strings. No markdown, no backticks."
raw_topics = make_client().chat.completions.create(
    messages=[{"role": "user", "content": seeder_prompt}],
    model=MODEL,
    max_tokens=2048,
    temperature=0.7
).choices[0].message.content

raw_topics = re.sub(r'<think>.*?</think>', '', raw_topics, flags=re.DOTALL).strip()
clean_json = raw_topics.replace("```json", "").replace("```", "").strip()
print(clean_json)
generated_topics = json.loads(clean_json)
queue = deque(generated_topics)
print(f"Queue loaded successfully: {len(queue)} topics.")

vis = set()

# --- MAIN GENERATION LOOP ---
while queue:
    subtopic = queue.popleft()

    subtopic=MASTER_TOPIC+" "+ subtopic
    print(f"\n{'='*60}")
    print(f"--- Generating Data for: {subtopic} ---")
    print(f"{'='*60}")

    generator_persona = random.choice(GENERATOR_PERSONAS)
    extractor_persona = random.choice(EXTRACTOR_PERSONAS)

    generator_system = "/no_think " + generator_persona["system"].format(subtopic=subtopic)
    extractor_system = "/no_think " + extractor_persona["system"].format(subtopic=subtopic)
    # Fix: inject role reminder here alongside /no_think
    extractor_system += "\n\nCRITICAL: You are the USER in this conversation, not the assistant. Never generate code solutions, explanations, or follow-up offers. Only ask questions or respond as a user would."

    temperature_ext = extractor_persona["temperature"]
    temperature_gen = generator_persona["temperature"]

    try:
        extractor_output = make_client().chat.completions.create(
            messages=[{"role": "system", "content": extractor_system},
                      {"role": "user", "content": f"Initiate the {subtopic} scenario based on your persona."}],
            model=MODEL,
            max_tokens=1024, temperature=temperature_ext
        ).choices[0].message.content
    except Exception as e:
        print(f"Error starting {subtopic}: {e}")
        continue

    clean_extractor_output = re.sub(r'<think>.*?</think>', '', extractor_output, flags=re.DOTALL).strip()

    print(f"\n[Initial Extractor/User Scenario]:\n{clean_extractor_output}\n{'-'*50}")

    final_dataset_history = [{"role": "user", "content": clean_extractor_output}]
    api_messages = [
        {"role": "system", "content": generator_system},
        {"role": "user", "content": clean_extractor_output}
    ]

    success = False

    for turn in range(10):

        # Bug 1 fix: ensure generator window always starts with a user message
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
                print(f"API Error on Generator turn (Attempt {attempt+1}/{max_retries}): {e}")
                if attempt == max_retries - 1:
                    break
                time.sleep(20)

        if not gen_response:
            print("Generator failed after multiple attempts. Breaking loop.")
            break

        clean_gen_response = re.sub(r'<think>.*?</think>', '', gen_response, flags=re.DOTALL).strip()
        clean_gen_response = strip_followup(clean_gen_response)  # Strip trailing follow-up questions

        print(f"\n[Generator/Assistant Turn {turn + 1}]:\n{clean_gen_response}\n{'-'*50}")

        # Keyword extraction for BFS queue expansion




        #######################################################################33
        try:
            nnodes_response = make_client().chat.completions.create(
                messages=[
                    {"role": "system", "content": "You are a data extraction assistant. You must respond ONLY with a valid JSON array of strings. Do not include markdown blocks, explanations, or any other text."},
                    {"role": "user", "content": f"Extract all the technical keywords related to {subtopic} which can be a chapter in itself in the given conversation below. Return them as a JSON array like [\"keyword1\", \"keyword2\"].\n\n{clean_gen_response}"}
                ],
                model=MODEL,
                max_tokens=1500,
                temperature=0.1
            ).choices[0].message.content
        except Exception as e:
            print(f"API Error on Keyword Extraction: {e}")
            nnodes_response = "[]"

        # Clean the response
        clean_nnodes = re.sub(r'<think>.*?</think>', '', nnodes_response, flags=re.DOTALL).strip()
        clean_nnodes = clean_nnodes.replace("```json", "").replace("```", "").strip()
        
        # DEBUG: Print the raw output before parsing so you can see what the model actually gave you
        print(f"DEBUG - Raw model output to parse: {repr(clean_nnodes)}")

        try:
            nnodes = json.loads(clean_nnodes)
        except json.JSONDecodeError as e:
            print(f"JSON Parse Error: {e} - The model did not return valid JSON.")
            nnodes = []

        # Process the keywords
        for keyword in nnodes:
            if keyword.lower() not in vis:
                queue.append(keyword)
                vis.add(keyword.lower())
        print(queue, "333333333333333333333333333333333333333333333333333333333")






        final_dataset_history.append({"role": "assistant", "content": clean_gen_response})
        api_messages.append({"role": "assistant", "content": clean_gen_response})

        # Bug 2 fix: ensure extractor window starts with an assistant message (no consecutive users)
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
            print(f"API Error on Extractor turn: {e}")
            break

        clean_ext_response = strip_followup(re.sub(r'<think>.*?</think>', '', ext_response, flags=re.DOTALL).strip())

        print(f"\n[Extractor/User Turn {turn + 1}]:\n{clean_ext_response}\n{'-'*50}")

        if "terminate" in clean_ext_response.lower():
            print(f"Success: {subtopic} naturally completed.")
            success = True
            break

        final_dataset_history.append({"role": "user", "content": clean_ext_response})
        api_messages.append({"role": "user", "content": clean_ext_response})

    if success:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(json.dumps({"messages": final_dataset_history}) + "\n")
    else:
        print(f"Discarding {subtopic}: Reached turn limit without TERMINATE or encountered an unrecoverable error.")