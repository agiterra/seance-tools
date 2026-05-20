// Git operations for personai repos: clone (first borrow), pull (re-borrow),
// and SHA resolution for content-pinning. Style cribbed from
// agiterra/crew-themes server.ts:95-145 — the content-hash-pinned install
// pattern is solid supply-chain hygiene.

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cachePath, ensureCacheRoot } from "./cache.ts";

export interface PullResult {
  path: string;
  commit: string;
  cloned: boolean;     // true if first-time clone, false if pull-into-existing
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function normalizeRepo(repo: string): string {
  // Accept "owner/repo", "https://github.com/owner/repo",
  // "git@github.com:owner/repo", and "file:///abs/path" (the last is mainly for
  // tests pointing at local bare repos, but also a legit air-gapped scheme).
  if (
    repo.startsWith("https://") ||
    repo.startsWith("git@") ||
    repo.startsWith("file://")
  ) return repo;
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}.git`;
  throw new Error(`Invalid repo spec: ${repo}`);
}

export function pullOrClone(name: string, repo: string): PullResult {
  ensureCacheRoot();
  const dest = cachePath(name);
  const url = normalizeRepo(repo);
  let cloned = false;

  if (!existsSync(dest)) {
    // --no-single-branch overrides --depth's implicit --single-branch so the
    // cache can see all remote branches. Without this, a personai with a
    // host-specific branch (e.g. `brian`) would be unreachable from the cache
    // even after `git fetch` — `origin/brian` simply never enters
    // refs/remotes/origin/.
    git(["clone", "--depth", "50", "--no-single-branch", url, dest]);
    cloned = true;
  } else {
    // Verify the remote URL still matches what's registered. Drift here =
    // the user re-registered with a different repo, which we treat as an error.
    const currentRemote = git(["remote", "get-url", "origin"], dest);
    if (currentRemote !== url) {
      throw new Error(
        `Personai ${name} remote drift: cache=${currentRemote}, registry=${url}`,
      );
    }
    safeSync(dest, name);
  }

  const commit = git(["rev-parse", "HEAD"], dest);
  return { path: dest, commit, cloned };
}

/**
 * Bring an existing personai cache at `dest` up to date with origin, but only
 * when it's safe to do so.
 *
 * Prior implementations used `git reset --hard origin/HEAD`, which silently
 * destroyed any local commits, journal writes, or uncommitted edits accumulated
 * in the cache. The 2026-05 brian-branch wipe incident (three commits lost to
 * two seance:summon calls hitting the destructive reset) motivated the safer
 * semantics here.
 *
 * Behavior:
 *   - Fetches origin.
 *   - Fast-forwards the current branch to its upstream when possible
 *     (or no-ops when already at upstream).
 *
 * Throws (with a precise, actionable message) when any of:
 *   - the worktree has uncommitted changes
 *   - HEAD is detached
 *   - the current branch has no upstream
 *   - the local branch is ahead of upstream (would lose unpushed commits)
 *   - the local branch has diverged from upstream
 *
 * `name` is only used in error messages; pass "<cache>" or the personai name.
 */
export function safeSync(dest: string, name: string = "<cache>"): void {
  git(["fetch", "--depth", "50", "origin"], dest);

  // 1. Refuse if the worktree has uncommitted changes.
  const dirty = git(["status", "--porcelain"], dest);
  if (dirty.length > 0) {
    throw new Error(
      `Personai ${name} cache has uncommitted changes; refusing to sync.\n` +
        `Dirty paths in ${dest}:\n` +
        dirty.split("\n").map((l) => `  ${l}`).join("\n") +
        `\nResolve manually (commit, stash, or restore) then retry.`,
    );
  }

  // 2. Reject detached HEAD — we can't pick a safe sync target without a branch.
  let branch: string;
  try {
    branch = git(["symbolic-ref", "--short", "HEAD"], dest);
  } catch {
    const head = safeRevParse(dest, "HEAD") ?? "unknown";
    throw new Error(
      `Personai ${name} cache has detached HEAD at ${head}; refusing to sync.\n` +
        `Check out a branch in ${dest}, then retry.`,
    );
  }

  // 3. Resolve the upstream for the current branch.
  let upstream: string;
  try {
    upstream = git(["rev-parse", "--abbrev-ref", `${branch}@{u}`], dest);
  } catch {
    throw new Error(
      `Personai ${name} cache branch '${branch}' has no upstream; refusing to sync.\n` +
        `Either set one (\`git -C ${dest} branch --set-upstream-to=origin/<branch> ${branch}\`)\n` +
        `or check out a branch that tracks origin, then retry.`,
    );
  }

  // 4. Compute ahead/behind. ahead = local commits not in upstream,
  //    behind = upstream commits not in local.
  const counts = git(
    ["rev-list", "--left-right", "--count", `${branch}...${upstream}`],
    dest,
  );
  const [aheadStr, behindStr] = counts.split(/\s+/);
  const ahead = Number(aheadStr);
  const behind = Number(behindStr);

  if (ahead > 0) {
    const localSha = git(["rev-parse", "--short", branch], dest);
    const upstreamSha = git(["rev-parse", "--short", upstream], dest);
    throw new Error(
      `Personai ${name} cache branch '${branch}' has ${ahead} unpushed commit(s); refusing to sync.\n` +
        `  local  ${branch}: ${localSha}\n` +
        `  remote ${upstream}: ${upstreamSha}\n` +
        (behind > 0
          ? `Diverged (also ${behind} commit(s) behind). Rebase or merge in ${dest}, then retry.`
          : `Push the local commits (\`git -C ${dest} push\`) or reset (\`git -C ${dest} reset --hard ${upstream}\`) to discard them, then retry.`),
    );
  }

  // 5. Safe to fast-forward (no-op when behind == 0).
  if (behind > 0) {
    git(["merge", "--ff-only", upstream], dest);
  }
}

function safeRevParse(dest: string, ref: string): string | null {
  try {
    return git(["rev-parse", ref], dest);
  } catch {
    return null;
  }
}

export function resolveCommitSha(name: string): string {
  return git(["rev-parse", "HEAD"], cachePath(name));
}
