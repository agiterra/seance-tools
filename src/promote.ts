// promote / demote — move a personai between "borrowed cache" and
// "primary workspace" semantics on this host.
//
// Background: the borrow cache (~/.agiterra/personai/<name>/) is meant to be
// a disposable mirror of canonical state, refreshed on every summon. Some
// hosts want a personai to live as a full-time agent with host-specific
// branches and accumulated local work — that's primary-workspace semantics,
// incompatible with disposable-mirror semantics on the same directory.
//
// promote moves the on-disk repo to a real primary workspace at
// ~/Projects/<DisplayName>/ (or --path) and recreates the cache as a fresh
// shallow clone of canonical. After promotion:
//   - The primary is owned by the operator (commits, branches, vault writes).
//   - The cache is disposable. Future summons reset it to canonical without
//     touching the primary.
//   - borrowPersonai keeps reading from the cache — the invariant is preserved.
//
// demote reverses: moves the primary back to the cache slot, removes the
// promoted metadata, and the personai is once again a pure borrow.

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { cacheRoot, cachePath } from "./cache.ts";
import { loadRegistry, saveRegistry, type PersonaiEntry } from "./registry.ts";
import { withLock } from "./lock.ts";
import { safeSync, normalizeRepo } from "./git-ops.ts";

export interface PromoteOptions {
  /** Destination path. Default: ~/Projects/<DisplayName>/. */
  path?: string;
  /** Display name used in the default destination. Default: name with first letter capitalized. */
  displayName?: string;
  /** Skip live-agent + dirty/unpushed checks. Use with extreme care. */
  force?: boolean;
}

export interface PromoteResult {
  name: string;
  promotedPath: string;
  cachePath: string;
  alreadyPromoted: boolean;
}

export interface DemoteOptions {
  force?: boolean;
}

export interface DemoteResult {
  name: string;
  cachePath: string;
  previousPromotedPath: string;
}

function toDisplayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function findEntry(name: string): PersonaiEntry {
  const reg = loadRegistry();
  const entry = reg.personae.find((p) => p.name === name);
  if (!entry) throw new Error(`Personai ${name} is not registered.`);
  return entry;
}

/**
 * Best-effort detection of processes whose cwd is inside `dir`.
 *
 * On macOS, `lsof +D <dir>` walks every open file under <dir> across every
 * process the caller can see. It's broader than "cwd inside dir" (also catches
 * open file descriptors) but that's the conservative direction for a guard.
 *
 * Returns an array of human-readable lines (lsof output, minus the header) or
 * an empty array if lsof reports no processes or isn't available. We DO NOT
 * fail closed when lsof is missing — the guard is advisory; the lock + the
 * dirty/unpushed checks in safeSync are the real correctness backstops.
 */
