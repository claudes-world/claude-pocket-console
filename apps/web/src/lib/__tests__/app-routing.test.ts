import { describe, expect, it } from "vitest";
import { buildLandingUrl, resolveInitialAppState } from "../app-routing";

describe("resolveInitialAppState", () => {
  it("resolves root to the default bot alias and a cosmetic redirect", () => {
    expect(resolveInitialAppState("/", "")).toEqual({
      tab: "terminal",
      session: null,
      file: null,
      redirectPath: "/claude_do_bot",
    });
  });

  it("resolves /claude_do_bot to the default terminal session", () => {
    expect(resolveInitialAppState("/claude_do_bot", "")).toEqual({
      tab: "terminal",
      session: null,
      file: null,
      redirectPath: null,
    });
  });

  it("resolves /pm_dobot to the pm-dobot terminal session without redirecting", () => {
    expect(resolveInitialAppState("/pm_dobot", "")).toEqual({
      tab: "terminal",
      session: "pm-dobot",
      file: null,
      redirectPath: null,
    });
  });

  it("ignores a foreign Telegram hash when resolving the root redirect", () => {
    expect(resolveInitialAppState("/", "#tgWebAppData=abc&tgWebAppVersion=7")).toEqual({
      tab: "terminal",
      session: null,
      file: null,
      redirectPath: "/claude_do_bot",
    });
  });

  it("ignores a foreign Telegram hash when resolving the bot alias", () => {
    expect(resolveInitialAppState("/claude_do_bot", "#tgWebAppData=abc&tgWebAppVersion=7")).toEqual({
      tab: "terminal",
      session: null,
      file: null,
      redirectPath: null,
    });
  });

  it("lets a file hash deep link win over the alias", () => {
    expect(resolveInitialAppState("/claude_do_bot", "#files&file=%2Ftmp%2Fnotes.md")).toEqual({
      tab: "files",
      session: null,
      file: "/tmp/notes.md",
      redirectPath: null,
    });
  });

  it("treats a malformed file hash value as absent", () => {
    expect(resolveInitialAppState("/", "#files&file=%")).toEqual({
      tab: "files",
      session: null,
      file: null,
      redirectPath: null,
    });
  });

  it("lets a hash deep link win over the pm-dobot alias", () => {
    expect(resolveInitialAppState("/pm_dobot", "#terminal&session=another-session")).toEqual({
      tab: "terminal",
      session: "another-session",
      file: null,
      redirectPath: null,
    });
  });

  it("preserves terminal session deep-link resolution and validation", () => {
    expect(resolveInitialAppState("/claude_do_bot", "#terminal&session=pm.test-1")).toEqual({
      tab: "terminal",
      session: "pm.test-1",
      file: null,
      redirectPath: null,
    });
    expect(resolveInitialAppState("/claude_do_bot", "#terminal&session=invalid%2Fname").session).toBeNull();
  });

  it("preserves voice token hash routing", () => {
    expect(resolveInitialAppState("/claude_do_bot", "#voice&token=secret")).toEqual({
      tab: "voice",
      session: null,
      file: null,
      redirectPath: null,
    });
  });

  it.each([
    ["#files&file=%2Ftmp%2Fnotes.md", "files"],
    ["#terminal&session=pm.test-1", "terminal"],
    ["#voice&token=secret", "voice"],
  ] as const)("lets the app deep link %s suppress the root redirect", (hash, tab) => {
    expect(resolveInitialAppState("/", hash)).toMatchObject({ tab, redirectPath: null });
  });

  it("uses current defaults for an unknown path", () => {
    expect(resolveInitialAppState("/unknown", "")).toEqual({
      tab: "terminal",
      session: null,
      file: null,
      redirectPath: null,
    });
  });

  it("does not redirect the /dev path", () => {
    expect(resolveInitialAppState("/dev", "").redirectPath).toBeNull();
  });
});

describe("buildLandingUrl", () => {
  it("preserves search and hash verbatim", () => {
    expect(buildLandingUrl("/claude_do_bot", "?token=a%2Bb&mode=1", "#voice&token=hash-token"))
      .toBe("/claude_do_bot?token=a%2Bb&mode=1#voice&token=hash-token");
  });

  it("preserves a foreign Telegram hash during the landing redirect", () => {
    expect(buildLandingUrl(
      "/claude_do_bot",
      "",
      "#tgWebAppData=abc&tgWebAppVersion=7",
    )).toBe("/claude_do_bot#tgWebAppData=abc&tgWebAppVersion=7");
  });
});
