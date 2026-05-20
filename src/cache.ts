// Personai cache lives at ~/.agiterra/personai/<name>/. Each entry is a
// git clone of the personai's repo — its CLAUDE.md and .knowledge/ at
// whatever HEAD the user last pulled.
//
// The cache root resolves through `cacheRoot()` rather than a top-level const
// so tests can override it via the SEANCE_CACHE_ROOT env var without having
// to re-import the module after mutating the environment.

import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function cacheRoot(): string {
  return process.env.SEANCE_CACHE_ROOT ?? join(homedir(), ".agiterra", "personai");
}

export function cachePath(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`Invalid personai name: ${name}`);
  }
  return join(cacheRoot(), name);
}

export function ensureCacheRoot(): void {
  const root = cacheRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
}