function processesIn(dir: string): string[] {
  const r = spawnSync("lsof", ["+D", dir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (!r.stdout) return [];
  const lines = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  // First line is the COMMAND/PID header.
  return lines.slice(1);
}

function markerPath(name: string): string {
  return join(cacheRoot(), `.${name}.promote.in-progress`);
}

function ensureCleanCache(name: string, dest: string): void {
  // Delegate to safeSync's dirty/unpushed/divergence detection. fetch is a
  // no-op cost; the value is the matching error semantics.
  safeSync(dest, name);
}

export function promotePersonai(
  name: string,
  opts: PromoteOptions = {},
): PromoteResult {
  return withLock(name, () => {
    const entry = findEntry(name);
    const cache = cachePath(name);

    // Idempotency: if already promoted, ensure both ends still exist and return.
    if (entry.promoted) {
      if (!entry.promotedPath) {
        throw new Error(
          `Personai ${name} registry says promoted but promotedPath is missing. ` +
            `Inspect the registry at ${join(cacheRoot(), "registry.json")}.`,
        );
      }
      if (!existsSync(entry.promotedPath)) {
        throw new Error(
          `Personai ${name} is marked promoted but ${entry.promotedPath} does not exist. ` +
            `Restore the path, or unregister + re-register the personai.`,
        );
      }
      // Recreate cache if missing — it's disposable.
      if (!existsSync(cache)) {
        cloneFreshCache(entry.repo, cache);
      }
      return {
        name,
        promotedPath: entry.promotedPath,
        cachePath: cache,
        alreadyPromoted: true,
      };
    }

    // Pre-promotion checks.
    if (!existsSync(cache)) {
      throw new Error(
        `Personai ${name} has no cache at ${cache}. Run a borrow first ` +
          `(seance borrow ${name}) so there's something to promote.`,
      );
    }

    const displayName = opts.displayName ?? toDisplayName(name);
    // Explicit $HOME read so tests can redirect via env; falls back to the
    // OS-reported home dir.
    const home = process.env.HOME ?? homedir();
    const dest = opts.path ?? join(home, "Projects", displayName);

    if (existsSync(dest)) {
      throw new Error(
        `Promotion destination ${dest} already exists. Choose a different ` +
          `--path or remove the existing directory.`,
      );
    }

    if (!opts.force) {
      const procs = processesIn(cache);
      if (procs.length > 0) {
        throw new Error(
          `Personai ${name} cache has live processes (cwd or open files under ${cache}):\n` +
            procs.map((l) => `  ${l}`).join("\n") + "\n" +
            `Close them first, or pass --force to override (risks corrupting in-flight work).`,
        );
      }
      ensureCleanCache(name, cache);
    }

    // Transaction marker — if we crash mid-promote, this points the operator at
    // the partial state. We do NOT auto-rollback because the safer thing is
    // human inspection.
    const marker = markerPath(name);
    writeFileSync(
      marker,
      JSON.stringify(
        { from: cache, to: dest, startedAt: new Date().toISOString(), pid: process.pid },
        null,
        2,
      ) + "\n",
    );

    try {
      // 1. Move the repo to the destination.
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(cache, dest);

      // 2. Best-effort unshallow of the primary (cache was shallow clone).
      try {
        execFileSync("git", ["fetch", "--unshallow", "origin"], {
          cwd: dest,
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch {
        // Already complete history, or fetch failed transiently. Non-fatal.
      }

      // 3. Recreate the cache as a fresh shallow disposable mirror.
      cloneFreshCache(entry.repo, cache);

      // 4. Atomically update registry.
      const reg = loadRegistry();
      const liveEntry = reg.personae.find((p) => p.name === name);
      if (!liveEntry) {
        throw new Error(
          `Registry race: ${name} was unregistered mid-promote. Partial state: ` +
            `primary=${dest}, cache=${cache}. Inspect ${marker}.`,
        );
      }
      liveEntry.promoted = true;
      liveEntry.promotedAt = new Date().toISOString();
      liveEntry.promotedPath = dest;
      saveRegistry(reg);

      // 5. Clear the marker.
      try { unlinkSync(marker); } catch { /* ignore */ }

      return { name, promotedPath: dest, cachePath: cache, alreadyPromoted: false };
    } catch (e) {
      // Leave the marker in place for inspection. Don't attempt rollback — the
      // operator can move things back deterministically once they see the
      // marker's `from`/`to`.
      throw e;
    }
  });
}

export function demotePersonai(
  name: string,
  opts: DemoteOptions = {},
): DemoteResult {
  return withLock(name, () => {
    const entry = findEntry(name);
    if (!entry.promoted || !entry.promotedPath) {
      throw new Error(`Personai ${name} is not promoted; nothing to demote.`);
    }
    const primary = entry.promotedPath;
    const cache = cachePath(name);

    if (!existsSync(primary)) {
      throw new Error(
        `Promoted path ${primary} does not exist. Unregister + re-register to clean up the registry.`,
      );
    }

    if (!opts.force) {
      const procs = processesIn(primary);
      if (procs.length > 0) {
        throw new Error(
          `Promoted ${primary} has live processes:\n` +
            procs.map((l) => `  ${l}`).join("\n") + "\n" +
            `Close them first, or pass --force.`,
        );
      }
      ensureCleanCache(name, primary);
    }

    // Replace the cache with the primary.
    if (existsSync(cache)) {
      rmSync(cache, { recursive: true, force: true });
    }
    mkdirSync(dirname(cache), { recursive: true });
    renameSync(primary, cache);

    const reg = loadRegistry();
    const liveEntry = reg.personae.find((p) => p.name === name);
    if (liveEntry) {
      delete liveEntry.promoted;
      delete liveEntry.promotedAt;
      delete liveEntry.promotedPath;
      saveRegistry(reg);
    }

    return { name, cachePath: cache, previousPromotedPath: primary };
  });
}

function cloneFreshCache(repo: string, dest: string): void {
  // Mirror pullOrClone's clone shape so the recreated cache behaves
  // identically to a first-borrow cache.
  const url = normalizeRepo(repo);
  execFileSync("git", ["clone", "--depth", "50", "--no-single-branch", url, dest], {
    stdio: ["ignore", "ignore", "ignore"],
  });
}
