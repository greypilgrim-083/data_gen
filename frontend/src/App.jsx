import { useState, useEffect } from "react";
import Auth from "./pages/Auth";
import Generate from "./pages/Generate";
import Analytics from "./pages/Analytics";
import { getJobs } from "./api";
import "./index.css";

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("token"));
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null); // null means "Generate new"
  const [runningJobId, setRunningJobId] = useState(null);
  
  const loadJobs = () => {
    if (authed) {
      getJobs().then(data => {
        if (data.error) {
          logout();
        } else {
          setJobs(Array.isArray(data) ? data : []);
        }
      });
    }
  };

  useEffect(() => {
    loadJobs();
  }, [authed]);

  const logout = () => {
    localStorage.removeItem("token");
    setAuthed(false);
  };

  const handleJobClick = (jobId) => {
    if (jobId === runningJobId) {
      setActiveJobId(null);
    } else {
      setActiveJobId(jobId);
    }
  };

  if (!authed) {
    return (
      <>
        <div className="bg-mesh">
          <div className="blob blob-1"></div>
          <div className="blob blob-2"></div>
        </div>
        <Auth onLogin={() => setAuthed(true)} />
      </>
    );
  }

  return (
    <>
      <div className="bg-mesh">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>
      <div className="app-container">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <div className="logo">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--accent-cyan)" />
                    <stop offset="100%" stopColor="var(--accent-purple)" />
                  </linearGradient>
                </defs>
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              DataGen
            </div>
          </div>

          <button
            className="btn btn-primary btn-block"
            onClick={() => setActiveJobId(null)}
            style={{ marginBottom: "1rem" }}
          >
            + New Dataset
          </button>

          <div style={{ flex: 1, overflowY: "auto" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600, padding: "0 0.5rem", marginBottom: "0.5rem", textTransform: "uppercase" }}>
              History
            </div>
            <div className="history-list">
              {jobs.length === 0 ? (
                <div style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.85rem", textAlign: "center" }}>No datasets yet</div>
              ) : (
                jobs.map(job => (
                  <div
                    key={job._id}
                    className={`history-item ${activeJobId === job._id ? 'active' : ''}`}
                    onClick={() => handleJobClick(job._id)}
                  >
                    <div className="history-topic">{job.topic}</div>
                    <div className="history-meta">
                      {new Date(job.createdAt).toLocaleDateString()} • {job.status === "running" ? "Running..." : `${job.metrics?.totalRecords || 0} rows`}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <button className="btn btn-ghost btn-block" onClick={logout}>Sign Out</button>
          </div>
        </div>

        {/* Main Content */}
        <div className="main-content">
          {activeJobId && (
            <div style={{ height: "100%", overflowY: "auto" }}>
              <Analytics key={activeJobId} jobId={activeJobId} />
            </div>
          )}
          <div style={{ display: activeJobId ? 'none' : 'block', height: '100%' }}>
            <Generate
              onJobCreated={(id) => {
                setRunningJobId(id);
                loadJobs();
              }}
              onNavigateAnalytics={(id) => {
                setRunningJobId(null);
                loadJobs();
                setActiveJobId(id);
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

