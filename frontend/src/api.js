export const BASE = import.meta.env.DEV ? "http://localhost:5000" : "";

const getToken = () => localStorage.getItem("token") || "";

const headers = (extra = {}) => {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
};

export async function getConfig() {
  try {
    const res = await fetch(`${BASE}/api/config`);
    return await res.json();
  } catch (err) {
    console.error("Failed to load config:", err);
    return { hasServerApiKey: false, defaultModel: "meta-llama/llama-3.3-70b-instruct:free" };
  }
}

export async function register(email, password) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

export async function createJob(payload) {
  const res = await fetch(`${BASE}/jobs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getJobs() {
  const res = await fetch(`${BASE}/jobs`, { headers: headers() });
  return res.json();
}

export async function getJob(id) {
  const res = await fetch(`${BASE}/jobs/${id}`, { headers: headers() });
  return res.json();
}

export function downloadUrl(jobId, format = "sharegpt") {
  return `${BASE}/jobs/${jobId}/download?format=${format}&token=${encodeURIComponent(getToken())}`;
}
