import type { GitBranch } from "./types";

interface StatusLineProps {
  connected?: boolean;
  status: string | null;
  gitBranch: GitBranch | null;
}

export function StatusLine({ connected, status, gitBranch }: StatusLineProps) {
  return (
    <div style={{ fontSize: 11, color: connected === false ? "#f7768e" : "#7aa2f7", marginTop: 6, textAlign: "center", minHeight: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {status || (connected === false ? "[disconnected]" : gitBranch ? `\uD83D\uDD00 ${gitBranch.branch} (${gitBranch.treeType})` : "\u00A0")}
    </div>
  );
}
