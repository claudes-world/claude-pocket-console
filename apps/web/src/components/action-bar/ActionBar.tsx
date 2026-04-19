import { useActionBarModals } from "../../hooks/useActionBarModals";
import { StatusLine } from "./StatusLine";
import { btnStyle, type ActionBarProps } from "./types";
import { haptic } from "../../lib/haptic";

export function ActionBar(props: ActionBarProps) {
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

  const { onReconnect, connected, activeTab, viewingFile } = props;

  return (
    <>
      {modalNode}
      <div style={{ padding: "10px 12px 8px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
          <button
            onClick={() => { haptic.impact("light"); openTodo(); }}
            style={{ ...btnStyle, background: "#3a3520", color: "var(--color-accent-yellow)", border: "1px solid #5a4a30" }}
          >
            TODO
          </button>

          {activeTab === "terminal" && <>
            {onReconnect && (
              <div style={{ display: "flex", flexShrink: 0 }}>
                <button
                  onClick={() => { haptic.impact("light"); handleReconnect(); }}
                  style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d", borderRadius: "6px 0 0 6px", borderRight: "none" }}
                >
                  Reconnect
                </button>
                <button
                  onClick={() => { haptic.impact("light"); openReconnectMenu(); }}
                  aria-label="Open reconnect menu"
                  title="Open reconnect menu"
                  style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d", borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}
                >
                  &#9652;
                </button>
              </div>
            )}
            <div style={{ display: "flex", flexShrink: 0 }}>
              <button
                onClick={() => { haptic.impact("light"); openGitStatus(); }}
                style={{ ...btnStyle, borderRadius: "6px 0 0 6px", borderRight: "none" }}
              >
                Git
              </button>
              <button
                onClick={() => { haptic.impact("light"); openGitMenu(); }}
                aria-label="Open git menu"
                title="Open git menu"
                style={{ ...btnStyle, borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}
              >
                &#9652;
              </button>
            </div>
            <button
              onClick={() => { haptic.impact("light"); openCommands(); }}
              style={{ ...btnStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}
            >
              /commands
            </button>
          </>}

          {activeTab === "files" && !viewingFile && <>
            <button
              onClick={() => { openFileSearch(); }}
              style={{ ...btnStyle, background: "#2d3a5a", color: "var(--color-accent-blue)", border: "1px solid #3d4a6a" }}
            >
              Search
            </button>
            <button onClick={() => openFileOptions()} style={btnStyle}>Options</button>
          </>}

          {activeTab === "files" && viewingFile && (
            <button
              onClick={() => { haptic.impact("light"); void handleSendToChat(); }}
              style={{ ...btnStyle, background: "#1a2a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d4a5a" }}
            >
              Send to Chat
            </button>
          )}

          {activeTab === "files" && isViewingMd && (
            <button
              onClick={() => openTldr()}
              style={{ ...btnStyle, background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}
            >
              TL;DR
            </button>
          )}

          {activeTab === "files" && isViewingMd && viewingFile && (
            <button
              onClick={() => { openAudioGen(); }}
              style={{ ...btnStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}
            >
              Audio
            </button>
          )}
        </div>
        <StatusLine connected={connected} status={status} gitBranch={gitBranch} />
      </div>
    </>
  );
}
