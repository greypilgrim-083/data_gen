const BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:5000" : "https://data-gen-1.onrender.com");

const getToken = () => localStorage.getItem("token");

const headers = (extra = {}) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getToken()}`,
  ...extra,
});

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

export function streamJob(jobId, apiKey, onEvent) {
  const url = `${BASE}/jobs/${jobId}/stream?apiKey=${encodeURIComponent(apiKey)}`;
  const source = new EventSource(url + `&token=${getToken()}`);
  // EventSource doesn't support custom headers, so we pass token as query param
  // Backend needs to support this — handled below
  source.onmessage = (e) => onEvent(JSON.parse(e.data));
  source.onerror = () => source.close();
  return source;
}

export function downloadUrl(jobId, format = "sharegpt") {
  return `${BASE}/jobs/${jobId}/download?format=${format}&token=${getToken()}`;
}
