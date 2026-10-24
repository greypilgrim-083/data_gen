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
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loadJobs = () => {
    if (authed) {
      getJobs().then((data) => {
        if (data && data.error) {
          if (data.error.includes("expired") || data.error.includes("Authentication")) {
            logout();
          }
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
    setActiveJobId(null);
    setRunningJobId(null);
  };

  const handleJobClick = (jobId) => {
    if (jobId === runningJobId) {
      setActiveJobId(null);
    } else {
      setActiveJobId(jobId);
    }
  };

  if (!authed) {
    return <Auth onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="chatgpt-app">
      {/* Sidebar */}
      <aside className={`chatgpt-sidebar ${sidebarOpen ? "open" : "collapsed"}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand" onClick={() => setActiveJobId(null)}>
            <div className="brand-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <span className="brand-text">DataGen</span>
          </div>

          <button
            className="new-chat-btn"
            onClick={() => setActiveJobId(null)}
            title="Create new dataset"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>New Dataset</span>
          </button>
        </div>

        <div className="sidebar-history-container">
          <div className="history-section-label">Your Datasets</div>
          <div className="history-list">
            {jobs.length === 0 ? (
              <div className="history-empty">No datasets generated yet</div>
            ) : (
              jobs.map((job) => (
                <button
                  key={job._id}
                  className={`history-item-btn ${activeJobId === job._id ? "active" : ""}`}
                  onClick={() => handleJobClick(job._id)}
                  title={job.topic}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="history-icon">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <div className="history-info">
                    <span className="history-title">{job.topic}</span>
                    <span className="history-sub">
                      {job.status === "running" ? (
                        <span className="badge-running">● Running</span>
                      ) : (
                        `${job.metrics?.totalRecords || 0} rows`
                      )}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="user-profile-btn" onClick={logout} title="Sign Out">
            <div className="user-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <span className="user-label">Sign Out</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto", opacity: 0.6 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="chatgpt-main">
        {activeJobId ? (
          <div className="main-scrollable">
            <Analytics
              key={activeJobId}
              jobId={activeJobId}
              onBack={() => setActiveJobId(null)}
            />
          </div>
        ) : (
          <div className="main-scrollable">
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
        )}
      </main>
    </div>
  );
}
