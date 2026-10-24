import { useState } from "react";
import { login, register } from "../api";

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fn = mode === "login" ? login : register;
    try {
      const res = await fn(email, password);
      setLoading(false);
      if (res && res.token) {
        localStorage.setItem("token", res.token);
        onLogin();
      } else {
        setError(res?.error || "Authentication failed. Please verify your credentials.");
      }
    } catch (err) {
      setLoading(false);
      setError("Network or server connection error: " + err.message);
    }
  };

  return (
    <div className="chatgpt-auth-page">
      <div className="auth-card-wrapper">
        <div className="auth-logo-row">
          <div className="auth-logo-badge">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <span className="auth-brand-name">DataGen</span>
        </div>

        <h1 className="auth-heading">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="auth-subheading">
          {mode === "login"
            ? "Log in to synthesize and export LLM datasets"
            : "Sign up to start generating multi-turn dialogue datasets"}
        </p>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-input-group">
            <label className="auth-label">Email address</label>
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div className="auth-input-group">
            <label className="auth-label">Password</label>
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setEmail ? setPassword(e.target.value) : null}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="auth-error-banner">{error}</div>}

          <button className="chatgpt-btn chatgpt-btn-primary auth-submit-btn" type="submit" disabled={loading}>
            {loading ? "Processing..." : mode === "login" ? "Continue" : "Sign Up"}
          </button>
        </form>

        <div className="auth-switch-text">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="auth-switch-link"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}
