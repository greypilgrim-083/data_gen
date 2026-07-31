require('dotenv').config();
const express  = require("express");
const fs        = require("fs");
const path      = require("path");
const { spawn } = require("child_process");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app  = express();
const PORT = 3000;
const ROOT = path.join(__dirname, "..");

app.use(express.json({ limit: "50mb" }));
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// --- MongoDB Config ---
const MONGODB_URI = "mongodb+srv://prashantchaudhary7353:en1BajjkWrwLASbg@cluster0.whux6p0.mongodb.net/datagen?appName=Cluster0";
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey12345";

mongoose.connect(MONGODB_URI).then(() => console.log("Connected to MongoDB")).catch(console.error);

// --- Models ---
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const User = mongoose.model("User", userSchema);

const datasetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  topic: String,
  totalRecords: { type: Number, default: 0 },
  filename: String,
  status: { type: String, default: "generating" },
  createdAt: { type: Date, default: Date.now },
});
const Dataset = mongoose.model("Dataset", datasetSchema);

const datasetRecordSchema = new mongoose.Schema({
  datasetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dataset' },
  record: mongoose.Schema.Types.Mixed,
});
const DatasetRecord = mongoose.model("DatasetRecord", datasetRecordSchema);

// --- State ---
const activeTasks = {}; // taskId -> { process, status: { state: "running|done|error", progress: 0, topic: "", error: "" }, userId, datasetId, records: [] }

// --- Auth Middleware ---
function authMiddleware(req, res, next) {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Access denied" });
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: "Invalid token" });
  }
}

// --- Auth Routes ---
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: "Email already exists" });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = new User({ email, password: hashedPassword });
    await user.save();
    const token = jwt.sign({ _id: user._id }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Email not found" });
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: "Invalid password" });
    const token = jwt.sign({ _id: user._id }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Dataset Routes ---
app.get("/api/datasets", authMiddleware, async (req, res) => {
  try {
    const datasets = await Dataset.find({ userId: req.user._id, status: "completed" }).sort({ createdAt: -1 });
    res.json(datasets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Log / Webhook from Python ---
app.post("/log/:taskId", (req, res) => {
  const { taskId } = req.params;
  const msg = req.body;
  const task = activeTasks[taskId];
  if (!task) return res.json({ ok: false });

  if (typeof msg === "object" && msg !== null) {
    if (msg.type === "done") {
      task.status.state = "done";
      if (task.userId && task.datasetId) {
        Dataset.findByIdAndUpdate(task.datasetId, { totalRecords: task.status.progress, status: "completed" }).catch(console.error);
      }
    } else if (msg.type === "topic_start") {
      task.status.topic = msg.topic;
    } else if (msg.type === "record_added") {
      task.status.progress = msg.total;
      
      // Save record to DB or RAM
      if (task.userId && task.datasetId) {
        new DatasetRecord({ datasetId: task.datasetId, record: msg.record }).save().catch(console.error);
      } else {
        task.records.push(msg.record);
      }
    }
  }
  res.json({ ok: true });
});

// --- Generation API ---
app.post("/start", async (req, res) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  let userId = null;
  if (token) {
    try {
      const verified = jwt.verify(token, JWT_SECRET);
      userId = verified._id;
    } catch(e) {}
  }

  const { topic, num_seed, output_file, output_format, max_outputs, dataset_type } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required." });

  const taskId = Date.now().toString();
  const filename = output_file || `output_${taskId}.jsonl`;

  const config = { topic, num_seed: parseInt(num_seed)||10, output_file: filename, output_format: output_format||"openai", max_outputs: parseInt(max_outputs)||10, dataset_type: dataset_type||"multi_turn", taskId };
  fs.writeFileSync(path.join(ROOT, "bfs_config.json"), JSON.stringify(config, null, 2));

  let datasetId = null;
  if (userId) {
    try {
      const ds = await new Dataset({ userId, topic, filename, status: "generating", totalRecords: 0 }).save();
      datasetId = ds._id;
    } catch (e) { console.error(e); }
  }

  const venvPython = path.join(ROOT, ".venv", "Scripts", "python.exe");
  const pythonPath = fs.existsSync(venvPython) ? venvPython : "python";

  const process = spawn(pythonPath, [path.join(ROOT, "backend_core.py")], { cwd: ROOT });

  process.stdout.on("data", (data) => console.log(`[Python]: ${data.toString()}`));
  process.stderr.on("data", (data) => console.error(`[Python Error]: ${data.toString()}`));

  activeTasks[taskId] = {
    process,
    userId,
    datasetId,
    records: [],
    status: { state: "running", progress: 0, topic: "Initializing...", error: "" }
  };

  process.on("close", (code) => {
    if (activeTasks[taskId] && activeTasks[taskId].status.state === "running") {
      activeTasks[taskId].status.state = "done";
      if (activeTasks[taskId].userId && activeTasks[taskId].datasetId) {
        Dataset.findByIdAndUpdate(activeTasks[taskId].datasetId, { 
            totalRecords: activeTasks[taskId].status.progress, 
            status: "completed" 
        }).catch(console.error);
      }
    }
  });

  // Provide taskId or datasetId for frontend tracking and downloading
  res.json({ taskId, datasetId, message: "Started generation." });
});

app.get("/status/:taskId", (req, res) => {
  const task = activeTasks[req.params.taskId];
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task.status);
});

// ── GET /formats ──────────────────────────────────────────────────────────────
app.get("/formats", (req, res) => {
  res.json({ formats: ["openai", "sharegpt", "alpaca"] });
});

// ── GET /download ─────────────────────────────────────────────────────────────
app.get("/download", async (req, res) => {
  const { datasetId, taskId } = req.query;
  
  res.setHeader("Content-Type", "application/jsonl");
  res.setHeader("Content-Disposition", 'attachment; filename="dataset.jsonl"');

  if (datasetId) {
    try {
      const records = await DatasetRecord.find({ datasetId });
      for (let r of records) {
        res.write(JSON.stringify(r.record) + "\n");
      }
      return res.end();
    } catch (e) {
      return res.status(500).send("Error generating file.");
    }
  } else if (taskId && activeTasks[taskId]) {
    for (let r of activeTasks[taskId].records) {
      res.write(JSON.stringify(r) + "\n");
    }
    // Optional: free memory if desired, but we can wait until server restart
    return res.end();
  } else {
    return res.status(404).send("Dataset not found");
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`DataGen dashboard → http://localhost:${PORT}`);
});
