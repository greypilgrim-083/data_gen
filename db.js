const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/datagen";

mongoose.connect(mongoUri)
  .then(() => console.log("[DB] MongoDB connected successfully"))
  .catch((err) => console.error("[DB] MongoDB connection error:", err.message));

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});

const jobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  topic: String,
  config: Object, // { maxDepth, maxNodes, branchingFactor, model, turns }
  status: { type: String, default: "pending" }, // pending | running | done | failed
  samples: { type: Array, default: [] }, // array of ShareGPT conversation objects
  topicsCovered: { type: Array, default: [] },
  metrics: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Job = mongoose.model("Job", jobSchema);

module.exports = { User, Job };

