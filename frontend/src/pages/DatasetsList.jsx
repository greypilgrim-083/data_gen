import { useState, useMemo } from "react";
import { downloadUrl, deleteJob } from "../api";

export default function DatasetsList({ jobs, onSelectJob, onNewDataset, onRefresh }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [deletingId, setDeletingId] = useState(null);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchSearch =
        (job.topic || "").toLowerCase().includes(search.toLowerCase()) ||
        (job.config?.model || "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "all" || job.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [jobs, search, filterStatus]);

  const totalSamples = useMemo(() => {
    return jobs.reduce((acc, j) => acc + (j.sampleCount || j.metrics?.totalRecords || 0), 0);
  }, [jobs]);

  const handleDelete = async (e, jobId) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this dataset?")) return;
    setDeletingId(jobId);
    try {
      await deleteJob(jobId);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert("Failed to delete dataset: " + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="chatgpt-datasets-page">
      <div className="datasets-header-row">
        <div>
          <h1 className="datasets-main-title">My Datasets</h1>
          <p className="datasets-subtitle">
            Manage, inspect conversation samples, and export your synthetic datasets
          </p>
        </div>

        <div className="header-action-buttons">
          <button className="chatgpt-btn chatgpt-btn-ghost btn-sm" onClick={onRefresh} title="Refresh dataset list">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span>Refresh</span>
          </button>

          <button className="chatgpt-btn chatgpt-btn-primary btn-sm" onClick={onNewDataset}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>New Dataset</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="datasets-kpi-bar">
        <div className="kpi-card">
          <div className="kpi-value">{jobs.length}</div>
          <div className="kpi-label">Total Datasets</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{totalSamples.toLocaleString()}</div>
          <div className="kpi-label">Total Samples Generated</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">
            {jobs.filter((j) => j.status === "done").length}
          </div>
          <div className="kpi-label">Completed Datasets</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="datasets-filter-bar">
        <div className="datasets-search-wrapper">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="search-icon">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className="datasets-search-input"
            placeholder="Search datasets by topic or model..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="clear-search-btn" onClick={() => setSearch("")}>✕</button>
          )}
        </div>

        <div className="status-filter-pills">
          {["all", "done", "running", "failed"].map((st) => (
            <button
              key={st}
              className={`filter-pill ${filterStatus === st ? "active" : ""}`}
              onClick={() => setFilterStatus(st)}
            >
              {st === "all" ? "All" : st === "done" ? "Completed" : st === "running" ? "Running" : "Failed"}
            </button>
          ))}
        </div>
      </div>

      {/* Datasets Table / List */}
      {filteredJobs.length === 0 ? (
        <div className="datasets-empty-box">
          <div className="empty-icon-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <h3>{search || filterStatus !== "all" ? "No matching datasets" : "No datasets created yet"}</h3>
          <p>{search || filterStatus !== "all" ? "Try clearing your search filters" : "Generate your first synthetic dialogue dataset"}</p>
          {!search && filterStatus === "all" && (
            <button className="chatgpt-btn chatgpt-btn-primary btn-sm" onClick={onNewDataset} style={{ marginTop: "1rem" }}>
              + Create Dataset
            </button>
          )}
        </div>
      ) : (
        <div className="datasets-cards-list">
          {filteredJobs.map((job) => {
            const count = job.sampleCount || job.metrics?.totalRecords || 0;
            const modelName = job.config?.model ? job.config.model.split("/").pop() : "unknown";
            const dateStr = new Date(job.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div key={job._id} className="dataset-row-card" onClick={() => onSelectJob(job._id)}>
                <div className="dataset-row-main">
                  <div className="dataset-row-top">
                    <h3 className="dataset-row-title" title={job.topic}>
                      {job.topic}
                    </h3>
                    <span
                      className={`status-pill ${
                        job.status === "done" ? "status-done" : job.status === "running" ? "status-running" : "status-failed"
                      }`}
                    >
                      {job.status === "done" ? "Completed" : job.status === "running" ? "● Running" : "Failed"}
                    </span>
                  </div>

                  <div className="dataset-row-meta">
                    <span className="meta-item">
                      <strong>Model:</strong> {modelName}
                    </span>
                    <span className="meta-separator">•</span>
                    <span className="meta-item">
                      <strong>Samples:</strong> {count}
                    </span>
                    <span className="meta-separator">•</span>
                    <span className="meta-item">
                      <strong>Topics:</strong> {job.topicsCovered?.length || 0}
                    </span>
                    <span className="meta-separator">•</span>
                    <span className="meta-item">{dateStr}</span>
                  </div>

                  {job.topicsCovered && job.topicsCovered.length > 0 && (
                    <div className="dataset-row-subtopics">
                      {job.topicsCovered.slice(0, 4).map((top, idx) => (
                        <span key={idx} className="subtopic-tag">
                          {top}
                        </span>
                      ))}
                      {job.topicsCovered.length > 4 && (
                        <span className="subtopic-tag more">+{job.topicsCovered.length - 4} more</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="dataset-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="action-btn-inspect"
                    onClick={() => onSelectJob(job._id)}
                    title="View dataset metrics and conversation samples"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <span>View & Inspect</span>
                  </button>

                  <a
                    className="action-btn-download"
                    href={downloadUrl(job._id, "sharegpt")}
                    download
                    title="Download ShareGPT JSONL"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span>ShareGPT</span>
                  </a>

                  <a
                    className="action-btn-download"
                    href={downloadUrl(job._id, "alpaca")}
                    download
                    title="Download Alpaca JSONL"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span>Alpaca</span>
                  </a>

                  <button
                    className="action-btn-delete"
                    disabled={deletingId === job._id}
                    onClick={(e) => handleDelete(e, job._id)}
                    title="Delete dataset"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
