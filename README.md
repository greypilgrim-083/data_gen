<div align="center">
  <h1> DataGen</h1>
  <p><strong>Fully Automated, Self-Expanding Synthetic Data Generation for LLM Fine-Tuning</strong></p>
  
  [![Deploy on Render](https://img.shields.io/badge/Deployed%20on-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://data-gen-rt70.onrender.com/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
  [![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
</div>

<br>

**DataGen Pro** is a high-throughput pipeline that generates massive, highly versatile conversational datasets to train and fine-tune Large Language Models. Instead of writing prompts by hand, you give it a single master topic (e.g., `"Advanced TypeScript Patterns"`), and it autonomously branches out to discover hundreds of subtopics, generating deeply technical, multi-turn conversations for each.

👉 **[Live Demo on Render](https://data-gen-rt70.onrender.com/)**

---

## 🚀 Key Features

* **BFS Topic Expansion:** Extracts technical keywords from its own generations and recursively explores them using a Breadth-First Search (BFS) queue. A single seed topic can automatically expand into a massive domain dataset.
* **Matrix Persona Generation:** Simulates conversations using **15 diverse user personas** (e.g., *Confused CS Student, FAANG Interviewer, Startup CTO in Crisis*) against **5 distinct AI personas** (e.g., *Pragmatic Senior, Patient Tutor*). This prevents repetitive, monotone data.
* **Auto API Key Rotation:** Seamlessly rotates through a pool of Groq API keys with exponential backoff and retry logic to avoid `429 Too Many Requests` limits.
* **Format Versatility:** Exports directly into standard fine-tuning formats (`sharegpt`, `alpaca`, `openai`).
* **Glassmorphism UI:** Features a gorgeous, responsive, animated dashboard for real-time generation tracking and historical dataset downloads.

---

## 📊 Data Versatility Metrics

The primary focus of DataGen Pro is **variance**. Monotone datasets cause LLMs to overfit to a single tone or structure. DataGen Pro solves this through combinatorial explosion:

1. **Persona Matrix:** 15 Extractor (User) Personas × 5 Generator (AI) Personas = **75 unique interaction dynamics**.
2. **Subtopic Branching:** If the system is set to generate 20 records, it will dynamically uncover up to 20 subtopics. 
3. **Versatility Score:** 75 dynamics × 20 subtopics = **1,500 distinct conversational vectors** generated from just one root keyword. 

Whether your LLM is talking to a 17-year-old hobbyist or a Principal Engineer doing a code review, it will have training data for that exact interaction style.

---

## 🛠️ Tech Stack

* **Backend:** Python, FastAPI, Uvicorn, bcrypt, PyMongo
* **LLM Engine:** Groq API (`llama-3.3-70b-versatile` for high-throughput reasoning)
* **Frontend:** Vanilla HTML5, CSS3 (Glassmorphism), JavaScript
* **Database:** MongoDB Atlas (stores generated datasets and user accounts)

---

## 💻 Local Development

Want to run DataGen Pro on your own machine?

### 1. Clone & Setup
```bash
git clone https://github.com/greypilgrim-083/data_gen.git
cd data_gen
python -m venv .venv
source .venv/bin/activate  # Or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### 2. Configure Secrets
Create a `.env` file in the root directory and add your credentials:
```env
MONGODB_URI="mongodb+srv://<your-cluster-url>"
JWT_SECRET="your-super-secret-key"
# Add multiple keys separated by commas for auto-rotation
GROQ_API_KEYS="gsk_key1,gsk_key2,gsk_key3"
```

### 3. Run the Server
```bash
uvicorn server:app --host 0.0.0.0 --port 3000 --reload
```
Open your browser and navigate to `http://localhost:3000`.

---

## 📝 License
MIT License - feel free to fork, modify, and build your own highly versatile datasets!
