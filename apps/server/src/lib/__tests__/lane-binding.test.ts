import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  _resetLaneBindingCache,
  buildPsChildren,
  findChannelBinding,
  parseChannelStateDir,
  parseLaneSessionName,
  resolveLaneBindings,
} from "../lane-binding.js";

/**
 * Tests for the WorldOS lane-binding resolver (terminal switcher v2,
 * WORLD-416): the /proc environ walk ported from the fleet cockpit
 * collector, its pure parsers, and the per-pane-PID cache.
 */

describe("parseChannelStateDir", () => {
  it("parses agent/group/topic from a channel state dir", () => {
    expect(
      parseChannelStateDir("/srv/world/state/agents/pm-dobot/channel/do-box/cpc-switcher"),
    ).toEqual({ agent: "pm-dobot", group: "do-box", topic: "cpc-switcher" });
  });

  it("tolerates a trailing slash", () => {
    expect(parseChannelStateDir("/srv/x/agents/a/channel/g/t/")).toEqual({
      agent: "a",
      group: "g",
      topic: "t",
    });
  });

  it("rejects paths without the agents/…/channel shape", () => {
    expect(parseChannelStateDir("/srv/world/state/agents/pm-dobot/channel/do-box")).toBeNull();
    expect(parseChannelStateDir("/srv/world/other/do-box/cpc-switcher")).toBeNull();
    expect(parseChannelStateDir("")).toBeNull();
  });
});

describe("parseLaneSessionName", () => {
  it("splits <group>--<topic> on the FIRST double dash, agent null", () => {
    expect(parseLaneSessionName("do-box--cpc-restart-fix")).toEqual({
      agent: null,
      group: "do-box",
      topic: "cpc-restart-fix",
    });
  });

  it("keeps later double dashes inside the topic", () => {
    expect(parseLaneSessionName("a--b--c")).toEqual({ agent: null, group: "a", topic: "b--c" });
  });

  it("returns null for non-lane names", () => {
    expect(parseLaneSessionName("claudes-world")).toBeNull();
    expect(parseLaneSessionName("--topic-only")).toBeNull();
    expect(parseLaneSessionName("group--")).toBeNull();
    expect(parseLaneSessionName("")).toBeNull();
  });
});

describe("buildPsChildren", () => {
  it("maps ppid -> child pids and skips malformed rows", () => {
    const children = buildPsChildren("  10   1\n  20  10\n 21   10\ngarbage row\n\n");
    expect(children.get(1)).toEqual([10]);
    expect(children.get(10)).toEqual([20, 21]);
    expect(children.has(NaN)).toBe(false);
  });
});

describe("findChannelBinding (fixture /proc tree)", () => {
  let procRoot: string;

  const writeEnviron = async (pid: number, vars: Record<string, string>) => {
    await fs.mkdir(path.join(procRoot, String(pid)), { recursive: true });
    const environ = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\0");
    await fs.writeFile(path.join(procRoot, String(pid), "environ"), environ);
  };

  beforeEach(async () => {
    procRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cpc-proc-fixture-"));
  });

  afterEach(async () => {
    await fs.rm(procRoot, { recursive: true, force: true });
  });

  it("finds the binding on the pane process itself", async () => {
    await writeEnviron(100, {
      HOME: "/home/claude",
      WOS_CHANNEL_STATE_DIR: "/srv/world/state/agents/pm-dobot/channel/do-box/cpc-switcher",
    });
    const binding = await findChannelBinding(100, new Map(), procRoot);
    expect(binding).toEqual({ agent: "pm-dobot", group: "do-box", topic: "cpc-switcher" });
  });

  it("walks descendants breadth-first to find the binding", async () => {
    await writeEnviron(100, { HOME: "/home/claude" });
    await writeEnviron(200, { PATH: "/usr/bin" });
    await writeEnviron(300, {
      WOS_CHANNEL_STATE_DIR: "/srv/world/state/agents/pm-dobot/channel/do-box/lane-x",
    });
    const children = new Map([
      [100, [200]],
      [200, [300]],
    ]);
    const binding = await findChannelBinding(100, children, procRoot);
    expect(binding).toEqual({ agent: "pm-dobot", group: "do-box", topic: "lane-x" });
  });

  it("returns null when no descendant carries the variable", async () => {
    await writeEnviron(100, { HOME: "/home/claude" });
    expect(await findChannelBinding(100, new Map([[100, [101]]]), procRoot)).toBeNull();
  });

  it("ignores a malformed WOS_CHANNEL_STATE_DIR value", async () => {
    await writeEnviron(100, { WOS_CHANNEL_STATE_DIR: "/not/a/channel/dir" });
    expect(await findChannelBinding(100, new Map(), procRoot)).toBeNull();
  });

  it("survives process-tree cycles via the 32-process cap", async () => {
    const children = new Map([
      [100, [101]],
      [101, [100]],
    ]);
    expect(await findChannelBinding(100, children, procRoot)).toBeNull();
  });
});

