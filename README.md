# DataGen 🧠

A **full-stack synthetic dataset generator** for LLM fine-tuning. DataGen uses a BFS-driven topic graph to explore subtopics and generates richly diverse, multi-turn conversations at every node — powered by **persona-driven prompting** to eliminate repetition and mode collapse.

Built for researchers and engineers who want to create high-quality, domain-specific fine-tuning datasets at scale without manual curation.

**🔴 Live Demo:** [https://data-gen-1.onrender.com/](https://data-gen-1.onrender.com/)

---

## ✨ Features

- **BFS Topic Exploration** — Starts from a seed topic, extracts subtopics at each node, and traverses the knowledge graph breadth-first up to a configurable depth and node count.
- **Persona-Driven Diversity** — Each scenario is generated for a randomly selected user persona (e.g. a panicked junior dev, a curious highschooler, a startup CTO) to guarantee wildly different questions across the dataset. 24 unique user personas, 5 assistant personas included out of the box.
- **Locked Conversation Dynamics** — User + Assistant personas are locked in for the duration of a single conversation, ensuring highly realistic, internally consistent dialogues.
- **Configurable Assistant Persona** — Optionally lock the AI's personality for your entire dataset (e.g. always "Patient Tutor" for a tutoring model) or let it randomize for a general-purpose dataset.
- **Live Streaming UI** — A real-time progress view streams generation events directly to the browser over SSE. No polling, no refreshing.
- **Analytics Dashboard** — Per-dataset analytics showing total records, average turns per conversation, estimated tokens, unique topics explored, and more.
- **Multiple Export Formats** — Download your dataset as **ShareGPT** (axolotl, unsloth, LLaMA-Factory compatible) or **Alpaca** (most other LoRA tools).
- **Auth + History** — JWT-based authentication with a full sidebar history of past dataset jobs.
- **Glassmorphic UI** — A premium dark UI with animated gradient backgrounds, frosted glass panels, and micro-animations.

---

## 🏗️ Architecture

```
User Input (topic + config)
        │
        ▼
  POST /jobs  ──► MongoDB (Job created)
        │
        ▼
  GET /jobs/:id/stream (SSE)
        │
        ▼
  runBFS() [bfs.js]
  ├── extractScenarios()    — LLM generates 10 scenarios, one per random user persona
  │     └── for each scenario:
  │           ├── generateConversation()  — LLM simulates dialogue with locked persona pair
  │           └── onSample()  — saves to MongoDB in real-time
  └── extractSubtopics()    — LLM extracts subtopics → filtered via visited set → enqueued
```

---

## 🚀 Setup

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (free tier works)
- OpenRouter API key (free tier available)

### 1. Backend

```bash
cd data_generator
cp .env.example .env
# Fill in your values in .env
npm install
npm start
```

`.env` variables:

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Any long random string for JWT signing |
| `PORT` | Port to run the backend on (default: `5000`) |

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## ⚙️ Generation Settings

| Setting | Default | Description |
|---|---|---|
| **Max Depth** | 2 | BFS hops from the seed topic |
| **Max Topics** | 10 | Total topics to explore across the graph |
| **Branching Factor** | 3 | New subtopics extracted and queued per node |
| **Exchanges** | 5 | Number of back-and-forth turns per conversation (1 exchange = 1 user message + 1 AI message) |
| **Model** | `llama-3.3-70b-instruct:free` | Any OpenRouter model string |
| **Assistant Persona** | Random | Lock the AI's personality across the dataset or let it randomize |

> **Estimated output:** `Max Topics × 10 conversations × Exchanges × 2 messages`

---

## 🎭 Persona System

DataGen ships with **24 user (extractor) personas** and **5 assistant (generator) personas**, directly inspired by the [Magpie alignment paper](https://arxiv.org/abs/2406.08464).

### User Personas (sample)
| Category | Personas |
|---|---|
| Students | Confused CS Student, Bootcamp Student, Self-taught Dev, Curious Highschooler |
| Junior / Mid | Production Bug Firefighter, Code Review Shame, Frontend Dev on Backend, Stack Switcher |
| Senior / Staff | Deep Diver, Architecture Designer, Legacy Refactorer |
| Product / Business | Non-technical Founder, PM Writing a Ticket, Client with Big Vision, CTO in Scaling Crisis |
| Niche | FAANG Interviewer, Open Source Maintainer, Security Researcher, Indie Hacker, Hackathon Team |

### Assistant Personas
| Persona | Style |
|---|---|
| `principal_engineer` | Terse, production-grade, Big-O aware |
| `patient_tutor` | Analogy-first, beginner-friendly, readable code |
| `pragmatic_senior` | Honest tradeoffs, real-world gotchas |
| `competitive_programmer` | Performance-obsessed, terse but correct |
| `security_focused_engineer` | Adversarial thinking, attack vectors, secure-by-default |

---

## 📦 Output Formats

### ShareGPT (default)
Compatible with **axolotl**, **unsloth**, **LLaMA-Factory**:
```json
{
  "conversations": [
    { "from": "human", "value": "..." },
    { "from": "gpt", "value": "..." }
  ],
  "metadata": { "topic": "Binary Search Trees", "depth": 1 }
}
```

### Alpaca
Compatible with most other LoRA training tools:
```json
{
  "instruction": "...",
  "input": "",
  "output": "..."
}
```

---

## 🌐 Deployment

### Backend (Railway / Render / Fly.io)
1. Push to GitHub
2. Connect the repo to your platform
3. Set environment variables: `MONGO_URI`, `JWT_SECRET`, `PORT`

### Frontend (Vercel / Netlify)
1. Set the `BASE` URL in [`frontend/src/api.js`](frontend/src/api.js) to your deployed backend URL
2. Deploy the `frontend/` directory

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Vanilla CSS (Glassmorphic) |
| Backend | Node.js, Express |
| Database | MongoDB (Mongoose) |
| Auth | JWT |
| AI | OpenRouter API (any model) |
| Streaming | Server-Sent Events (SSE) |
