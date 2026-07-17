import { describe, expect, it } from "vitest";
import {
  distinctHosts,
  fnv1a,
  formatTgBadge,
  groupByHost,
  harnessOf,
  hostColor,
  type TmuxSessionInfo,
} from "../session-meta";

/** session-meta (WORLD-416 §3.4 + §4.3 client side). */

const session = (over: Partial<TmuxSessionInfo>): TmuxSessionInfo => ({
  name: "s",
  attached: false,
  activity: 0,
  command: "claude",
  alive: true,
  writable: false,
  ...over,
});

describe("hostColor", () => {
  it("pins known hosts: do-box blue, do-box-successor purple", () => {
    expect(hostColor("do-box")).toBe("var(--color-accent-blue)");
    expect(hostColor("do-box-successor")).toBe("var(--color-accent-purple)");
  });

  it("hashes unknown hosts deterministically into the four free accents", () => {
    const allowed = new Set([
      "var(--color-accent-cyan)",
      "var(--color-accent-yellow)",
      "var(--color-accent-pink)",
      "var(--color-accent-orange)",
    ]);
    for (const host of ["alpha", "beta", "gamma", "delta-9", "x"]) {
      const c = hostColor(host);
      expect(allowed.has(c)).toBe(true);
      expect(hostColor(host)).toBe(c); // deterministic
      // green and red are reserved for alive-state / error semantics
      expect(c).not.toContain("green");
      expect(c).not.toContain("red");
    }
  });

  it("fnv1a is the reference FNV-1a 32-bit", () => {
    // Known vectors: fnv1a("") = offset basis, fnv1a("a") = 0xe40c292c
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
  });
});

describe("harnessOf", () => {
  it("prefers the server field, including explicit null", () => {
    expect(harnessOf(session({ harness: "codex", command: "claude" }))).toBe("codex");
    expect(harnessOf(session({ harness: null, command: "claude" }))).toBeNull();
  });

  it("falls back to the command mapping for pre-v2 servers", () => {
    expect(harnessOf(session({ command: "claude" }))).toBe("claude");
    expect(harnessOf(session({ command: "codex" }))).toBe("codex");
    expect(harnessOf(session({ command: "vim" }))).toBeNull();
  });
});

describe("formatTgBadge", () => {
  it("renders group › topic and null when unbound", () => {
    expect(formatTgBadge(session({ tg: { agent: "pm-dobot", group: "do-box", topic: "cpc-1" } })))
      .toBe("do-box › cpc-1");
    expect(formatTgBadge(session({ tg: null }))).toBeNull();
    expect(formatTgBadge(session({}))).toBeNull();
  });
});

describe("host grouping", () => {
  const roster = [
    session({ name: "a", host: "do-box" }),
    session({ name: "b", host: "next-box" }),
    session({ name: "c", host: "do-box" }),
    session({ name: "d" }),
  ];

  it("distinctHosts counts only known hosts", () => {
    expect(distinctHosts(roster).sort()).toEqual(["do-box", "next-box"]);
    expect(distinctHosts([session({ name: "x" })])).toEqual([]);
  });

  it("groups by host preserving first-appearance order, hostless trailing", () => {
    const groups = groupByHost(roster);
    expect(groups.map((g) => g.host)).toEqual(["do-box", "next-box", null]);
    expect(groups[0].sessions.map((s) => s.name)).toEqual(["a", "c"]);
    expect(groups[2].sessions.map((s) => s.name)).toEqual(["d"]);
  });
});
