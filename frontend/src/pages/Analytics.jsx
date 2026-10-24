import { useEffect, useState, useRef } from "react";
import { getJob, downloadUrl, stopJob } from "../api";

export default function Analytics({ jobId, onBack, onNavigateDatasets }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedSampleIdx, setExpandedSampleIdx] = useState(0); // first sample expanded by default
  const [samplesFilter, setSamplesFilter] = useState("");
  const [stopping, setStopping] = useState(false);
  const pollTimerRef = useRef(null);

  const fetchJobDetails = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const data = await getJob(jobId);
      setJob(data);
    } catch (err) {
      console.error("Error fetching job details:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobDetails(true);

    // Set up polling while job is running
    pollTimerRef.current = setInterval(async () => {
      try {
        const data = await getJob(jobId);
        setJob(data);
        if (data && data.status !== "running") {
          clearInterval(pollTimerRef.current);
        }
      } catch (e) {
        // ignore transient poll error
      }
    }, 2500);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [jobId]);

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopJob(jobId);
      await fetchJobDetails(false);
    } catch (err) {
      alert("Failed to stop job: " + err.message);
    } finally {
      setStopping(false);
    }
  };

  if (loading) {
    return (
      <div className="analytics-loading-container">
        <div className="spinner-dots">
          <span></span><span></span><span></span>
        </div>
        <p>Loading dataset details & samples...</p>
      </div>
    );
  }

  if (!job || job.error) {
    return (
      <div className="analytics-error-container">
        <p>Dataset not found or failed to load.</p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
          {onBack && (
            <button className="chatgpt-btn chatgpt-btn-ghost btn-sm" onClick={onBack}>
              ← New Dataset
            </button>
          )}
          {onNavigateDatasets && (
            <button className="chatgpt-btn chatgpt-btn-primary btn-sm" onClick={onNavigateDatasets}>
              View All Datasets
            </button>
          )}
        </div>
      </div>
    );
  }

  const m = job.metrics || {};
  const cfg = job.config || {};
  const samples = job.samples || [];

  const filteredSamples = samplesFilter
    ? samples.filter((s) => {
        const fullText = (s.conversations || []).map((c) => c.value).join(" ");
        return fullText.toLowerCase().includes(samplesFilter.toLowerCase());
      })
    : samples;

  return (
    <div className="chatgpt-analytics-view">
      {/* Top Navigation Bar */}
      <div className="analytics-top-nav">
        <div className="nav-left">
          {onNavigateDatasets && (
            <button className="back-link-btn" onClick={onNavigateDatasets}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>All Datasets</span>
            </button>
          )}
          {onBack && (
            <button className="back-link-btn" onClick={onBack} style={{ marginLeft: "1rem" }}>
              <span>+ New Dataset</span>
            </button>
          )}
        </div>

        <div className="nav-right">
          <button className="chatgpt-btn chatgpt-btn-ghost btn-sm" onClick={() => fetchJobDetails(false)} title="Refresh">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span>Refresh</span>
          </button>

          {job.status === "running" && (
            <button
              className="chatgpt-btn chatgpt-btn-ghost btn-sm"
              style={{ color: "var(--accent-red)", borderColor: "rgba(239, 68, 68, 0.4)" }}
              onClick={handleStop}
              disabled={stopping}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              </svg>
              <span>{stopping ? "Stopping..." : "Stop Job"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Dataset Header */}
      <div className="analytics-header">
        <div className="title-row">
          <h1 className="dataset-title">{job.topic}</h1>
          <span
            className={`status-pill ${
              job.status === "done" ? "status-done" : job.status === "running" ? "status-running" : "status-failed"
            }`}
          >
            {job.status === "done" ? "Completed" : job.status === "running" ? "● Running" : "Failed"}
          </span>
        </div>

        <p className="dataset-meta">
          Created on{" "}
          {new Date(job.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>

        <div className="config-badges-row">
          <span className="cfg-badge">
            <strong>Model:</strong> {cfg.model ? cfg.model.split("/").pop() : "unknown"}
          </span>
          <span className="cfg-badge">
            <strong>Depth:</strong> {cfg.maxDepth || 2}
          </span>
          <span className="cfg-badge">
            <strong>Max Topics:</strong> {cfg.maxNodes || 10}
          </span>
          <span className="cfg-badge">
            <strong>Branching:</strong> {cfg.branchingFactor || 3}
          </span>
          <span className="cfg-badge">
            <strong>Exchanges:</strong> {cfg.turns || 4}
          </span>
          {cfg.assistantPersona && (
            <span className="cfg-badge">
              <strong>Persona:</strong> {cfg.assistantPersona}
            </span>
          )}
        </div>
      </div>

      {/* Metrics Stat Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-val">{samples.length || m.totalRecords || 0}</div>
          <div className="metric-lbl">Total Samples</div>
        </div>

        <div className="metric-card">
          <div className="metric-val">{job.topicsCovered?.length || m.uniqueTopics || 0}</div>
          <div className="metric-lbl">Topics Explored</div>
        </div>

        <div className="metric-card">
          <div className="metric-val">{m.avgTurns || (samples.length ? "4.0" : 0)}</div>
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

      {/* Topics Explored Cloud */}
      <div className="analytics-section">
        <h3 className="section-title">Subtopics Explored ({job.topicsCovered?.length || 0})</h3>
        <div className="topics-cloud">
          {job.topicsCovered && job.topicsCovered.length > 0 ? (
            job.topicsCovered.map((topicName, idx) => (
              <span key={idx} className="topic-pill">
                {topicName}
              </span>
            ))
          ) : (
            <span className="topic-pill empty">No subtopics recorded yet</span>
          )}
        </div>
      </div>

      {/* Export Section */}
      <div className="export-section">
        <h3 className="section-title">Export Dataset ({samples.length} records ready)</h3>
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
            <span>Download ShareGPT (JSONL)</span>
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
            <span>Download Alpaca (JSONL)</span>
          </a>
        </div>
      </div>

      {/* Dataset Samples Inspector */}
      <div className="analytics-section" style={{ marginTop: "3rem" }}>
        <div className="section-header-row">
          <div>
            <h3 className="section-title" style={{ marginBottom: "0.25rem" }}>
              Generated Dataset Samples ({samples.length})
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Inspect the exact multi-turn synthetic dialogue pairs synthesized for your dataset
            </p>
          </div>

          {samples.length > 3 && (
            <input
              type="text"
              className="chatgpt-samples-filter-input"
              placeholder="Search sample dialogues..."
              value={samplesFilter}
              onChange={(e) => setSamplesFilter(e.target.value)}
            />
          )}
        </div>

        {samples.length === 0 ? (
          <div className="samples-empty-banner">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div>
              {job.status === "running"
                ? "Samples are currently generating... Click Refresh or wait for the next node to finish."
                : "No samples generated for this dataset yet."}
            </div>
          </div>
        ) : (
          <div className="samples-list-accordion">
            {filteredSamples.map((sample, sIdx) => {
              const isExpanded = expandedSampleIdx === sIdx;
              const convos = sample.conversations || [];
              const sampleTopic = sample.metadata?.topic || job.topic;
              const sampleDepth = sample.metadata?.depth ?? 0;
              const firstUserMsg = convos.find((c) => c.from === "human")?.value || "";

              return (
                <div key={sIdx} className={`sample-accordion-card ${isExpanded ? "expanded" : ""}`}>
                  <div
                    className="sample-card-header"
                    onClick={() => setExpandedSampleIdx(isExpanded ? null : sIdx)}
                  >
                    <div className="sample-header-left">
                      <span className="sample-number-badge">#{sIdx + 1}</span>
                      <div className="sample-snippet-wrap">
                        <span className="sample-topic-tag">{sampleTopic}</span>
                        <p className="sample-first-line">
                          {firstUserMsg.substring(0, 110)}...
                        </p>
                      </div>
                    </div>

                    <div className="sample-header-right">
                      <span className="sample-turns-badge">
                        {convos.length} turns (depth {sampleDepth})
                      </span>
                      <span className="accordion-chevron">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="sample-card-body">
                      <div className="conversation-turns-thread">
                        {convos.map((turn, tIdx) => {
                          const isHuman = turn.from === "human";
                          return (
                            <div
                              key={tIdx}
                              className={`convo-turn-row ${isHuman ? "turn-human" : "turn-assistant"}`}
                            >
                              <div className="turn-avatar-badge">
                                {isHuman ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="12" cy="7" r="4"></circle>
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                                  </svg>
                                )}
                              </div>

                              <div className="turn-content-box">
                                <div className="turn-role-label">
                                  {isHuman ? "Human / User Persona" : "Assistant (LLM Response)"}
                                </div>
                                <div className="turn-text-content">{turn.value}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="sample-footer-actions">
                        <button
                          className="copy-json-btn"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(sample, null, 2));
                            alert("Copied sample JSON to clipboard!");
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                          <span>Copy Sample JSON</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
