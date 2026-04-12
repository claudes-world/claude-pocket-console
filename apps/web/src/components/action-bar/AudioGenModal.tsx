import { BottomSheet } from "../BottomSheet";
import { InProgressAnimation } from "./InProgressAnimation";
import { btnStyle, type AudioStatus } from "./types";

type AudioOp = "idle" | "checking" | "generating" | "sending";

const AUDIO_OP_LABELS: Record<AudioOp, { label: string; hint?: string }> = {
  idle: { label: "Loading…" },
  checking: { label: "Checking for audio file…" },
  generating: { label: "Generating audio…", hint: "typically 15-20 seconds" },
  sending: { label: "Sending to Telegram…" },
};

interface AudioGenModalProps {
  viewingFile: { path: string; name: string };
  audioLoading: boolean;
  audioOp: AudioOp;
  audioStatus: AudioStatus | null;
  onClose: () => void;
  onGenerate: () => void;
  onSend: () => void;
}

export function AudioGenModal({ viewingFile, audioLoading, audioOp, audioStatus, onClose, onGenerate, onSend }: AudioGenModalProps) {
  return (
    <BottomSheet onClose={onClose} title="Audio">
      <div style={{ fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 12 }}>{viewingFile.name}</div>
      {audioLoading ? (
        <InProgressAnimation
          {...AUDIO_OP_LABELS[audioOp]}
          ariaLabel="Audio operation in progress"
        />
      ) : audioStatus?.exists ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--color-accent-green)", marginBottom: 4 }}>Audio file exists</div>
          <button onClick={onSend} style={{ ...btnStyle, padding: "10px 14px", background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}>Send to Telegram</button>
          <button onClick={onGenerate} style={{ ...btnStyle, padding: "10px 14px" }}>Regenerate</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>No audio file found</div>
          <button onClick={onGenerate} style={{ ...btnStyle, padding: "10px 14px", background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}>Generate Audio</button>
        </div>
      )}
    </BottomSheet>
  );
}
