import { useState, useRef, useEffect, useCallback } from "react";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { getAuthHeaders } from "../lib/telegram";

type View = "recorder" | "library";

interface TranscriptSummary {
  id: string;
  title: string;
  preview: string;
  word_count: number;
  created_at: number;
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "vr-spin 0.8s linear infinite", display: "inline-block", verticalAlign: "middle" }}>
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="20 12" strokeLinecap="round" />
    </svg>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function VoiceRecorder() {
  const [view, setView] = useState<View>("recorder");
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveTitle, setSaveTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [library, setLibrary] = useState<TranscriptSummary[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef("");
  const transcriptBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);

  useEffect(() => {
    const el = transcriptBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const stopRecordingCleanup = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setAnalyserNode(null);
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      setAnalyserNode(analyser);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current = [...chunksRef.current, e.data];
          setChunks([...chunksRef.current]);
        }
      };

      recorder.start(30000);
      setIsRecording(true);
      setDuration(0);
      intervalRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("Permission") || msg.includes("NotAllowed") || msg.includes("denied")
        ? "Microphone access required. Please allow microphone permission and try again."
        : `Could not start recording: ${msg}`);
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecordingCleanup(); else startRecording();
  }, [isRecording, startRecording, stopRecordingCleanup]);

  // New paragraph: flush current audio, keep recording, add \n\n after transcription
  const submitParagraph = useCallback(async () => {
    if (isTranscribing) return;

    // Flush current recording buffer into a chunk
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.requestData();
    }

    // Small delay to let ondataavailable fire
    await new Promise((r) => setTimeout(r, 100));

    const currentChunks = [...chunksRef.current];
    if (currentChunks.length === 0) return;

    // Clear chunks immediately — recording continues, new chunks accumulate fresh
    chunksRef.current = [];
    setChunks([]);

    setIsTranscribing(true);
    setError(null);

    const mimeType = currentChunks[0].type || "audio/webm";
    const blob = new Blob(currentChunks, { type: mimeType });

    const form = new FormData();
    form.append("audio", blob, `recording.${mimeType.includes("mp4") ? "mp4" : "webm"}`);
    const context = transcriptRef.current.slice(-200);
    if (context) form.append("context", context);

    try {
      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: getAuthHeaders(),
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      const newText: string = data.text || "";

      if (newText) {
        setTranscript((prev) => {
          if (!prev) return newText;
          return prev.trimEnd() + "\n\n" + newText;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Transcription failed: ${msg}`);
      // Put chunks back so user can retry
      chunksRef.current = [...currentChunks, ...chunksRef.current];
      setChunks([...chunksRef.current]);
    } finally {
      setIsTranscribing(false);
    }
  }, [isTranscribing]);

  const saveTranscript = useCallback(async () => {
    if (!transcript || isSaving) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch("/api/voice/transcripts", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: saveTitle.trim() || "Voice Note", body: transcript }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }
      setSaveStatus("Saved");
      setSaveTitle("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveStatus(`Failed: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  }, [transcript, saveTitle, isSaving]);

  const loadLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch("/api/voice/transcripts", { headers: getAuthHeaders() });
      if (res.ok) setLibrary(await res.json());
    } catch { /* ignore */ }
    setLoadingLibrary(false);
  }, []);

  useEffect(() => () => stopRecordingCleanup(), [stopRecordingCleanup]);

  const hasChunks = chunks.length > 0;

  // Library view
  if (view === "library") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <button
            onClick={() => setView("recorder")}
            style={{
              background: "none", border: "none", color: "var(--color-accent-blue)", fontSize: 13, cursor: "pointer",
              padding: "4px 8px", fontWeight: 600,
            }}
          >
            &larr; Record
          </button>
          <span style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 600, color: "var(--color-fg)" }}>
            Transcripts
          </span>
          <button
            onClick={loadLibrary}
            style={{ background: "none", border: "none", color: "var(--color-muted)", fontSize: 12, cursor: "pointer", padding: "4px 8px" }}
          >
            {loadingLibrary ? <Spinner /> : "Refresh"}
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {library.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--color-subtle)", fontStyle: "italic", paddingTop: 20, fontSize: 13 }}>
              {loadingLibrary ? "Loading..." : "No transcripts yet"}
            </p>
          ) : (
            library.map((t) => (
              <div
                key={t.id}
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 8,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg)", marginBottom: 4 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: "var(--color-muted)", lineHeight: 1.4, marginBottom: 4 }}>
                  {t.preview || "(empty)"}
                </div>
                <div style={{ fontSize: 10, color: "var(--color-subtle)" }}>
                  {formatDate(t.created_at)} &middot; {t.word_count} words
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Recorder view
  return (
    <>
      <style>{`
        @keyframes vr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes vr-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(247, 118, 142, 0.55); }
          60%  { box-shadow: 0 0 0 14px rgba(247, 118, 142, 0); }
          100% { box-shadow: 0 0 0 0 rgba(247, 118, 142, 0); }
        }
        @keyframes vr-dot-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "8px 12px 0", overflow: "hidden" }}>

        {/* Top bar: Library button */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4, flexShrink: 0 }}>
          <button
            onClick={() => { setView("library"); loadLibrary(); }}
            style={{
              background: "none", border: "1px solid var(--color-border)", color: "var(--color-accent-blue)", fontSize: 11, cursor: "pointer",
              padding: "3px 10px", borderRadius: 6, fontWeight: 500,
            }}
          >
            Transcripts
          </button>
        </div>

        {/* Transcript area */}
        <div
          ref={transcriptBoxRef}
          style={{
            flex: 1,
            minHeight: 60,
            overflowY: "auto",
            background: "var(--color-surface)",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            padding: "12px 14px",
            marginBottom: 8,
          }}
        >
          {transcript ? (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--color-fg)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {transcript}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--color-subtle)", fontStyle: "italic", textAlign: "center", paddingTop: 12 }}>
              Start recording to begin transcribing...
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(247, 118, 142, 0.1)", border: "1px solid rgba(247, 118, 142, 0.3)",
            borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "var(--color-accent-red)",
            lineHeight: 1.4, marginBottom: 8, maxHeight: 60, overflowY: "auto",
          }}>
            {error}
          </div>
        )}

        {/* Save bar */}
        {transcript && (
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="Title (optional)"
              onKeyDown={(e) => { if (e.key === "Enter") saveTranscript(); }}
              style={{
                flex: 1, background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-subtle)",
                borderRadius: 7, padding: "7px 10px", fontSize: 12, outline: "none", minWidth: 0,
              }}
            />
            <button
              onClick={saveTranscript}
              disabled={isSaving}
              style={{
                padding: "7px 14px", fontSize: 12, fontWeight: 600, background: "#1a3a2a",
                color: isSaving ? "#4a7a5a" : "var(--color-accent-green)", border: "1px solid #2d5a3d",
                borderRadius: 7, cursor: isSaving ? "not-allowed" : "pointer", flexShrink: 0,
              }}
            >
              {isSaving ? <><Spinner /> Saving...</> : "Save"}
            </button>
            {saveStatus && (
              <span style={{ fontSize: 11, alignSelf: "center", color: saveStatus === "Saved" ? "var(--color-accent-green)" : "var(--color-accent-red)" }}>
                {saveStatus}
              </span>
            )}
          </div>
        )}

        {/* New Paragraph button */}
        <button
          onClick={submitParagraph}
          disabled={(!hasChunks && !isRecording) || isTranscribing}
          style={{
            width: "100%",
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            background: (hasChunks || isRecording) && !isTranscribing ? "linear-gradient(135deg, #2d3a5a, #253356)" : "#1e2030",
            color: (hasChunks || isRecording) && !isTranscribing ? "var(--color-accent-blue)" : "var(--color-subtle)",
            border: "1px solid",
            borderColor: (hasChunks || isRecording) && !isTranscribing ? "#3d4a6a" : "var(--color-border)",
            borderRadius: 8,
            cursor: (hasChunks || isRecording) && !isTranscribing ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 10,
            flexShrink: 0,
          }}
        >
          {isTranscribing ? (
            <><Spinner /> <span>Transcribing...</span></>
          ) : (
            <span>{"\u00B6"} New Paragraph</span>
          )}
        </button>

        {/* Record button area — waveform behind button */}
        <div style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "6px 0 10px",
          flexShrink: 0,
        }}>
          {/* Waveform positioned behind the button */}
          <div style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            opacity: isRecording ? 0.6 : 0.3,
            transition: "opacity 0.3s",
          }}>
            <WaveformVisualizer analyserNode={analyserNode} isRecording={isRecording} />
          </div>

          {/* Record button on top */}
          <button
            onClick={toggleRecording}
            style={{
              position: "relative",
              zIndex: 2,
              width: 72,
              height: 72,
              borderRadius: "50%",
              border: "none",
              cursor: "pointer",
              background: isRecording
                ? "radial-gradient(circle at 38% 38%, #ff8fa3, var(--color-accent-red))"
                : "radial-gradient(circle at 38% 38%, #3d2535, #2a1a23)",
              boxShadow: isRecording
                ? "0 0 0 3px rgba(247,118,142,0.3), inset 0 2px 6px rgba(255,255,255,0.15)"
                : "0 0 0 2px var(--color-subtle), inset 0 2px 4px rgba(0,0,0,0.4)",
              animation: isRecording ? "vr-pulse 1.5s ease-out infinite" : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isRecording ? (
              <span style={{ width: 20, height: 20, borderRadius: 4, background: "#fff", display: "block", opacity: 0.95 }} />
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="2" width="6" height="12" rx="3" fill="var(--color-accent-red)" />
                <path d="M5 11a7 7 0 0 0 14 0" stroke="var(--color-accent-red)" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="18" x2="12" y2="22" stroke="var(--color-accent-red)" strokeWidth="2" strokeLinecap="round" />
                <line x1="9" y1="22" x2="15" y2="22" stroke="var(--color-accent-red)" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {/* Duration below button */}
          <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            {isRecording && (
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-accent-red)", animation: "vr-dot-blink 1.2s ease-in-out infinite" }} />
            )}
            <span style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 15, fontWeight: 600, color: isRecording ? "var(--color-fg)" : "var(--color-muted)",
            }}>
              {formatDuration(duration)}
            </span>
            {isRecording && (
              <span style={{ fontSize: 10, color: "var(--color-accent-red)", fontWeight: 500 }}>REC</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
