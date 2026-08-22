const mongoose = require("mongoose");

mongoose.connect(process.env.MONGO_URI);

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});

const jobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  topic: String,
  config: Object, // { maxDepth, maxNodes, branchingFactor, model, turns }
  status: { type: String, default: "running" }, // running | done | failed
  samples: { type: Array, default: [] }, // array of ShareGPT conversation objects
  topicsCovered: { type: Array, default: [] },
  metrics: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Job = mongoose.model("Job", jobSchema);

module.exports = { User, Job };
