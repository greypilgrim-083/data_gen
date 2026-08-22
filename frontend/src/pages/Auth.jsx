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
    const res = await fn(email, password);
    setLoading(false);
    if (res.token) {
      localStorage.setItem("token", res.token);
      onLogin();
    } else {
      setError(res.error || "Something went wrong");
    }
  };

  return (
    <div className="page-center">
      <div className="card auth-card">
        <h1 className="auth-title">{mode === "login" ? "Welcome back" : "Create account"}</h1>
        <p className="auth-sub">Synthetic dataset generator</p>
        <form className="form" onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Login" : "Register"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "No account? " : "Have an account? "}
          <a onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Register" : "Login"}
          </a>
        </p>
      </div>
    </div>
  );
}
