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

export interface BorrowPayload {
  name: string;
  commit: string;
  claudeMd: string;
  sessionState: string | null;
  recentJournal: JournalSummary[];
  vaultDir: string;       // absolute path the adapter passes through to /knowledge:* later
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

  const root = cachePath(name);
  const vaultDir = join(root, ".knowledge");
  const claudeMd = readFileSafe(join(root, "CLAUDE.md")) ?? "";
  const sessionState = readFileSafe(join(vaultDir, "meta", "session-state.md"));
  const recentJournal = readRecentJournal(vaultDir);

  return {
    name,
    commit,
    claudeMd,
    sessionState,
    recentJournal,
    vaultDir,
  };
}
