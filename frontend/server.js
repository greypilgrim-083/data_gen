const express  = require("express");
const fs        = require("fs");
const path      = require("path");
const { spawn } = require("child_process");

const app  = express();
const PORT = 3000;
const ROOT = path.join(__dirname, "..");   // datagen_lora/

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── State ─────────────────────────────────────────────────────────────────────

let pythonProcess = null;
let sseClients   = [];          // list of SSE response objects
let isRunning    = false;

// ── Broadcast to all SSE clients ──────────────────────────────────────────────

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((res) => res.write(data));
}

// ── POST /log  (called by bfs.py's send() function) ──────────────────────────

app.post("/log", (req, res) => {
  const msg = req.body.message;

  if (typeof msg === "object" && msg !== null) {
    // Structured event (status or done)
    if (msg.type === "done") {
      isRunning = false;
      broadcast({ type: "done" });
    } else if (msg.type === "topic_start") {
      broadcast({ type: "topic_start", topic: msg.topic });
    } else if (msg.type === "record_added") {
      broadcast({ type: "record_added", total: msg.total });
    }
  } else {
    // Plain log string
    broadcast({ type: "log", message: String(msg) });
  }

  res.json({ ok: true });
});

// ── POST /start ───────────────────────────────────────────────────────────────

app.post("/start", (req, res) => {
  if (isRunning) {
    return res.json({ error: "Already running." });
  }

  const { topic, num_seed, output_file, output_format, max_outputs, max_depth, api_keys, dataset_type } = req.body;

  if (!topic || !api_keys || api_keys.length === 0) {
    return res.json({ error: "topic and api_keys are required." });
  }

  // Write config for bfs.py to read
  const config = { topic, num_seed, output_file, output_format, max_outputs, max_depth, api_keys, dataset_type };
  fs.writeFileSync(path.join(ROOT, "bfs_config.json"), JSON.stringify(config, null, 2));

  // Detect Python path (venv on Windows or fallback)
  const venvPython = path.join(ROOT, ".venv", "Scripts", "python.exe");
  const pythonPath = fs.existsSync(venvPython) ? venvPython : "python";

  isRunning = true;

  pythonProcess = spawn(pythonPath, [path.join(ROOT, "backend_core.py")], {
    cwd: ROOT,
  });

  pythonProcess.stdout.on("data", (data) => {
    // bfs.py uses send() not print, but forward anything it does print
    broadcast({ type: "log", message: data.toString().trim() });
  });

  pythonProcess.stderr.on("data", (data) => {
    broadcast({ type: "log", message: "[stderr] " + data.toString().trim() });
  });

  pythonProcess.on("close", (code) => {
    isRunning = false;
    broadcast({ type: "log", message: `Python process exited (code ${code}).` });
    broadcast({ type: "done" });
    pythonProcess = null;
  });

  res.json({ message: `Started generation for '${topic}'.` });
});

// ── POST /stop ────────────────────────────────────────────────────────────────

app.post("/stop", (req, res) => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  isRunning = false;
  broadcast({ type: "log", message: "Stopped by user." });
  broadcast({ type: "done" });
  res.json({ message: "Stopped." });
});

// ── GET /stream  (SSE) ────────────────────────────────────────────────────────

app.get("/stream", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");

  // Send initial heartbeat so the connection opens immediately
  res.write('data: {"type":"connected"}\n\n');

  sseClients.push(res);

  // Clean up when the browser disconnects
  req.on("close", () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

// ── GET /formats ──────────────────────────────────────────────────────────────

app.get("/formats", (req, res) => {
  res.json({ formats: ["openai", "sharegpt", "alpaca"] });
});



// ── GET /download ─────────────────────────────────────────────────────────────

app.get("/download", (req, res) => {
  const file     = req.query.file;
  if (!file) return res.status(400).json({ error: "file param required." });

  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File not found." });

  res.download(fullPath, file);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`DataGen dashboard → http://localhost:${PORT}`);
  console.log(`Waiting for bfs.py to connect via POST /log`);
});
