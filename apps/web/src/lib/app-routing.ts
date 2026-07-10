export type AppTab = "terminal" | "files" | "links" | "voice" | "prs";

type BotPathAlias = Readonly<{
  tab: AppTab;
  session: string | null;
}>;

// Module-private: the only consumer is resolveInitialAppState below. Kept
// unexported until a phase-2 route surface (#241) actually needs to read it.
const BOT_PATH_ALIASES: Readonly<Record<string, BotPathAlias>> = {
  "/claude_do_bot": { tab: "terminal", session: null },
  "/pm_dobot": { tab: "terminal", session: "pm-dobot" },
};

const DEFAULT_BOT_PATH = "/claude_do_bot";
const DEFAULT_STATE: InitialAppState = {
  tab: "terminal",
  session: null,
  file: null,
};
const TABS: AppTab[] = ["terminal", "files", "links", "voice", "prs"];
const DEEP_LINK_PARAM_RE = /(?:^|&)(?:file|session|token)=/;

// Client-side mirror of the server's session-name allowlist (SESSION_NAME_RE
// in apps/server/src/routes/utils.ts). The server re-validates every session;
// this drops invalid names before they become WebSocket parameters.
const SESSION_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export interface InitialAppState {
  tab: AppTab;
  session: string | null;
  file: string | null;
}

export interface InitialAppResolution extends InitialAppState {
  redirectPath: string | null;
}

function validatedSession(session: string | null): string | null {
  return session !== null && SESSION_NAME_RE.test(session) ? session : null;
}

function resolveHashState(hashParams: string): InitialAppState {
  const fileMatch = hashParams.match(/file=([^&]+)/)?.[1];
  let file: string | null = null;
  if (fileMatch) {
    try {
      file = decodeURIComponent(fileMatch);
    } catch {
      // A malformed hand-typed/truncated file deep link behaves like no file
      // selection instead of throwing during the initial render.
    }
  }
  const requestedTab = file
    ? "files"
    : (hashParams.split("&")[0] || "terminal") as AppTab;

  let session: string | null = null;
  const sessionMatch = hashParams.match(/(?:^|&)session=([^&]+)/)?.[1];
  if (sessionMatch) {
    try {
      session = validatedSession(decodeURIComponent(sessionMatch));
    } catch {
      // A malformed hand-typed/truncated session deep link behaves like the
      // default session instead of throwing during the initial render.
    }
  }

  return {
    tab: TABS.includes(requestedTab) ? requestedTab : "terminal",
    session,
    file,
  };
}

function isAppDeepLink(hashParams: string): boolean {
  const firstSegment = hashParams.split("&", 1)[0];
  return TABS.includes(firstSegment as AppTab) || DEEP_LINK_PARAM_RE.test(hashParams);
}

/** Resolve the first-render route without reading from or mutating window. */
export function resolveInitialAppState(pathname: string, hash: string): InitialAppResolution {
  const hashParams = hash.replace(/^#/, "");
  if (isAppDeepLink(hashParams)) {
    return { ...resolveHashState(hashParams), redirectPath: null };
  }

  const redirectPath = pathname === "/" ? DEFAULT_BOT_PATH : null;
  const alias = BOT_PATH_ALIASES[pathname] ?? (redirectPath ? BOT_PATH_ALIASES[redirectPath] : undefined);
  if (!alias) return { ...DEFAULT_STATE, redirectPath };

  return {
    tab: alias.tab,
    session: validatedSession(alias.session),
    file: null,
    redirectPath,
  };
}

/** Build the replaceState URL while leaving auth query/hash text untouched. */
export function buildLandingUrl(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}
