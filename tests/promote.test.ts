// Exercises promote / demote against an isolated cache root. Tests set
// SEANCE_CACHE_ROOT to a fresh mkdtemp before each test and clean up
// after — the real ~/.agiterra/personai/ is never touched.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPersonai, loadRegistry } from "../src/registry.ts";
import { promotePersonai, demotePersonai } from "../src/promote.ts";
import { pullOrClone } from "../src/git-ops.ts";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const GIT_AUTHOR = [
  "-c", "user.email=test@example.invalid",
  "-c", "user.name=seance-test",
  "-c", "commit.gpgsign=false",
];

interface Sandbox {
  testRoot: string;
  cacheRoot: string;
  remote: string;          // bare repo acting as origin
  primaryRoot: string;     // where "~/Projects" lives for tests
  prevHome: string | undefined;
  prevCacheRoot: string | undefined;
}

function newSandbox(name = "alex"): Sandbox {
  const testRoot = mkdtempSync(join(tmpdir(), "seance-promote-"));
  const cacheRoot = join(testRoot, "cache");
  const primaryRoot = join(testRoot, "home", "Projects");
  const remote = join(testRoot, "remote.git");

  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(primaryRoot, { recursive: true });
  mkdirSync(remote);
  git(["init", "--bare", "--initial-branch=main"], remote);

  // Seed remote.
  const scratch = join(testRoot, "scratch");
  git(["clone", remote, scratch], testRoot);
  writeFileSync(join(scratch, "CLAUDE.md"), `# ${name}\n`);
  git(["add", "-A"], scratch);
  git([...GIT_AUTHOR, "commit", "-m", "initial"], scratch);
  git(["push", "origin", "main"], scratch);
  rmSync(scratch, { recursive: true, force: true });

  // Redirect HOME (for default `~/Projects/<Name>`) and cache root.
  const prevHome = process.env.HOME;
  const prevCacheRoot = process.env.SEANCE_CACHE_ROOT;
  process.env.HOME = join(testRoot, "home");
  process.env.SEANCE_CACHE_ROOT = cacheRoot;

  return { testRoot, cacheRoot, remote, primaryRoot, prevHome, prevCacheRoot };
}

