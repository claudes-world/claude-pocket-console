import { useActionBarModals } from "../hooks/useActionBarModals";
import { btnStyle, type ActionBarProps } from "./action-bar/types";
import { StatusLine } from "./action-bar/StatusLine";
import { haptic } from "../lib/haptic";

const chipStyle = { ...btnStyle, fontSize: 12, padding: "5px 12px", borderRadius: 14 };

export function ActionChips(props: ActionBarProps) {
  const {
    modalNode,
    status,
    gitBranch,
    openTodo,
    openCommands,
    openGitStatus,
    openGitMenu,
    openReconnectMenu,
    openFileSearch,
    openFileOptions,
    openTldr,
    openAudioGen,
    handleSendToChat,
    handleReconnect,
    isViewingMd,
  } = useActionBarModals(props);

  const { activeTab, viewingFile, onReconnect, connected } = props;

  return (
    <>
      {modalNode}
      <div
        onTouchStart={(e) => e.stopPropagation()}
        style={{ padding: "8px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}
      >

        {/* TODO — always visible */}
        <button
          onClick={() => { haptic.impact("light"); openTodo(); }}
          style={{ ...chipStyle, background: "#3a3520", color: "var(--color-accent-yellow)", border: "1px solid #5a4a30" }}
        >
          TODO
        </button>

        {/* Terminal chips */}
        {activeTab === "terminal" && <>
          {onReconnect && (
            <button
              onClick={() => { haptic.impact("light"); handleReconnect(); }}
              style={{ ...chipStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d" }}
            >
              Reconnect
            </button>
          )}
          {onReconnect && (
            <button
              onClick={() => { haptic.impact("light"); openReconnectMenu(); }}
              style={{ ...chipStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d" }}
            >
              Reconnect Menu
            </button>
          )}
          <button
            onClick={() => { haptic.impact("light"); openGitStatus(); }}
            style={chipStyle}
          >
            Git
          </button>
          <button
            onClick={() => { haptic.impact("light"); openGitMenu(); }}
            style={chipStyle}
          >
            Git Menu
          </button>
          <button
            onClick={() => { haptic.impact("light"); openCommands(); }}
            style={{ ...chipStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}
          >
            /commands
          </button>
        </>}

        {/* Files chips — browsing */}
        {activeTab === "files" && !viewingFile && <>
          <button
            onClick={() => { haptic.impact("light"); openFileSearch(); }}
            style={{ ...chipStyle, background: "#2d3a5a", color: "var(--color-accent-blue)", border: "1px solid #3d4a6a" }}
          >
            Search
          </button>
          <button onClick={() => { haptic.impact("light"); openFileOptions(); }} style={chipStyle}>
            Options
          </button>
        </>}

        {/* Files chips — viewing */}
        {activeTab === "files" && viewingFile && <>
          <button
            onClick={() => { haptic.impact("light"); void handleSendToChat(); }}
            style={{ ...chipStyle, background: "#1a2a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d4a5a" }}
          >
            Send to Chat
          </button>
          {isViewingMd && (
            <button
              onClick={() => openTldr()}
              style={{ ...chipStyle, background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}
            >
              TL;DR
            </button>
          )}
          {isViewingMd && (
            <button
              onClick={() => openAudioGen()}
              style={{ ...chipStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}
            >
              Audio
            </button>
          )}
        </>}
      </div>
      <StatusLine connected={connected} status={status} gitBranch={gitBranch} />
    </>
  );
}
