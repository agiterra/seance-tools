// Personai cache lives at ~/.agiterra/personai/<name>/. Each entry is a
// git clone of the personai's repo — its CLAUDE.md and .knowledge/ at
// whatever HEAD the user last pulled.

import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const CACHE_ROOT = join(homedir(), ".agiterra", "personai");

export function cachePath(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`Invalid personai name: ${name}`);
  }
  return join(CACHE_ROOT, name);
}

export function ensureCacheRoot(): void {
  if (!existsSync(CACHE_ROOT)) {
    mkdirSync(CACHE_ROOT, { recursive: true });
  }
}