function cleanup(sb: Sandbox): void {
  if (sb.prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = sb.prevHome;
  if (sb.prevCacheRoot === undefined) delete process.env.SEANCE_CACHE_ROOT;
  else process.env.SEANCE_CACHE_ROOT = sb.prevCacheRoot;
  rmSync(sb.testRoot, { recursive: true, force: true });
}

function setupRegistered(sb: Sandbox, name: string): void {
  registerPersonai(name, `file://${sb.remote}`);
  pullOrClone(name, `file://${sb.remote}`);
}

describe("promotePersonai", () => {
  let sb: Sandbox;
  beforeEach(() => { sb = newSandbox(); });
  afterEach(() => cleanup(sb));

  it("moves cache to primary, recreates cache, updates registry", () => {
    setupRegistered(sb, "alex");
    const oldCacheExists = existsSync(join(sb.cacheRoot, "alex"));
    expect(oldCacheExists).toBe(true);

    const result = promotePersonai("alex");

    expect(result.alreadyPromoted).toBe(false);
    expect(result.promotedPath).toBe(join(sb.primaryRoot, "Alex"));
    expect(existsSync(result.promotedPath)).toBe(true);
    expect(existsSync(join(result.promotedPath, ".git"))).toBe(true);
    expect(existsSync(join(result.promotedPath, "CLAUDE.md"))).toBe(true);

    // Cache must be recreated as a fresh clone (not the moved-away one).
    expect(existsSync(result.cachePath)).toBe(true);
    expect(existsSync(join(result.cachePath, ".git"))).toBe(true);
    expect(existsSync(join(result.cachePath, "CLAUDE.md"))).toBe(true);

    // Registry updated.
    const entry = loadRegistry().personae.find((p) => p.name === "alex");
    expect(entry?.promoted).toBe(true);
    expect(entry?.promotedPath).toBe(result.promotedPath);
    expect(entry?.promotedAt).toBeTruthy();
  });

  it("is idempotent when already promoted", () => {
    setupRegistered(sb, "alex");
    const first = promotePersonai("alex");
    expect(first.alreadyPromoted).toBe(false);

    const second = promotePersonai("alex");
    expect(second.alreadyPromoted).toBe(true);
    expect(second.promotedPath).toBe(first.promotedPath);
  });

  it("refuses when destination already exists", () => {
    setupRegistered(sb, "alex");
    mkdirSync(join(sb.primaryRoot, "Alex"));

    expect(() => promotePersonai("alex")).toThrow(/already exists/);
  });

  it("respects --path override", () => {
    setupRegistered(sb, "alex");
    const custom = join(sb.testRoot, "Workspaces", "Alex");

    const result = promotePersonai("alex", { path: custom });

    expect(result.promotedPath).toBe(custom);
    expect(existsSync(custom)).toBe(true);
  });

  it("refuses when personai is not registered", () => {
    expect(() => promotePersonai("ghost")).toThrow(/not registered/);
  });

  it("refuses when no cache exists yet", () => {
    registerPersonai("alex", `file://${sb.remote}`);
    // No pullOrClone — cache absent.
    expect(() => promotePersonai("alex")).toThrow(/no cache/);
  });

  it("refuses when cache worktree is dirty (unless --force)", () => {
    setupRegistered(sb, "alex");
    writeFileSync(join(sb.cacheRoot, "alex", "CLAUDE.md"), "uncommitted\n");

    expect(() => promotePersonai("alex")).toThrow(/uncommitted changes/);

    // --force bypasses the check.
    const result = promotePersonai("alex", { force: true });
    expect(result.alreadyPromoted).toBe(false);
  });

  it("refuses when cache has unpushed local commits (unless --force)", () => {
    setupRegistered(sb, "alex");
    writeFileSync(join(sb.cacheRoot, "alex", "extra.txt"), "local\n");
    git(["add", "-A"], join(sb.cacheRoot, "alex"));
    git([...GIT_AUTHOR, "commit", "-m", "local-only"], join(sb.cacheRoot, "alex"));

    expect(() => promotePersonai("alex")).toThrow(/unpushed commit/);
  });
});

describe("demotePersonai", () => {
  let sb: Sandbox;
  beforeEach(() => { sb = newSandbox(); });
  afterEach(() => cleanup(sb));

  it("moves primary back into cache slot + clears registry", () => {
    setupRegistered(sb, "alex");
    const promoted = promotePersonai("alex");

    // Mark the primary distinctly so we can verify it's what ended up at the cache.
    const sentinel = join(promoted.promotedPath, "sentinel.txt");
    writeFileSync(sentinel, "primary\n");
    git(["add", "-A"], promoted.promotedPath);
    git([...GIT_AUTHOR, "commit", "-m", "sentinel"], promoted.promotedPath);
    // Push so safeSync's unpushed-check passes during demote.
    git(["push", "origin", "main"], promoted.promotedPath);

    const result = demotePersonai("alex");

    expect(result.previousPromotedPath).toBe(promoted.promotedPath);
    expect(existsSync(promoted.promotedPath)).toBe(false);
    expect(existsSync(result.cachePath)).toBe(true);
    expect(existsSync(join(result.cachePath, "sentinel.txt"))).toBe(true);

    const entry = loadRegistry().personae.find((p) => p.name === "alex");
    expect(entry?.promoted).toBeUndefined();
    expect(entry?.promotedPath).toBeUndefined();
  });

  it("refuses to demote when not promoted", () => {
    setupRegistered(sb, "alex");
    expect(() => demotePersonai("alex")).toThrow(/not promoted/);
  });
});

describe("locking", () => {
  let sb: Sandbox;
  beforeEach(() => { sb = newSandbox(); });
  afterEach(() => cleanup(sb));

  it("leaves no stale lock after successful promote", () => {
    setupRegistered(sb, "alex");
    promotePersonai("alex");
    expect(existsSync(join(sb.cacheRoot, ".locks", "alex.lock"))).toBe(false);
  });

  it("releases lock after a failed promote (destination conflict)", () => {
    setupRegistered(sb, "alex");
    mkdirSync(join(sb.primaryRoot, "Alex"));

    expect(() => promotePersonai("alex")).toThrow();
    expect(existsSync(join(sb.cacheRoot, ".locks", "alex.lock"))).toBe(false);
  });

  it("rejects concurrent promote if lock is held", () => {
    setupRegistered(sb, "alex");
    // Simulate a stale lock from a crashed prior run.
    mkdirSync(join(sb.cacheRoot, ".locks"), { recursive: true });
    writeFileSync(join(sb.cacheRoot, ".locks", "alex.lock"), "pid=99999 stale\n");

    expect(() => promotePersonai("alex")).toThrow(/locked/);
    // Stale lock content surfaced in error for operator inspection.
    // (Verified by the throw above; we don't introspect the message further.)
    // Manual cleanup:
    rmSync(join(sb.cacheRoot, ".locks", "alex.lock"));
  });
});