describe("resolveLaneBindings (cache)", () => {
  let procRoot: string;

  const writeEnviron = async (pid: number, dir: string) => {
    await fs.mkdir(path.join(procRoot, String(pid)), { recursive: true });
    await fs.writeFile(path.join(procRoot, String(pid), "environ"), `WOS_CHANNEL_STATE_DIR=${dir}`);
  };

  beforeEach(async () => {
    _resetLaneBindingCache();
    procRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cpc-proc-fixture-"));
  });

  afterEach(async () => {
    await fs.rm(procRoot, { recursive: true, force: true });
  });

  it("resolves bindings and caches them (including negatives) for 30s", async () => {
    await writeEnviron(100, "/srv/x/agents/pm-dobot/channel/do-box/lane-a");
    let t = 0;
    const opts = { procRoot, psOut: "100 1\n200 1\n", now: () => t };

    const first = await resolveLaneBindings([100, 200], opts);
    expect(first.get(100)).toEqual({ agent: "pm-dobot", group: "do-box", topic: "lane-a" });
    expect(first.get(200)).toBeNull();

    // Within TTL: served from cache — a changed /proc tree must not show.
    await fs.rm(path.join(procRoot, "100"), { recursive: true, force: true });
    t = 29_999;
    const second = await resolveLaneBindings([100, 200], opts);
    expect(second.get(100)).toEqual({ agent: "pm-dobot", group: "do-box", topic: "lane-a" });

    // Past TTL: re-walked, binding now gone.
    t = 30_001;
    const third = await resolveLaneBindings([100], opts);
    expect(third.get(100)).toBeNull();
  });

  it("resolves null for every pid when ps fails, without caching the failure", async () => {
    await writeEnviron(100, "/srv/x/agents/pm-dobot/channel/do-box/lane-a");
    const failing: any = { procRoot, now: () => 0 };
    Object.defineProperty(failing, "psOut", {
      get(): string {
        throw new Error("ps timed out");
      },
    });
    const failed = await resolveLaneBindings([100], failing);
    expect(failed.get(100)).toBeNull();

    // The failure was not cached: a healthy follow-up call resolves.
    const ok = await resolveLaneBindings([100], { procRoot, psOut: "", now: () => 0 });
    expect(ok.get(100)).toEqual({ agent: "pm-dobot", group: "do-box", topic: "lane-a" });
  });

  it("deduplicates pids and returns one entry per pid", async () => {
    await writeEnviron(100, "/srv/x/agents/pm-dobot/channel/do-box/lane-a");
    const result = await resolveLaneBindings([100, 100, 100], {
      procRoot,
      psOut: "",
      now: () => 0,
    });
    expect(result.size).toBe(1);
    expect(result.get(100)).toEqual({ agent: "pm-dobot", group: "do-box", topic: "lane-a" });
  });
});
