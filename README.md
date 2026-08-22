# DataGen

Synthetic dataset generator for LLM fine-tuning. BFS-traverses a topic graph, generates multi-turn conversations at each node, streams progress live to the browser.

## Setup

### 1. Backend

```bash
cd d:\data_generator
cp .env.example .env
# Fill in MONGO_URI (MongoDB Atlas) and JWT_SECRET in .env
npm start
```

### 2. Frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:5173

## How it works

1. Enter a topic (e.g. "Data Structures")
2. The BFS runner pops the topic from the queue
3. **Scenario Extractor LLM** → 10 scenario prompts
4. **Conversation Generator LLM** → multi-turn dialogue per scenario
5. **Subtopic Extractor LLM** → raw keywords → filtered through visited set → pushed to queue
6. Repeat until max depth / max nodes reached
7. Download dataset as ShareGPT or Alpaca JSONL

## Config

| Field | Default | Description |
|---|---|---|
| Max Depth | 2 | BFS hops from master topic |
| Max Nodes | 10 | Total topics to explore |
| Branching Factor | 3 | New subtopics kept per node |
| Turns | 5 | Turns per conversation |
| Model | llama-3.3-70b-instruct:free | Any OpenRouter model string |

## Output Formats

- **ShareGPT** — compatible with axolotl, unsloth, LLaMA-Factory
- **Alpaca** — compatible with most other LoRA tools

## Deploy

- Backend: Railway / Render / Fly.io — set MONGO_URI and JWT_SECRET as env vars
- Frontend: Vercel / Netlify — change the BASE url in `src/api.js` to your backend URL
