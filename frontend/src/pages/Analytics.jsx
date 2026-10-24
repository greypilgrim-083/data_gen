import { useEffect, useState } from "react";
import { getJob, downloadUrl } from "../api";

export default function Analytics({ jobId, onBack }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getJob(jobId).then((data) => {
      setJob(data);
      setLoading(false);
    });
  }, [jobId]);

  if (loading) {
    return (
      <div className="analytics-loading-container">
        <div className="spinner-dots">
          <span></span><span></span><span></span>
        </div>
        <p>Loading dataset analytics...</p>
      </div>
    );
  }

  if (!job || job.error) {
    return (
      <div className="analytics-error-container">
        <p>Dataset not found or failed to load.</p>
        {onBack && (
          <button className="chatgpt-btn chatgpt-btn-ghost" onClick={onBack}>
            ← Back to Generator
          </button>
        )}
      </div>
    );
  }

  const m = job.metrics || {};
  const cfg = job.config || {};

  return (
    <div className="chatgpt-analytics-view">
      <div className="analytics-top-nav">
        {onBack && (
          <button className="back-link-btn" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>New Dataset</span>
          </button>
        )}
      </div>

      <div className="analytics-header">
        <div className="title-row">
          <h1 className="dataset-title">{job.topic}</h1>
          <span className={`status-pill ${job.status === "done" ? "status-done" : job.status === "running" ? "status-running" : "status-failed"}`}>
            {job.status === "done" ? "Completed" : job.status}
          </span>
        </div>

        <p className="dataset-meta">
          Created on {new Date(job.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>

        <div className="config-badges-row">
          <span className="cfg-badge"><strong>Model:</strong> {cfg.model ? cfg.model.split("/").pop() : "unknown"}</span>
          <span className="cfg-badge"><strong>Depth:</strong> {cfg.maxDepth || 2}</span>
          <span className="cfg-badge"><strong>Max Topics:</strong> {cfg.maxNodes || 10}</span>
          <span className="cfg-badge"><strong>Branching:</strong> {cfg.branchingFactor || 3}</span>
          <span className="cfg-badge"><strong>Exchanges:</strong> {cfg.turns || 5}</span>
          {cfg.assistantPersona && <span className="cfg-badge"><strong>Persona:</strong> {cfg.assistantPersona}</span>}
        </div>
      </div>

      {/* Metrics Stat Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-val">{m.totalRecords || 0}</div>
          <div className="metric-lbl">Total Samples</div>
        </div>

        <div className="metric-card">
          <div className="metric-val">{m.uniqueTopics || 0}</div>
          <div className="metric-lbl">Topics Explored</div>
        </div>

        <div className="metric-card">
          <div className="metric-val">{m.avgTurns || 0}</div>
          <div className="metric-lbl">Avg Exchanges</div>
        </div>

        <div className="metric-card">
          <div className="metric-val">{(m.totalTokens || 0).toLocaleString()}</div>
          <div className="metric-lbl">Estimated Tokens</div>
        </div>

        <div className="metric-card">
          <div className="metric-val">{m.avgSequenceLength || 0}</div>
          <div className="metric-lbl">Avg Sequence Len</div>
        </div>
      </div>

      {/* Topics Discovered */}
      <div className="analytics-section">
        <h3 className="section-title">Subtopics Explored</h3>
        <div className="topics-cloud">
          {job.topicsCovered && job.topicsCovered.length > 0 ? (
            job.topicsCovered.map((topicName, idx) => (
              <span key={idx} className="topic-pill">
                {topicName}
              </span>
            ))
          ) : (
            <span className="topic-pill empty">No subtopics recorded</span>
          )}
        </div>
      </div>

      {/* Download Export Buttons */}
      <div className="export-section">
        <h3 className="section-title">Export Dataset</h3>
        <div className="export-buttons-group">
          <a
            className="chatgpt-btn chatgpt-btn-primary download-btn"
            href={downloadUrl(job._id, "sharegpt")}
            download
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Download ShareGPT JSONL</span>
          </a>

          <a
            className="chatgpt-btn chatgpt-btn-ghost download-btn"
            href={downloadUrl(job._id, "alpaca")}
            download
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Download Alpaca JSONL</span>
          </a>
        </div>
      </div>
    </div>
  );
}
