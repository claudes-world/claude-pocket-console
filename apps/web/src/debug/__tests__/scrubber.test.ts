import { describe, it, expect, beforeEach } from "vitest";
import { scrubSecrets, _resetScrubberCache } from "../scrubber";

beforeEach(() => {
  _resetScrubberCache();
});

describe("scrubSecrets", () => {
  // --- Null/undefined handling ---

  it("returns empty string for null input", () => {
    expect(scrubSecrets(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(scrubSecrets(undefined)).toBe("");
  });

  // --- Passthrough of safe messages ---

  it("passes through a safe error message unchanged", () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'map')";
    expect(scrubSecrets(msg)).toBe(msg);
  });

  it("passes through a simple stack trace without URLs or tokens", () => {
    const stack = "Error: test\n    at App (App.tsx:42:5)\n    at render";
    expect(scrubSecrets(stack)).toBe(stack);
  });

  // --- URL query string stripping ---

  it("strips query parameters from HTTP URLs", () => {
    const input = "Failed to fetch https://api.example.com/data?token=abc123&session=xyz";
    expect(scrubSecrets(input)).toBe(
      "Failed to fetch https://api.example.com/data?[REDACTED]",
    );
  });

  it("strips query parameters from HTTPS URLs in stack traces", () => {
    const input =
      "at fetchData (https://cpc-dev.claude.do/assets/main.js?v=abc123:42:10)";
    const result = scrubSecrets(input);
    // The URL regex consumes everything after ? as part of the URL,
    // so :42:10 is included in the redacted portion
    expect(result).toContain("?[REDACTED]");
    expect(result).not.toContain("v=abc123");
  });

  it("preserves URLs without query strings", () => {
    const input = "Failed to fetch https://api.example.com/data";
    expect(scrubSecrets(input)).toBe(input);
  });

  // --- Bearer token masking ---

  it("masks Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature";
    expect(scrubSecrets(input)).toContain("[REDACTED]");
    expect(scrubSecrets(input)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("masks bearer tokens case-insensitively", () => {
    const input = "bearer abc123def456";
    expect(scrubSecrets(input)).toBe("Bearer [REDACTED]");
  });

  // --- JWT detection ---

  it("detects and replaces JWT tokens in arbitrary text", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const input = `Error in stack frame: ${jwt}`;
    expect(scrubSecrets(input)).toBe("Error in stack frame: [JWT]");
    expect(scrubSecrets(input)).not.toContain("eyJ");
  });

  it("detects JWTs embedded in URLs (after query strip)", () => {
    const input =
      "https://example.com/callback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.rg2e5RHLY";
    const result = scrubSecrets(input);
    expect(result).not.toContain("eyJ");
  });

  // --- Telegram tma tokens ---

  it("masks tma initData strings", () => {
    const input = 'Auth failed: tma query_id=AAHzZ7Q6AAAAAHFnthk&user=%7B%22id%22%3A123%7D';
    const result = scrubSecrets(input);
    expect(result).toContain("tma [REDACTED]");
    expect(result).not.toContain("query_id");
  });

  // --- Authorization headers ---

  it("masks Authorization header values", () => {
    const input = "Request header: authorization: Basic dXNlcjpwYXNz";
    const result = scrubSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("dXNlcjpwYXNz");
  });

  it("masks Authorization with equals sign", () => {
    const input = "authorization=secretvalue123";
    const result = scrubSecrets(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("secretvalue123");
  });

  // --- API key shapes ---

  it("masks sk- prefixed API keys", () => {
    const input = "API call failed with key sk-abcdefghijklmnopqrstuvwxyz1234";
    expect(scrubSecrets(input)).toBe("API call failed with key [API_KEY]");
  });

  it("masks pk- prefixed API keys", () => {
    const input = "pk-ABCDEFGHIJKLMNOPQRSTUVWX";
    expect(scrubSecrets(input)).toBe("[API_KEY]");
  });

  it("does not mask short sk- prefixes that are not API keys", () => {
    // sk- followed by fewer than 20 chars should NOT match
    const input = "sk-short";
    expect(scrubSecrets(input)).toBe("sk-short");
  });

  // --- Non-string input ---

  it("converts number input to string", () => {
    expect(scrubSecrets(42)).toBe("42");
  });

  it("converts object input to string", () => {
    const result = scrubSecrets({ key: "value" });
    expect(result).toBe("[object Object]");
  });

  // --- Multiple patterns in one string ---

  it("scrubs multiple sensitive patterns in a single string", () => {
    const input =
      "Fetch https://api.example.com/v1?key=secret with Bearer mytoken123 failed (tma initData=abc123)";
    const result = scrubSecrets(input);
    expect(result).not.toContain("key=secret");
    expect(result).not.toContain("mytoken123");
    expect(result).not.toContain("initData=abc123");
  });

  // --- Session token literal ---

  it("masks literal session token from localStorage", () => {
    // Simulate a stored session token
    localStorage.setItem("cpc-session-token", "my-super-secret-session-token-value");
    _resetScrubberCache(); // Force re-read

    const input = "Error occurred with token my-super-secret-session-token-value in request";
    const result = scrubSecrets(input);
    expect(result).toContain("[SESSION_TOKEN]");
    expect(result).not.toContain("my-super-secret-session-token-value");

    localStorage.removeItem("cpc-session-token");
  });
});
