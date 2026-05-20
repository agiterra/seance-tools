// Exercise safeSync against temp git repos. We do NOT touch the real
// ~/.agiterra/personai/ cache — every test scaffolds a bare remote +
// working clone under a mkdtemp directory and cleans up after itself.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeSync } from "../src/git-ops.ts";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const GIT_AUTHOR_ENV = [
  "-c", "user.email=test@example.invalid",
  "-c", "user.name=seance-test",
  "-c", "commit.gpgsign=false",
];

interface Sandbox {
  root: string;
  remote: string;   // bare repo acting as origin
  cache: string;    // working clone — what safeSync operates on
}

function commit(repo: string, message: string): string {
  git(["add", "-A"], repo);
  git([...GIT_AUTHOR_ENV, "commit", "-m", message], repo);
  return git(["rev-parse", "HEAD"], repo);
}

function newSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "seance-test-"));
  const remote = join(root, "remote.git");
  const cache = join(root, "cache");

  // Bare remote.
  mkdirSync(remote);
  git(["init", "--bare", "--initial-branch=main"], remote);

  // Seed the remote with one commit pushed from a scratch clone.
  const scratch = join(root, "scratch");
  git(["clone", remote, scratch], root);
  writeFileSync(join(scratch, "README.md"), "initial\n");
  commit(scratch, "initial");
  git(["push", "origin", "main"], scratch);
  rmSync(scratch, { recursive: true, force: true });

  // Cache mimics production pullOrClone: shallow but multi-branch.
  git(["clone", "--depth", "50", "--no-single-branch", remote, cache], root);
  return { root, remote, cache };
}

function cleanup(sb: Sandbox): void {
  rmSync(sb.root, { recursive: true, force: true });
}

describe("safeSync", () => {
  let sb: Sandbox;
  beforeEach(() => { sb = newSandbox(); });
  afterEach(() => cleanup(sb));

  it("no-ops when cache is clean and up-to-date with upstream", () => {
    const before = git(["rev-parse", "HEAD"], sb.cache);
    expect(() => safeSync(sb.cache, "test")).not.toThrow();
    expect(git(["rev-parse", "HEAD"], sb.cache)).toBe(before);
  });

  it("fast-forwards when cache is clean and behind upstream", () => {
    // Advance the remote by committing through a separate scratch clone.
    const scratch = join(sb.root, "advance");
    git(["clone", sb.remote, scratch], sb.root);
    writeFileSync(join(scratch, "advanced.txt"), "ahead\n");
    const newSha = commit(scratch, "advance");
    git(["push", "origin", "main"], scratch);

    safeSync(sb.cache, "test");

    expect(git(["rev-parse", "HEAD"], sb.cache)).toBe(newSha);
  });

  it("throws on dirty worktree", () => {
    writeFileSync(join(sb.cache, "README.md"), "uncommitted edit\n");
    expect(() => safeSync(sb.cache, "test")).toThrow(/uncommitted changes/);
  });

  it("throws on detached HEAD", () => {
    const sha = git(["rev-parse", "HEAD"], sb.cache);
    git(["checkout", "--detach", sha], sb.cache);
    expect(() => safeSync(sb.cache, "test")).toThrow(/detached HEAD/);
  });

  it("throws when current branch has no upstream", () => {
    git(["checkout", "-b", "local-only"], sb.cache);
    expect(() => safeSync(sb.cache, "test")).toThrow(/no upstream/);
  });

  it("throws when local branch is ahead of upstream (unpushed commit)", () => {
    writeFileSync(join(sb.cache, "extra.txt"), "local commit\n");
    commit(sb.cache, "local-only");
    expect(() => safeSync(sb.cache, "test")).toThrow(/unpushed commit/);
  });

  it("throws when local branch has diverged from upstream", () => {
    // Advance remote.
    const scratch = join(sb.root, "advance-diverge");
    git(["clone", sb.remote, scratch], sb.root);
    writeFileSync(join(scratch, "remote-only.txt"), "remote\n");
    commit(scratch, "remote-only");
    git(["push", "origin", "main"], scratch);

    // Advance local divergently.
    writeFileSync(join(sb.cache, "local-only.txt"), "local\n");
    commit(sb.cache, "local-only");

    let caught: Error | null = null;
    try { safeSync(sb.cache, "test"); } catch (e) { caught = e as Error; }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/unpushed commit/);
    expect(caught!.message).toMatch(/Diverged/);
  });

  it("syncs non-default branch to its own upstream when fast-forward is possible", () => {
    // Create `brian` branch on remote with extra commit; push.
    const scratch = join(sb.root, "brian-setup");
    git(["clone", sb.remote, scratch], sb.root);
    git(["checkout", "-b", "brian"], scratch);
    writeFileSync(join(scratch, "brian.txt"), "brian\n");
    commit(scratch, "brian commit");
    git(["push", "-u", "origin", "brian"], scratch);

    // Cache: fetch + check out brian tracking origin/brian.
    git(["fetch", "origin"], sb.cache);
    git(["checkout", "-b", "brian", "--track", "origin/brian"], sb.cache);

    // Advance remote brian.
    writeFileSync(join(scratch, "brian2.txt"), "brian2\n");
    const newBrianSha = commit(scratch, "brian2");
    git(["push", "origin", "brian"], scratch);

    // safeSync should fast-forward cache/brian to new remote brian.
    safeSync(sb.cache, "test");

    expect(git(["rev-parse", "HEAD"], sb.cache)).toBe(newBrianSha);
    expect(git(["symbolic-ref", "--short", "HEAD"], sb.cache)).toBe("brian");
  });
});
