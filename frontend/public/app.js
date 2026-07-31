const API_URL = "";

// Elements
const viewHome = document.getElementById("view-home");
const viewAuth = document.getElementById("view-auth");
const viewDashboard = document.getElementById("view-dashboard");

const linkHome = document.getElementById("link-home");
const linkAuth = document.getElementById("link-auth");
const linkDashboard = document.getElementById("link-dashboard");
const linkLogout = document.getElementById("link-logout");

const formAuth = document.getElementById("form-auth");
const authTitle = document.getElementById("auth-title");
const authToggleText = document.getElementById("auth-toggle-text");
const authToggleLink = document.getElementById("auth-toggle-link");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const btnAuthSubmit = document.getElementById("btn-auth-submit");

const btnStart = document.getElementById("btn-start");
const statTopic = document.getElementById("stat-topic");
const statRecords = document.getElementById("stat-records");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");
const datasetsGrid = document.getElementById("datasets-grid");
const btnViewDatasets = document.getElementById("btn-view-datasets");

let isLoginMode = true;
let pollInterval = null;

// Initialization
window.addEventListener("DOMContentLoaded", () => {
  loadFormats();
  checkAuth();
});

// Routing / View Management
function showView(view) {
  viewHome.classList.add("hidden");
  viewAuth.classList.add("hidden");
  viewDashboard.classList.add("hidden");
  view.classList.remove("hidden");

  linkHome.classList.remove("active");
  linkAuth.classList.remove("active");
  linkDashboard.classList.remove("active");
}

linkHome.addEventListener("click", () => { showView(viewHome); linkHome.classList.add("active"); });
linkAuth.addEventListener("click", () => { showView(viewAuth); linkAuth.classList.add("active"); });
linkDashboard.addEventListener("click", () => { showView(viewDashboard); linkDashboard.classList.add("active"); loadDatasets(); });

linkLogout.addEventListener("click", () => {
  localStorage.removeItem("token");
  checkAuth();
  showView(viewHome);
});

if (btnViewDatasets) {
  btnViewDatasets.addEventListener("click", () => {
    showView(viewDashboard);
    linkDashboard.classList.add("active");
    linkHome.classList.remove("active");
    loadDatasets();
  });
}

// Auth Logic
function checkAuth() {
  const token = localStorage.getItem("token");
  if (token) {
    linkAuth.style.display = "none";
    linkDashboard.style.display = "inline";
    linkLogout.style.display = "inline";
    if (btnViewDatasets) btnViewDatasets.style.display = "block";
  } else {
    linkAuth.style.display = "inline";
    linkDashboard.style.display = "none";
    linkLogout.style.display = "none";
    if (btnViewDatasets) btnViewDatasets.style.display = "none";
  }
}

authToggleLink.addEventListener("click", (e) => {
  e.preventDefault();
  isLoginMode = !isLoginMode;
  if (isLoginMode) {
    authTitle.textContent = "Welcome Back";
    btnAuthSubmit.textContent = "Login";
    authToggleText.textContent = "Don't have an account?";
    authToggleLink.textContent = "Register here";
  } else {
    authTitle.textContent = "Create Account";
    btnAuthSubmit.textContent = "Register";
    authToggleText.textContent = "Already have an account?";
    authToggleLink.textContent = "Login here";
  }
});

formAuth.addEventListener("submit", async (e) => {
  e.preventDefault();
  const endpoint = isLoginMode ? "/api/auth/login" : "/api/auth/register";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: authEmail.value, password: authPassword.value })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else if (data.token) {
      localStorage.setItem("token", data.token);
      checkAuth();
      showView(viewHome);
      authEmail.value = "";
      authPassword.value = "";
    }
  } catch (err) {
    alert("Authentication failed.");
  }
});

// Generator Logic
async function loadFormats() {
  try {
    const res = await fetch("/formats");
    const data = await res.json();
    const inputFormat = document.getElementById("format");
    if (inputFormat && data.formats) {
      inputFormat.innerHTML = "";
      data.formats.forEach((fmt) => {
        const opt = document.createElement("option");
        opt.value = fmt;
        opt.textContent = fmt;
        inputFormat.appendChild(opt);
      });
    }
  } catch (err) {}
}

let currentTaskId = null;
let currentDatasetId = null;

btnStart.addEventListener("click", async () => {
  const topic = document.getElementById("topic").value.trim();
  if (!topic) return alert("Enter a master topic.");

  btnStart.disabled = true;
  statTopic.textContent = "Starting...";
  statRecords.textContent = "0";
  progressFill.style.width = "0%";
  progressText.textContent = "0%";

  const payload = {
    topic,
    num_seed: parseInt(document.getElementById("num-seed").value, 10),
    max_outputs: parseInt(document.getElementById("max-outputs").value, 10),
    dataset_type: document.getElementById("dataset-type").value,
    output_format: document.getElementById("format").value,
    output_file: document.getElementById("output-file").value.trim()
  };

  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("token");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch("/start", { method: "POST", headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      btnStart.disabled = false;
      return;
    }
    
    currentTaskId = data.taskId;
    currentDatasetId = data.datasetId;
    pollStatus(data.taskId, payload.max_outputs);
  } catch (err) {
    alert("Failed to start generation.");
    btnStart.disabled = false;
  }
});

function pollStatus(taskId, maxOutputs) {
  if (pollInterval) clearInterval(pollInterval);
  
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/status/${taskId}`);
      const status = await res.json();

      statTopic.textContent = status.topic || "Generating...";
      statRecords.textContent = status.progress || 0;

      const pct = maxOutputs > 0 ? Math.min(100, Math.round((status.progress / maxOutputs) * 100)) : 0;
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `${pct}%`;

      if (status.state === "done" || status.state === "error") {
        clearInterval(pollInterval);
        btnStart.disabled = false;
        if (status.state === "done") {
          statTopic.textContent = "Finished!";
          progressFill.style.width = "100%";
          progressText.textContent = "100%";
          
          if (currentDatasetId) {
             window.location.href = `/download?datasetId=${currentDatasetId}`;
          } else {
             window.location.href = `/download?taskId=${currentTaskId}`;
          }
        } else {
          statTopic.textContent = "Error occurred.";
        }
      }
    } catch (e) {}
  }, 1000);
}

// Dashboard Logic
async function loadDatasets() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch("/api/datasets", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const datasets = await res.json();
    
    datasetsGrid.innerHTML = "";
    if (datasets.length === 0) {
      datasetsGrid.innerHTML = "<p>No datasets generated yet.</p>";
      return;
    }

    datasets.forEach(ds => {
      const card = document.createElement("div");
      card.className = "dataset-card";
      
      const date = new Date(ds.createdAt).toLocaleDateString();
      
      card.innerHTML = `
        <div class="ds-topic">${ds.topic}</div>
        <div class="ds-records">${ds.totalRecords || 0} Records</div>
        <div class="ds-date">${date}</div>
        <a href="/download?datasetId=${ds._id}" class="ds-download">Download</a>
      `;
      datasetsGrid.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to load datasets.");
  }
}