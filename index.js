require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const { User, Job } = require("./db");
const auth = require("./auth");
const { runBFS } = require("./bfs");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_datagen_jwt_secret";

const app = express();
app.use(cors());
app.use(express.json());

// Serve built frontend static files
const frontendDist = path.join(__dirname, "frontend", "dist");
app.use(express.static(frontendDist));

// ── Public Config ─────────────────────────────────────────────────────────────

app.get("/api/config", (req, res) => {
  res.json({
    hasServerApiKey: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim()),
    defaultModel: process.env.DEFAULT_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hash });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "An account with this email already exists" });
    }
    res.status(500).json({ error: "Registration failed: " + err.message });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: "Login failed: " + err.message });
  }
});

// ── Jobs ──────────────────────────────────────────────────────────────────────

// Create job and return jobId — client then connects to /jobs/:id/stream to run it
app.post("/jobs", auth, async (req, res) => {
  const {
    topic,
    maxDepth = 2,
    maxNodes = 10,
    branchingFactor = 3,
    model = "meta-llama/llama-3.3-70b-instruct:free",
    turns = 5,
    assistantPersona = "random",
    scenariosPerNode,
  } = req.body;

  if (!topic || !topic.trim()) return res.status(400).json({ error: "Topic is required" });

  try {
    const job = await Job.create({
      userId: req.user.id,
      topic: topic.trim(),
      config: { maxDepth, maxNodes, branchingFactor, model, turns, assistantPersona, scenariosPerNode },
      status: "pending",
    });
    console.log(`[DB] Created new job: ${job._id} for topic: "${topic.trim()}"`);
    res.json({ jobId: job._id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create job: " + err.message });
  }
});

// SSE stream — runs BFS and streams events; apiKey sent via query or fallback to env
app.get("/jobs/:id/stream", auth, async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, userId: req.user.id });
    if (!job) return res.status(404).json({ error: "Job not found" });

    const apiKey = (req.query.apiKey || process.env.OPENROUTER_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(400).json({
        error: "OpenRouter API Key required. Please provide it in the UI or set OPENROUTER_API_KEY in server .env",
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (obj) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      }
    };

    const { maxDepth, maxNodes, branchingFactor, model, turns, assistantPersona = "random", scenariosPerNode } = job.config || {};
    const topic = job.topic;
    const topicsCovered = [];

    console.log(`[DB] Starting job: ${job._id} | Model: ${model}`);
    await Job.findByIdAndUpdate(job._id, { status: "running" });

    let finalEvent = null;

    try {
      for await (const event of runBFS({
        topic,
        maxDepth,
        maxNodes,
        branchingFactor,
        model,
        turns,
        apiKey,
        assistantPersona,
        scenariosPerNode,
        onSample: async (sample) => {
          await Job.findByIdAndUpdate(job._id, { $push: { samples: sample } });
        },
      })) {
        if (event.event === "node_start") {
          topicsCovered.push(event.topic);
          await Job.findByIdAndUpdate(job._id, { $push: { topicsCovered: event.topic } });
          send(event);
        } else if (event.event === "job_complete") {
          finalEvent = event;
        } else {
          send(event);
        }
      }

      const updatedJob = await Job.findById(job._id);
      const samples = updatedJob.samples || [];
      let totalTokens = 0;
      let totalTurns = 0;

      samples.forEach((s) => {
        if (!s.conversations) return;
        s.conversations.forEach((c) => {
          totalTurns += 1;
          totalTokens += Math.ceil((c.value?.length || 0) / 4);
        });
      });

      const metrics = {
        totalRecords: samples.length,
        uniqueTopics: topicsCovered.length,
        totalTokens,
        avgTurns: samples.length ? (totalTurns / samples.length).toFixed(1) : 0,
        avgSequenceLength: totalTurns ? Math.ceil(totalTokens / totalTurns) : 0,
      };

      console.log(`[DB] Job ${job._id} complete. Samples generated: ${samples.length}`);
      await Job.findByIdAndUpdate(job._id, { status: "done", metrics });

      if (finalEvent) send(finalEvent);
    } catch (e) {
      console.error(`[STREAM ERROR] Job ${job._id} failed:`, e.message);
      send({ event: "error", message: e.message });
      await Job.findByIdAndUpdate(job._id, { status: "failed" });
    }

    res.end();
  } catch (err) {
    console.error("[STREAM HANDLER ERROR]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

// List user's jobs
app.get("/jobs", auth, async (req, res) => {
  try {
    const jobs = await Job.find({ userId: req.user.id })
      .select("topic config status topicsCovered createdAt metrics")
      .sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: "Failed to list jobs: " + err.message });
  }
});

// Get single job details
app.get("/jobs/:id", auth, async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, userId: req.user.id }).select("-samples");
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch job: " + err.message });
  }
});

// Download dataset
app.get("/jobs/:id/download", auth, async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, userId: req.user.id });
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!job.samples?.length) return res.status(400).json({ error: "No samples generated yet" });

    const format = req.query.format || "sharegpt";
    let lines;

    if (format === "alpaca") {
      lines = job.samples.map((s) => {
        const turns = s.conversations || [];
        return JSON.stringify({
          instruction: turns[0]?.value || "",
          input: "",
          output: turns[1]?.value || "",
        });
      });
    } else {
      lines = job.samples.map((s) => JSON.stringify(s));
    }

    const safeTopic = (job.topic || "dataset")
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 50);

    res.setHeader("Content-Disposition", `attachment; filename="${safeTopic}-${format}.jsonl"`);
    res.setHeader("Content-Type", "application/jsonl");
    res.send(lines.join("\n"));
  } catch (err) {
    res.status(500).json({ error: "Download failed: " + err.message });
  }
});

// SPA fallback — serve index.html for all frontend routes
app.use((req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`[Server] Running on http://localhost:${PORT}`));
