import { useEffect, useState } from "react";
import { getJob, downloadUrl } from "../api";

export default function Analytics({ jobId }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getJob(jobId).then((data) => {
      setJob(data);
      setLoading(false);
    });
  }, [jobId]);

  if (loading) return <div className="page-center"><p style={{ color: "var(--muted)" }}>Loading analytics...</p></div>;
  if (!job) return <div className="page-center"><p style={{ color: "var(--error)" }}>Job not found</p></div>;

  const m = job.metrics || {};
  
  return (
    <div className="analytics-view">
      <div className="analytics-header">
        <h1 className="analytics-title">{job.topic}</h1>
        <p className="analytics-meta" style={{ marginBottom: '0.5rem' }}>
          Generated {new Date(job.createdAt).toLocaleDateString()} • {job.status}
        </p>
        {job.config && (
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
            <span><strong style={{color: 'var(--text)'}}>Model:</strong> {job.config.model.split('/').pop()}</span>
            <span><strong style={{color: 'var(--text)'}}>Depth:</strong> {job.config.maxDepth}</span>
            <span><strong style={{color: 'var(--text)'}}>Max Topics:</strong> {job.config.maxNodes}</span>
            <span><strong style={{color: 'var(--text)'}}>Branching:</strong> {job.config.branchingFactor}</span>
            <span><strong style={{color: 'var(--text)'}}>Exchanges/Convo:</strong> {job.config.turns}</span>
          </div>
        )}
      </div>

      <div className="stats-grid">
        <div className="stat-card" style={{ '--delay': 1 }}>
          <div className="stat-value">{m.totalRecords || 0}</div>
          <div className="stat-label">Total Records</div>
        </div>
        <div className="stat-card" style={{ '--delay': 2 }}>
          <div className="stat-value">{m.avgTurns || 0}</div>
          <div className="stat-label">Avg Messages / Convo</div>
        </div>
        <div className="stat-card" style={{ '--delay': 3 }}>
          <div className="stat-value">{m.totalTokens || 0}</div>
          <div className="stat-label">Total Tokens (est.)</div>
        </div>
        <div className="stat-card" style={{ '--delay': 4 }}>
          <div className="stat-value">{m.avgSequenceLength || 0}</div>
          <div className="stat-label">Avg Sequence Length</div>
        </div>
        <div className="stat-card" style={{ '--delay': 5 }}>
          <div className="stat-value">{m.uniqueTopics || 0}</div>
          <div className="stat-label">Unique Topics</div>
        </div>
      </div>
      
      <h3 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Topics Explored</h3>
      <div className="topics-cloud" style={{ marginBottom: "3rem" }}>
        {job.topicsCovered?.map((t, i) => (
          <span key={i} className="topic-badge">{t}</span>
        )) || <span className="topic-badge">No topics recorded</span>}
      </div>

      <div style={{ display: "flex", gap: "1rem" }}>
        <a className="btn btn-primary" href={downloadUrl(job._id, "sharegpt")} download>
          Download ShareGPT
        </a>
        <a className="btn btn-outline" href={downloadUrl(job._id, "alpaca")} download>
          Download Alpaca
        </a>
      </div>
    </div>
  );
}
