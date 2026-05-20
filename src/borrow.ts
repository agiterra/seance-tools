// Borrow procedure: assemble the persona overlay payload from a personai's
// cached repo. Runtime adapters consume the payload and inject it into the
// running session in their own idiom (CC: user-prompt overlay; Codex: TBD).
//
// The payload is intentionally portable JSON — same shape regardless of
// runtime. Adapters can serialize it into whatever overlay form their
// runtime supports.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { cachePath } from "./cache.ts";
import { pullOrClone } from "./git-ops.ts";
import { findPersonai, updatePersonaiState } from "./registry.ts";

export interface JournalSummary {
  id: number;
  date: string;
  category: string;
  summary: string;
}

export interface BorrowProvenance {
  repo: string;                       // origin URL or owner/repo as registered
  branch: string | null;              // current branch in the cache, null if detached
  commit: string;                     // short SHA of HEAD
  dirty: boolean;                     // true if cache worktree has uncommitted changes
  workspace: "cache";                 // always "cache" — borrow invariant
  workspacePath: string;              // absolute path the cache lives at
  promotedPrimaryPath: string | null; // set if a promoted primary exists on this host (for display)
}

export interface BorrowPayload {
  name: string;
  commit: string;
  claudeMd: string;
  sessionState: string | null;
  recentJournal: JournalSummary[];
  vaultDir: string;       // absolute path the adapter passes through to /knowledge:* later
  provenance: BorrowProvenance;
}

function readFileSafe(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function readRecentJournal(vaultDir: string, limit = 5): JournalSummary[] {
  const db = join(vaultDir, "journal.db");
  if (!existsSync(db)) return [];
  let raw: string;
  try {
    raw = execFileSync(
      "sqlite3",
      [
        db,
        `SELECT id, date(timestamp), category, substr(summary, 1, 200)
         FROM journal ORDER BY id DESC LIMIT ${limit}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    return [];
  }
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, date, category, summary] = line.split("|");
      return {
        id: Number(id),
        date: date ?? "",
        category: category ?? "",
        summary: summary ?? "",
      };
    });
}

export interface BorrowOptions {
  /** Skip git pull (use cached state). For tests / cold-start scenarios. */
  skipPull?: boolean;
}

export function borrowPersonai(
  name: string,
  opts: BorrowOptions = {},
): BorrowPayload {
  const entry = findPersonai(name);
  if (!entry) {
    throw new Error(
      `Personai not registered: ${name}. Run: seance register <repo>`,
    );
  }

  let commit: string;
  if (opts.skipPull) {
    commit = entry.commit ?? "unknown";
  } else {
    const pull = pullOrClone(name, entry.repo);
    commit = pull.commit;
    updatePersonaiState(name, {
      commit,
      pulledAt: new Date().toISOString(),
    });
  }

  // borrowPersonai ALWAYS reads from the cache — this is the borrow invariant
  // (see docs/decisions/cache-workspace-safety.md). The promoted primary, if
  // one exists, is the operator's owned workspace; seance never touches it on
  // borrow. Provenance reports the cache's state plus a flag indicating
  // whether a promoted primary also exists on this host.
  const root = cachePath(name);
  const vaultDir = join(root, ".knowledge");
  const claudeMd = readFileSafe(join(root, "CLAUDE.md")) ?? "";
  const sessionState = readFileSafe(join(vaultDir, "meta", "session-state.md"));
  const recentJournal = readRecentJournal(vaultDir);

  const promotedExists =
    entry.promoted === true &&
    typeof entry.promotedPath === "string" &&
    existsSync(entry.promotedPath);

  // Provenance — small git probe of the cache dir. Errors fall back to safe defaults.
  const provenance: BorrowProvenance = {
    repo: entry.repo,
    branch: gitTrim(["symbolic-ref", "--short", "HEAD"], root) ?? null,
    commit: gitTrim(["rev-parse", "--short", "HEAD"], root) ?? commit.slice(0, 7),
    dirty: (gitTrim(["status", "--porcelain"], root) ?? "").length > 0,
    workspace: "cache",
    workspacePath: root,
    promotedPrimaryPath: promotedExists ? (entry.promotedPath as string) : null,
  };

  return {
    name,
    commit,
    claudeMd,
    sessionState,
    recentJournal,
    vaultDir,
    provenance,
  };
}

function gitTrim(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
