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

function normalizeRepo(repo: string): string {
  // Accept "owner/repo", "https://github.com/owner/repo", "git@github.com:owner/repo"
  if (repo.startsWith("https://") || repo.startsWith("git@")) return repo;
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}.git`;
  throw new Error(`Invalid repo spec: ${repo}`);
}

export function pullOrClone(name: string, repo: string): PullResult {
  ensureCacheRoot();
  const dest = cachePath(name);
  const url = normalizeRepo(repo);
  let cloned = false;

  if (!existsSync(dest)) {
    git(["clone", "--depth", "50", url, dest]);
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
    git(["fetch", "--depth", "50", "origin"], dest);
    git(["reset", "--hard", "origin/HEAD"], dest);
  }

  const commit = git(["rev-parse", "HEAD"], dest);
  return { path: dest, commit, cloned };
}

export function resolveCommitSha(name: string): string {
  return git(["rev-parse", "HEAD"], cachePath(name));
}
