const inputTopic      = document.getElementById("topic");
const inputNumSeed    = document.getElementById("num-seed");
const inputMaxOutputs = document.getElementById("max-outputs");
const inputDatasetType = document.getElementById("dataset-type");
const inputFormat     = document.getElementById("format");
const inputOutputFile = document.getElementById("output-file");
const inputApiKeys    = document.getElementById("api-keys");
const btnStart        = document.getElementById("btn-start");
const btnStop         = document.getElementById("btn-stop");

const statRecords = document.getElementById("stat-records");
const statTopic   = document.getElementById("stat-topic");

const DEFAULT_KEYS = [
  "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",
  "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",
  "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",
  "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",
];

let sseSource = null;
let isRunning = false;
let recordCount = 0;

window.addEventListener("DOMContentLoaded", () => {
  inputApiKeys.value = DEFAULT_KEYS.join("\n");
  loadFormats();
});

async function loadFormats() {
  const res  = await fetch("/formats");
  const data = await res.json();
  inputFormat.innerHTML = "";
  data.formats.forEach((fmt) => {
    const opt = document.createElement("option");
    opt.value       = fmt;
    opt.textContent = fmt;
    inputFormat.appendChild(opt);
  });
}

btnStart.addEventListener("click", async () => {
  const topic = inputTopic.value.trim();
  if (!topic) { alert("Enter a master topic."); return; }

  const keys = inputApiKeys.value.split("\n").map((k) => k.trim()).filter((k) => k.length > 0);
  if (keys.length === 0) { alert("Add at least one API key."); return; }

  recordCount = 0;
  statRecords.textContent = "0";
  statTopic.textContent = "Initializing...";

  const payload = {
    topic,
    num_seed:      parseInt(inputNumSeed.value, 10),
    max_outputs:   parseInt(inputMaxOutputs.value, 10),
    dataset_type:  inputDatasetType.value,
    output_format: inputFormat.value,
    output_file:   inputOutputFile.value.trim() || "output.jsonl",
    api_keys:      keys,
  };

  const res  = await fetch("/start", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }

  setRunning(true);
  connectSSE();
});

btnStop.addEventListener("click", async () => {
  await fetch("/stop", { method: "POST" });
  setRunning(false);
  disconnectSSE();
});

function connectSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource("/stream");

  sseSource.onmessage = (e) => {
    const event = JSON.parse(e.data);
    handleEvent(event);
  };

  sseSource.onerror = () => {
    if (!isRunning) sseSource.close();
  };
}

function disconnectSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
}

function handleEvent(event) {
  if (event.type === "topic_start") {
    statTopic.textContent = event.topic;
  }
  if (event.type === "record_added") {
    recordCount = event.total;
    statRecords.textContent = recordCount;
  }
  if (event.type === "done") {
    setRunning(false);
    disconnectSSE();
    statTopic.textContent = "Finished.";
    
    // Auto download
    const filename = inputOutputFile.value.trim() || "output.jsonl";
    window.location.href = `/download?file=${encodeURIComponent(filename)}`;
  }
}

function setRunning(val) {
  isRunning         = val;
  btnStart.disabled = val;
  btnStop.disabled  = !val;
}
