import { useState, useRef, useEffect } from "react";
import { createJob, getConfig, stopJob, deleteJob, BASE } from "../api";


const PRESET_MODELS = [
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)", badge: "Free" },
  { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash (Free)", badge: "Free" },
  { id: "meta-llama/llama-3.1-8b-instruct:free", name: "Llama 3.1 8B (Free)", badge: "Free" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3", badge: "Fast & Cheap" },
  { id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o Mini", badge: "Smart" },
  { id: "custom", name: "Custom OpenRouter Model...", badge: "Custom" },
];

const STARTER_PROMPTS = [
  "Advanced Python asyncio, memory leaks, and concurrency edge cases",
  "TypeScript design patterns, generics, and type gymnastics",
  "Distributed systems architecture, raft consensus, and failure modes",
  "PostgreSQL query optimization, indexing strategies, and execution plans",
];

export default function Generate({ onJobCreated, onNavigateAnalytics }) {
  const [topic, setTopic] = useState("");
  const [apiKey, setApiKey] = useState(localStorage.getItem("or_api_key") || "");
  const [hasServerKey, setHasServerKey] = useState(false);
  const [modelPreset, setModelPreset] = useState("meta-llama/llama-3.3-70b-instruct:free");
  const [customModel, setCustomModel] = useState("");
  const [maxDepth, setMaxDepth] = useState(2);
  const [maxNodes, setMaxNodes] = useState(6);
  const [maxRecords, setMaxRecords] = useState(20);
  const [branchingFactor, setBranchingFactor] = useState(3);
  const [turns, setTurns] = useState(4);
  const [scenariosPerNode, setScenariosPerNode] = useState(3);
  const [assistantPersona, setAssistantPersona] = useState("random");


  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [samplesCount, setSamplesCount] = useState(0);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [logs, setLogs] = useState([]);
  const [apiErrorPopup, setApiErrorPopup] = useState(null);
  const esRef = useRef(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    getConfig().then((cfg) => {
      if (cfg?.hasServerApiKey) {
        setHasServerKey(true);
      }
      if (cfg?.defaultModel && !localStorage.getItem("or_model")) {
        setModelPreset(cfg.defaultModel);
      }
    });
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const activeModel = modelPreset === "custom" ? customModel.trim() || "meta-llama/llama-3.3-70b-instruct:free" : modelPreset;

  const handleSaveKey = (newKey) => {
    const trimmed = newKey.trim();
    setApiKey(trimmed);
    if (trimmed) {
      localStorage.setItem("or_api_key", trimmed);
    } else {
      localStorage.removeItem("or_api_key");
    }
    setShowKeyModal(false);
  };

  const start = async (e) => {
    if (e) e.preventDefault();
    if (!topic.trim()) return;

    const keyToUse = apiKey.trim();
    if (!keyToUse && !hasServerKey) {
      setShowKeyModal(true);
      return;
    }

    setRunning(true);
    setProgress(5);
    setStatusText("Initializing dataset generation job on OpenRouter...");
    setLogs([{ text: `Starting job with topic: "${topic.trim()}" | Model: ${activeModel}`, time: new Date().toLocaleTimeString() }]);

    const { jobId, error } = await createJob({
      topic: topic.trim(),
      maxDepth,
      maxNodes,
      maxRecords,
      branchingFactor,
      model: activeModel,
      turns,
      assistantPersona,
      scenariosPerNode,
    });


    if (error) {
      setStatusText(`Error: ${error}`);
      setRunning(false);
      setApiErrorPopup(error);
      return;
    }

    setCurrentJobId(jobId);
    setSamplesCount(0);
    if (onJobCreated) onJobCreated(jobId);

    const token = localStorage.getItem("token") || "";
    const keyParam = keyToUse ? `apiKey=${encodeURIComponent(keyToUse)}` : "";
    const url = `${BASE}/jobs/${jobId}/stream?${keyParam}&token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    esRef.current = es;

    let currentSamples = 0;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);

        if (evt.event === "node_start") {
          const msg = `Exploring topic (${evt.processedCount || 1}/${evt.maxNodes || maxNodes}): "${evt.topic}" (depth ${evt.depth})`;
          setStatusText(msg);
          setLogs((prev) => [...prev.slice(-40), { text: msg, time: new Date().toLocaleTimeString() }]);
        } else if (evt.event === "scenarios_ready") {
          const msg = `Generated ${evt.count} personas/scenarios for "${evt.topic}"`;
          setStatusText(msg);
          setLogs((prev) => [...prev.slice(-40), { text: msg, time: new Date().toLocaleTimeString() }]);
        } else if (evt.event === "convo_generated") {
          currentSamples = evt.totalSamples;
          setSamplesCount(currentSamples);
          const targetLimit = evt.maxRecords || maxRecords;
          const msg = `Sample #${currentSamples}${targetLimit ? ` / ${targetLimit}` : ""} generated for "${evt.topic}" (${evt.turns} turns)`;
          setStatusText(msg);
          setLogs((prev) => [...prev.slice(-40), { text: msg, time: new Date().toLocaleTimeString() }]);
          const estTotal = targetLimit || (maxNodes * scenariosPerNode);
          setProgress(Math.min(5 + Math.round((currentSamples / estTotal) * 92), 98));
        } else if (evt.event === "scenario_skip") {

          const msg = `Notice: ${evt.message}`;
          setLogs((prev) => [...prev.slice(-40), { text: msg, time: new Date().toLocaleTimeString(), warn: true }]);
        } else if (evt.event === "subtopics_found") {
          const msg = `Discovered subtopics: ${evt.subtopics.slice(0, 3).join(", ")}`;
          setLogs((prev) => [...prev.slice(-40), { text: msg, time: new Date().toLocaleTimeString() }]);
        } else if (evt.event === "warning") {
          setLogs((prev) => [...prev.slice(-40), { text: evt.message, time: new Date().toLocaleTimeString(), warn: true }]);
        } else if (evt.event === "job_complete") {
          setProgress(100);
          setStatusText(`Complete! Generated ${evt.totalSamples} dataset records across ${evt.topicsCovered?.length || 0} topics.`);
          setLogs((prev) => [...prev.slice(-40), { text: `Job finished successfully! Total samples: ${evt.totalSamples}`, time: new Date().toLocaleTimeString() }]);
          es.close();
          setRunning(false);
          setTimeout(() => onNavigateAnalytics(jobId), 1200);
        } else if (evt.event === "error") {
          setStatusText(`Error: ${evt.message}`);
          setLogs((prev) => [...prev.slice(-40), { text: `Fatal error: ${evt.message}`, time: new Date().toLocaleTimeString(), error: true }]);
          es.close();
          setRunning(false);
          setApiErrorPopup(evt.message);
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    es.onerror = () => {
      es.close();
      setRunning(false);
      setStatusText("Connection closed.");
    };
  };

  const stop = () => {
    esRef.current?.close();
    setRunning(false);
    setStatusText("Dataset generation stopped by user.");
    setLogs((prev) => [...prev, { text: "Stopped by user.", time: new Date().toLocaleTimeString(), warn: true }]);
    setShowCancelModal(true);
  };

  const handleKeepDataset = async () => {
    if (currentJobId) {
      try {
        await stopJob(currentJobId);
      } catch (err) {
        console.error("Error finalizing dataset on stop:", err);
      }
      setShowCancelModal(false);
      onNavigateAnalytics(currentJobId);
    } else {
      setShowCancelModal(false);
    }
  };

  const handleDiscardDataset = async () => {
    if (currentJobId) {
      setIsDiscarding(true);
      try {
        await deleteJob(currentJobId);
      } catch (err) {
        console.error("Error discarding dataset:", err);
      } finally {
        setIsDiscarding(false);
      }
    }
    setShowCancelModal(false);
    setRunning(false);
    setProgress(0);
    setStatusText("");
    setLogs([]);
    setCurrentJobId(null);
    setSamplesCount(0);
  };


  const isKeyReady = Boolean(apiKey.trim() || hasServerKey);

  return (
    <div className="chatgpt-generate-container">
      {/* Key Setup Modal */}
      {showKeyModal && (
        <div className="chatgpt-modal-overlay" onClick={() => setShowKeyModal(false)}>
          <div className="chatgpt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>OpenRouter API Key</h3>
              <button className="modal-close-btn" onClick={() => setShowKeyModal(false)}>✕</button>
            </div>
            <p className="modal-desc">
              Your API key is used directly to call OpenRouter models. Keys are stored locally in your browser session.
              {hasServerKey && (
                <span className="server-key-note"> (A server-side default key is currently active)</span>
              )}
            </p>
            <div className="modal-field">
              <label>API Key</label>
              <input
                type="password"
                placeholder={hasServerKey ? "Leave blank to use server environment key" : "sk-or-v1-..."}
                defaultValue={apiKey}
                id="modalApiKeyInput"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button
                className="chatgpt-btn chatgpt-btn-ghost"
                onClick={() => handleSaveKey("")}
              >
                Clear Key
              </button>
              <button
                className="chatgpt-btn chatgpt-btn-primary"
                onClick={() => {
                  const val = document.getElementById("modalApiKeyInput")?.value || "";
                  handleSaveKey(val);
                }}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced BFS Parameters Modal */}
      {showConfigModal && (
        <div className="chatgpt-modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div className="chatgpt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Dataset BFS Generation Parameters</h3>
              <button className="modal-close-btn" onClick={() => setShowConfigModal(false)}>✕</button>
            </div>
            
            <div className="modal-grid">
              <div className="modal-slider-field" style={{ backgroundColor: "#262626", padding: "0.85rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div className="slider-label-row">
                  <span>Target Records (Break Limit): <strong style={{ color: "var(--accent-green)", fontSize: "1.05rem" }}>{maxRecords}</strong></span>
                  <span className="slider-hint">Stops immediately upon reaching target</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={maxRecords}
                  onChange={(e) => setMaxRecords(+e.target.value)}
                  disabled={running}
                  style={{ marginTop: "0.5rem" }}
                />
                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
                  {[10, 20, 30, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      className={`filter-pill ${maxRecords === num ? "active" : ""}`}
                      style={{ padding: "0.2rem 0.6rem", fontSize: "0.75rem" }}
                      onClick={() => setMaxRecords(num)}
                    >
                      {num} records
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal-field">
                <label>Assistant Persona</label>

                <select
                  value={assistantPersona}
                  onChange={(e) => setAssistantPersona(e.target.value)}
                  disabled={running}
                >
                  <option value="random">Randomize (General Diversity)</option>
                  <option value="principal_engineer">Principal Engineer</option>
                  <option value="patient_tutor">Patient Tutor</option>
                  <option value="pragmatic_senior">Pragmatic Senior</option>
                  <option value="competitive_programmer">Competitive Programmer</option>
                  <option value="security_focused_engineer">Security-Focused Engineer</option>
                </select>
              </div>

              <div className="modal-slider-field">
                <div className="slider-label-row">
                  <span>Depth: <strong>{maxDepth}</strong></span>
                  <span className="slider-hint">BFS tree depth</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(+e.target.value)}
                  disabled={running}
                />
              </div>

              <div className="modal-slider-field">
                <div className="slider-label-row">
                  <span>Max Topics: <strong>{maxNodes}</strong></span>
                  <span className="slider-hint">Total topic nodes explored</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={25}
                  value={maxNodes}
                  onChange={(e) => setMaxNodes(+e.target.value)}
                  disabled={running}
                />
              </div>

              <div className="modal-slider-field">
                <div className="slider-label-row">
                  <span>Samples / Topic: <strong>{scenariosPerNode}</strong></span>
                  <span className="slider-hint">Scenarios per topic</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={scenariosPerNode}
                  onChange={(e) => setScenariosPerNode(+e.target.value)}
                  disabled={running}
                />
              </div>

              <div className="modal-slider-field">
                <div className="slider-label-row">
                  <span>Branching: <strong>{branchingFactor}</strong></span>
                  <span className="slider-hint">Subtopics extracted / node</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={branchingFactor}
                  onChange={(e) => setBranchingFactor(+e.target.value)}
                  disabled={running}
                />
              </div>

              <div className="modal-slider-field">
                <div className="slider-label-row">
                  <span>Exchanges / Dialogue: <strong>{turns}</strong></span>
                  <span className="slider-hint">User + AI turn pairs</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  value={turns}
                  onChange={(e) => setTurns(+e.target.value)}
                  disabled={running}
                />
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: "1.5rem" }}>
              <button
                className="chatgpt-btn chatgpt-btn-primary"
                onClick={() => setShowConfigModal(false)}
              >
                Apply Parameters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="chatgpt-modal-overlay">
          <div className="chatgpt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Generation Stopped</h3>
            </div>
            <p className="modal-desc" style={{ fontSize: "0.95rem", lineHeight: "1.5" }}>
              You stopped generation for <strong>"{topic}"</strong>.
              <br /><br />
              {samplesCount > 0 ? (
                <>
                  <strong>{samplesCount} conversation sample{samplesCount === 1 ? "" : "s"}</strong> were successfully generated and saved before stopping.
                  <br /><br />
                  Would you like to <strong>keep</strong> this dataset or <strong>discard</strong> it?
                </>
              ) : (
                <>
                  No samples were completed before stopping.
                </>
              )}
            </p>

            <div className="modal-actions" style={{ justifyContent: "space-between", marginTop: "1.5rem" }}>
              <button
                className="chatgpt-btn chatgpt-btn-ghost"
                style={{ color: "var(--accent-red)", borderColor: "rgba(239, 68, 68, 0.4)" }}
                onClick={handleDiscardDataset}
                disabled={isDiscarding}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>{isDiscarding ? "Discarding..." : "Discard Dataset"}</span>
              </button>

              {samplesCount > 0 ? (
                <button
                  className="chatgpt-btn chatgpt-btn-primary"
                  onClick={handleKeepDataset}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Keep Dataset ({samplesCount} samples)</span>
                </button>
              ) : (
                <button
                  className="chatgpt-btn chatgpt-btn-primary"
                  onClick={handleDiscardDataset}
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Popup */}
      {apiErrorPopup && (
        <div className="chatgpt-modal-overlay" onClick={() => setApiErrorPopup(null)}>
          <div className="chatgpt-modal modal-error" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ color: "#ef4444" }}>Generation Error</h3>
              <button className="modal-close-btn" onClick={() => setApiErrorPopup(null)}>✕</button>
            </div>
            <p className="modal-desc" style={{ color: "#f87171", wordBreak: "break-word" }}>
              {apiErrorPopup}
            </p>
            <div className="modal-actions">
              <button
                className="chatgpt-btn chatgpt-btn-primary"
                onClick={() => setApiErrorPopup(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Center Hero (when not generating) */}
      {!running && (
        <div className="chatgpt-hero-section">
          <div className="chatgpt-spark-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <h1 className="chatgpt-title">What dataset would you like to build?</h1>
          <p className="chatgpt-subtitle">
            Generate diverse multi-turn synthetic dialogue datasets using OpenRouter BFS topic expansion.
          </p>

          <div className="chatgpt-starters">
            {STARTER_PROMPTS.map((promptText, idx) => (
              <button
                key={idx}
                type="button"
                className="starter-chip"
                onClick={() => setTopic(promptText)}
              >
                <span className="starter-text">{promptText}</span>
                <span className="starter-arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live Stream View (when running) */}
      {running && (
        <div className="chatgpt-running-panel">
          <div className="running-header">
            <div className="running-status-title">
              <span className="status-pulse-dot"></span>
              <span>{statusText || "Generating synthetic dataset..."}</span>
            </div>
            <span className="running-percentage">{Math.round(progress)}%</span>
          </div>

          <div className="running-progress-track">
            <div className="running-progress-fill" style={{ width: `${progress}%` }}></div>
          </div>

          <div className="running-console">
            <div className="console-title">Live Pipeline Activity</div>
            <div className="console-stream">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className={`console-line ${log.warn ? "line-warn" : ""} ${log.error ? "line-error" : ""}`}
                >
                  <span className="console-time">[{log.time}]</span>
                  <span className="console-text">{log.text}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          <div className="running-actions">
            <button className="chatgpt-btn chatgpt-btn-ghost btn-cancel" onClick={stop}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              </svg>
              <span>Stop Generation</span>
            </button>
          </div>
        </div>
      )}

      {/* ChatGPT Prompt Card / Input Box */}
      <div className="chatgpt-input-card">
        <textarea
          className="chatgpt-textarea"
          placeholder="Describe your dataset topic (e.g., Rust memory safety, microservices resilience patterns, clinical pharmacology dialogues)..."
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={running}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!running && topic.trim()) start();
            }
          }}
        />

        <div className="chatgpt-input-controls">
          <div className="controls-left">
            {/* Model Selector */}
            <div className="model-selector-wrapper">
              <select
                className="chatgpt-select"
                value={modelPreset}
                onChange={(e) => setModelPreset(e.target.value)}
                disabled={running}
              >
                {PRESET_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {modelPreset === "custom" && (
              <input
                type="text"
                className="chatgpt-custom-model-input"
                placeholder="author/model-name:tag"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                disabled={running}
              />
            )}

            {/* API Key Status Pill */}
            <button
              type="button"
              className={`pill-btn ${isKeyReady ? "pill-ready" : "pill-missing"}`}
              onClick={() => setShowKeyModal(true)}
              title="Configure OpenRouter API Key"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
              </svg>
              <span>{isKeyReady ? "OpenRouter Ready" : "Set API Key"}</span>
            </button>

            {/* Parameters Settings Button */}
            <button
              type="button"
              className="pill-btn"
              onClick={() => setShowConfigModal(true)}
              title="Tune BFS Parameters & Target Records"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>Params ({maxRecords} records)</span>
            </button>

          </div>

          <div className="controls-right">
            <button
              type="button"
              className="chatgpt-send-btn"
              onClick={start}
              disabled={running || !topic.trim()}
              title="Generate dataset"
            >
              {running ? (
                <div className="spinner-dots">
                  <span></span><span></span><span></span>
                </div>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
