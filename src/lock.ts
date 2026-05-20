// Per-personai advisory lock. Prevents borrow / promote / demote / unregister
// from racing on the same personai. Implementation is a simple O_EXCL lock
// file at `<cacheRoot>/.locks/<name>.lock` — the lock file's existence is the
// lock; its content is informational (PID + start time) for debugging stale
// locks.
//
// Stale locks: if a holder crashes between `openSync(wx)` and `unlinkSync`,
// the lock file is leaked and subsequent operations fail until the file is
// removed manually. We surface a clear error and the PID/timestamp inside so
// the operator can decide. We do NOT auto-clean — racing against a real
// concurrent holder is worse than asking a human to inspect.

import { mkdirSync, openSync, closeSync, writeSync, unlinkSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cacheRoot } from "./cache.ts";

export function locksDir(): string {
  return join(cacheRoot(), ".locks");
}

function lockPath(name: string): string {
  return join(locksDir(), `${name}.lock`);
}

export function withLock<T>(name: string, fn: () => T): T {
  mkdirSync(locksDir(), { recursive: true });
  const path = lockPath(name);

  let fd: number;
  try {
    // O_EXCL: open fails if the file already exists.
    fd = openSync(path, "wx");
  } catch {
    let detail = "";
    if (existsSync(path)) {
      try {
        detail = ` (holder: ${readFileSync(path, "utf8").trim()})`;
      } catch { /* ignore */ }
    }
    throw new Error(
      `Personai ${name} is locked${detail}. Another seance operation is in ` +
        `progress, or a previous run crashed and left a stale lock at ${path}.`,
    );
  }

  try {
    writeSync(fd, `pid=${process.pid} startedAt=${new Date().toISOString()}\n`);
  } catch { /* informational only */ }

  try {
    return fn();
  } finally {
    closeSync(fd);
    try { unlinkSync(path); } catch { /* lock file already gone */ }
  }
}
