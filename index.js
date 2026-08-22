require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { User, Job } = require("./db");
const auth = require("./auth");
const { runBFS } = require("./bfs");

const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve built frontend
const frontendDist = path.join(__dirname, "frontend", "dist");
app.use(express.static(frontendDist));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hash });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch {
    res.status(400).json({ error: "Email already in use" });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
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
    assistantPersona = "random"
  } = req.body;

  if (!topic) return res.status(400).json({ error: "topic is required" });

  const job = await Job.create({
    userId: req.user.id,
    topic,
    config: { maxDepth, maxNodes, branchingFactor, model, turns, assistantPersona },
    status: "pending",
  });
  console.log(`[DB] Created new job: ${job._id} for topic: "${topic}"`);

  res.json({ jobId: job._id });
});

// SSE stream — runs BFS and streams events; apiKey sent as query param
app.get("/jobs/:id/stream", auth, async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, userId: req.user.id });
  if (!job) return res.status(404).json({ error: "Job not found" });

  const apiKey = req.query.apiKey;
  if (!apiKey) {
    return res.status(400).json({ error: "apiKey query param required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const { maxDepth, maxNodes, branchingFactor, model, turns, assistantPersona = "random" } = job.config;
  const topic = job.topic;
  const topicsCovered = [];

  console.log(`[DB] Starting job: ${job._id} | Model: ${model}`);
  await Job.findByIdAndUpdate(job._id, { status: "running" });

  try {
    let finalEvent = null;
    for await (const event of runBFS({
      topic, maxDepth, maxNodes, branchingFactor, model, turns, apiKey, assistantPersona,
      onSample: async (sample) => {
        console.log(`[DB] Saving 1 sample for job ${job._id}`);
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

    samples.forEach(s => {
      if (!s.conversations) return;
      s.conversations.forEach(c => {
        totalTurns += 1;
        totalTokens += Math.ceil((c.value?.length || 0) / 4);
      });
    });

    const metrics = {
      totalRecords: samples.length,
      uniqueTopics: topicsCovered.length,
      totalTokens,
      avgTurns: samples.length ? (totalTurns / samples.length).toFixed(1) : 0,
      avgSequenceLength: totalTurns ? Math.ceil(totalTokens / totalTurns) : 0
    };

    console.log(`[DB] Job ${job._id} complete. Updating metrics:`, metrics);
    await Job.findByIdAndUpdate(job._id, { status: "done", metrics });
    
    if (finalEvent) send(finalEvent);
  } catch (e) {
    console.error(`[STREAM ERROR] Job ${job._id} failed:`, e.message);
    send({ event: "error", message: e.message });
    await Job.findByIdAndUpdate(job._id, { status: "failed" });
  }

  res.end();
});

// List user's jobs
app.get("/jobs", auth, async (req, res) => {
  const jobs = await Job.find({ userId: req.user.id })
    .select("topic config status topicsCovered createdAt metrics")
    .sort({ createdAt: -1 });
  res.json(jobs);
});

// Get single job details
app.get("/jobs/:id", auth, async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, userId: req.user.id })
    .select("-samples"); // exclude huge samples payload, we only need metrics/config
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// Download dataset
app.get("/jobs/:id/download", auth, async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, userId: req.user.id });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!job.samples?.length) return res.status(400).json({ error: "No samples yet" });

  const format = req.query.format || "sharegpt";
  let lines;

  if (format === "alpaca") {
    lines = job.samples.map((s) => {
      const turns = s.conversations;
      return JSON.stringify({ instruction: turns[0]?.value || "", input: "", output: turns[1]?.value || "" });
    });
  } else {
    lines = job.samples.map((s) => JSON.stringify(s));
  }

  res.setHeader("Content-Disposition", `attachment; filename="${job.topic}-${format}.jsonl"`);
  res.setHeader("Content-Type", "application/jsonl");
  res.send(lines.join("\n"));
});

// SPA fallback — serve index.html for any non-API route
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
