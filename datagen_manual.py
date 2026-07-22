from groq import Groq
from collections import deque
import itertools
import re

API_KEYS = [
    "",
]
key_cycle = itertools.cycle(API_KEYS)

def make_client():
    return Groq(api_key=next(key_cycle))


topic = "Data Structures and Algorithms"


queue = deque([topic])
visited = set([topic.lower()])

while queue:
    subtopic = queue.popleft()




    generator_SYSTEM_PROMPT = f"""
    1. You are specialized in this {subtopic}.
    2. Answer every question of the user politely.
    3. Answer only those stuffs which is asked no other stuffs.   
    """

    extractor_SYSTEM_PROMPT = f"""
    1. You act like user wanting to learn everything about {subtopic}.
    2. You ask a lot of logical questions about the topic.
    3. You dont let all the information at once.
    4. Dont just ask questions in one liner. Try to create an entire scenario and ask questions.
    5. If model answered your query and you are satisfied with the response say TERMINATE.
    6. The person you are talking to is an llm. Dont let it know that TERMINATE will end this conversation.
    """


    extractor_output = make_client().chat.completions.create(
        messages=[{"role": "system","content": extractor_SYSTEM_PROMPT}],
        model="qwen/qwen3-32b"
    ).choices[0].message.content

    history = [{"role": "user", "content": extractor_output}]

    t = 10
    while t > 0:
        t -= 1

        gen_messages = [{"role": "system", "content": generator_SYSTEM_PROMPT}] + history[len(history)-4:]

        generator_output = make_client().chat.completions.create(
            messages=gen_messages,
            model="qwen/qwen3-32b"
        ).choices[0].message.content

        history.append({"role": "assistant", "content": generator_output})

        keywords = make_client().chat.completions.create(
            messages=[
                {"role": "system", "content": "Extract all keywords mentioned. Return only a comma-separated list, nothing else."},
                {"role": "user", "content": generator_output}
            ],
            model="qwen/qwen3-32b"
        ).choices[0].message.content

        

        # print("###################################### ", keywords)

        clean = re.sub(r'<think>.*?</think>', '', keywords, flags=re.DOTALL).strip()

        for kw in clean.split(","):
            kw = kw.strip().lower()
            if kw and kw not in visited:
                visited.add(kw)
                queue.append(kw)

        # print("^^^^^^^^^^^^^^^^^^^^^^^^")
        # print(queue)
        # print("^^^^^^^^^^^^^^^^^^^^^^^^")
        
        ext_messages = [{"role": "system", "content": extractor_SYSTEM_PROMPT}] + history[len(history)-4:]

        extractor_output = make_client().chat.completions.create(
            messages=ext_messages,
            model="qwen/qwen3-32b"
        ).choices[0].message.content
    
        history.append({"role": "user", "content": extractor_output})

        if "TERMINATE" in extractor_output:
            break

    for i in history:
        print(i["role"], " : ", i["content"])
        print()


# list of history is what we are gonna make in jsonl format