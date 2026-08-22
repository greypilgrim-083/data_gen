import { useState, useRef, useEffect } from "react";
import { createJob, BASE } from "../api";

export default function Generate({ onJobCreated, onNavigateAnalytics }) {
  const [topic, setTopic] = useState("");
  const [apiKey, setApiKey] = useState(localStorage.getItem("or_api_key") || "");
  const [model, setModel] = useState("meta-llama/llama-3.3-70b-instruct:free");
  const [maxDepth, setMaxDepth] = useState(2);
  const [maxNodes, setMaxNodes] = useState(10);
  const [branchingFactor, setBranchingFactor] = useState(3);
  const [turns, setTurns] = useState(5);
  const [assistantPersona, setAssistantPersona] = useState("random");
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [apiErrorPopup, setApiErrorPopup] = useState(null);
  const esRef = useRef(null);

  const start = async (e) => {
    e.preventDefault();
    if (!topic || !apiKey) {
      if (!apiKey) {
        setShowAdvanced(true);
        setStatusText("Please enter your OpenRouter API Key in Advanced Settings.");
      }
      return;
    }
    
    localStorage.setItem("or_api_key", apiKey);
    
    setRunning(true);
    setProgress(5);
    setStatusText("Initializing generation job...");

    const { jobId, error } = await createJob({ topic, maxDepth, maxNodes, branchingFactor, model, turns, assistantPersona });
    if (error) { 
      setStatusText(`Error: ${error}`);
      setRunning(false); 
      return; 
    }
    
    if (onJobCreated) onJobCreated(jobId);

    const token = localStorage.getItem("token");
    const url = `${BASE}/jobs/${jobId}/stream?apiKey=${encodeURIComponent(apiKey)}&token=${token}`;
    const es = new EventSource(url);
    esRef.current = es;

    let topicsFound = 1;
    let currentSamples = 0;

    es.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.event === "node_start") {
        setStatusText(`Exploring topic: ${evt.topic}`);
      } else if (evt.event === "convo_generated") {
        currentSamples = evt.totalSamples;
        setStatusText(`Generated ${currentSamples} conversations...`);
        // rough estimate of progress
        setProgress(Math.min(10 + (currentSamples / (maxNodes * branchingFactor)) * 80, 95));
      } else if (evt.event === "subtopics_found") {
        topicsFound += evt.subtopics?.length || 0;
      } else if (evt.event === "job_complete") {
        setProgress(100);
        setStatusText("Complete!");
        es.close();
        setRunning(false);
        setTimeout(() => onNavigateAnalytics(jobId), 1000);
      } else if (evt.event === "error") {
        setStatusText(`Error: ${evt.message}`);
        es.close();
        setRunning(false);
        setApiErrorPopup(evt.message);
      }
    };
    es.onerror = () => { 
      es.close(); 
      setRunning(false);
      setStatusText("Connection lost.");
    };
  };

  const stop = () => {
    esRef.current?.close();
    setRunning(false);
    setStatusText("Stopped by user");
  };

  return (
    <div className="chat-container">
      {apiErrorPopup && (
        <div className="api-error-modal-overlay">
          <div className="api-error-modal">
            <h2 style={{ color: "#ff4a4a", marginBottom: "1rem" }}>Generation Error</h2>
            <p style={{ marginBottom: "1.5rem", wordBreak: "break-word", maxHeight: "150px", overflowY: "auto" }}>
              {apiErrorPopup}
            </p>
            <button className="btn btn-primary" onClick={() => setApiErrorPopup(null)} style={{ width: "100%" }}>
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="chat-history">
        {running && (
          <div className="progress-container">
            <div className="progress-header">
              <span style={{ fontWeight: 600 }}>Generating Dataset</span>
              <span style={{ color: "var(--accent)" }}>{Math.round(progress)}%</span>
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-log">{statusText}</div>
            <div style={{ marginTop: "1rem", textAlign: "center" }}>
              <button className="btn btn-outline btn-sm" onClick={stop}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <form className="chat-input-wrapper" onSubmit={start}>
        <textarea 
          className="chat-textarea"
          placeholder="Describe the dataset you want to generate (e.g., A dataset teaching advanced Rust concurrency...)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={running}
          required
        />
        
        {showAdvanced && (
          <div className="adv-settings-panel">
            <div className="field">
              <label>API Key (OpenRouter)</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} required disabled={running}/>
            </div>
            
            <div className="field">
              <label>Model</label>
              <input value={model} onChange={e => setModel(e.target.value)} disabled={running}/>
            </div>

            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Assistant Persona (For Dataset Consistency)</label>
              <select value={assistantPersona} onChange={e => setAssistantPersona(e.target.value)} disabled={running} style={{ width: "100%", padding: "0.5rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "rgba(0,0,0,0.5)", color: "var(--text)" }}>
                <option value="random">Randomize (General Purpose)</option>
                <option value="principal_engineer">Principal Engineer</option>
                <option value="patient_tutor">Patient Tutor</option>
                <option value="pragmatic_senior">Pragmatic Senior</option>
                <option value="competitive_programmer">Competitive Programmer</option>
                <option value="security_focused_engineer">Security-Focused Engineer</option>
              </select>
            </div>
            
            <div className="slider-row" style={{ gridColumn: "1 / -1", marginTop: "0.5rem" }}>
              <div style={{ flex: 1, paddingRight: "1rem" }}>
                <div className="slider-row"><label>Depth</label><span>{maxDepth}</span></div>
                <input type="range" min={1} max={4} value={maxDepth} onChange={e => setMaxDepth(+e.target.value)} disabled={running}/>
              </div>
              <div style={{ flex: 1, paddingRight: "1rem" }}>
                <div className="slider-row" title="Each topic generates ~10 samples"><label>Max Topics</label><span>{maxNodes}</span></div>
                <input type="range" min={3} max={30} value={maxNodes} onChange={e => setMaxNodes(+e.target.value)} disabled={running}/>
              </div>
              <div style={{ flex: 1, paddingRight: "1rem" }}>
                <div className="slider-row"><label>Branching</label><span>{branchingFactor}</span></div>
                <input type="range" min={1} max={6} value={branchingFactor} onChange={e => setBranchingFactor(+e.target.value)} disabled={running}/>
              </div>
              <div style={{ flex: 1 }}>
                <div className="slider-row" title="1 Exchange = 1 User msg + 1 AI msg"><label>Exchanges</label><span>{turns}</span></div>
                <input type="range" min={2} max={10} value={turns} onChange={e => setTurns(+e.target.value)} disabled={running}/>
              </div>
            </div>
          </div>
        )}

        <div className="chat-actions">
          <div className="adv-settings-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Advanced
          </div>
          <button type="submit" className="btn btn-primary" disabled={running}>
            {running ? "Running..." : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}
