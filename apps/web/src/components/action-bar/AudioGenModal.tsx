import { BottomSheet } from "../BottomSheet";
import { btnStyle, type AudioStatus } from "./types";

interface AudioGenModalProps {
  viewingFile: { path: string; name: string };
  audioLoading: boolean;
  audioStatus: AudioStatus | null;
  onClose: () => void;
  onGenerate: () => void;
  onSend: () => void;
}

export function AudioGenModal({ viewingFile, audioLoading, audioStatus, onClose, onGenerate, onSend }: AudioGenModalProps) {
  return (
    <BottomSheet onClose={onClose} title="Audio">
      <div style={{ fontSize: 12, color: "#a9b1d6", marginBottom: 12 }}>{viewingFile.name}</div>
      {audioLoading ? (
        <div style={{ fontSize: 13, color: "#565f89", padding: 16, textAlign: "center" }}>Loading...</div>
      ) : audioStatus?.exists ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#9ece6a", marginBottom: 4 }}>Audio file exists</div>
          <button onClick={onSend} style={{ ...btnStyle, padding: "10px 14px", background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}>Send to Telegram</button>
          <button onClick={onGenerate} style={{ ...btnStyle, padding: "10px 14px" }}>Regenerate</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#565f89", marginBottom: 4 }}>No audio file found</div>
          <button onClick={onGenerate} style={{ ...btnStyle, padding: "10px 14px", background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}>Generate Audio</button>
        </div>
      )}
    </BottomSheet>
  );
}
