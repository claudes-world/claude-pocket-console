/**
 * scrubber.ts — Auth-credential scrubber for the CPC debug overlay.
 *
 * This is an AUTH-CREDENTIAL scrubber, NOT a general privacy filter.
 * It does NOT attempt to redact: arbitrary PII, email addresses, names,
 * IP addresses, or credit card numbers. Its purpose is to strip auth
 * tokens and sensitive URL parameters from error messages before display
 * in the debug overlay.
 *
 * Scrubbing rules (applied in order):
 * 1. URL query strings — strip query params from URLs
 * 2. JWT-shaped tokens — base64url dot-separated triples starting with eyJ
 * 3. Bearer tokens — "Bearer <token>"
 * 4. Authorization headers — "Authorization: <value>"
 * 5. Telegram tma tokens — "tma <token>"
 * 6. API key shapes — sk-/pk- prefixed strings
 * 7. Session token literal — matches against stored session token value
 */

// --- Scrubbing rules ---

const RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // 1. URL query strings: strip everything after ? in http(s) URLs
  {
    pattern: /(https?:\/\/[^\s"']+)\?[^\s"']*/g,
    replacement: "$1?[REDACTED]",
  },
  // 2. JWT-shaped tokens (three base64url segments starting with eyJ)
  {
    pattern: /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: "[JWT]",
  },
  // 3. Bearer tokens
  {
    pattern: /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
    replacement: "Bearer [REDACTED]",
  },
  // 4. Authorization headers (key: value or key=value — consume rest of token-like chars)
  {
    pattern: /authorization\s*[:=]\s*\S+(?:\s+[A-Za-z0-9._\-+/=]+)?/gi,
    replacement: "Authorization: [REDACTED]",
  },
  // 5. Telegram tma tokens
  {
    pattern: /tma\s+[^"'\s]+/gi,
    replacement: "tma [REDACTED]",
  },
  // 6. API key shapes (sk-xxx, pk-xxx with 20+ chars)
  {
    pattern: /(?:sk|pk)-[A-Za-z0-9]{20,}/g,
    replacement: "[API_KEY]",
  },
];

/** Cached session token for literal replacement */
let _cachedSessionToken: string | null = null;
let _sessionTokenLoaded = false;

function getSessionToken(): string | null {
  if (!_sessionTokenLoaded) {
    try {
      _cachedSessionToken = localStorage.getItem("cpc-session-token");
    } catch {
      _cachedSessionToken = null;
    }
    _sessionTokenLoaded = true;
  }
  return _cachedSessionToken;
}

// Listen for storage changes to update cached token
if (typeof window !== "undefined") {
  try {
    window.addEventListener("storage", (e) => {
      if (e.key === "cpc-session-token") {
        _cachedSessionToken = e.newValue;
      }
    });
  } catch {
    // ignore — addEventListener may not be available in test environments
  }
}

/**
 * Scrub sensitive auth credentials from a string.
 * Returns the scrubbed string, or the original if no sensitive data was found.
 * Returns empty string for null/undefined input.
 */
export function scrubSecrets(input: unknown): string {
  if (input === null || input === undefined) {
    return "";
  }

  let text = typeof input === "string" ? input : String(input);

  // Apply regex rules in order
  for (const rule of RULES) {
    // Reset lastIndex for global regexps (they're cloned via replaceAll path)
    text = text.replace(rule.pattern, rule.replacement);
  }

  // 7. Session token literal replacement
  const sessionToken = getSessionToken();
  if (sessionToken && sessionToken.length > 8 && text.includes(sessionToken)) {
    text = text.split(sessionToken).join("[SESSION_TOKEN]");
  }

  return text;
}

/**
 * Reset internal cached state. Exposed for testing only.
 */
export function _resetScrubberCache(): void {
  _cachedSessionToken = null;
  _sessionTokenLoaded = false;
}
