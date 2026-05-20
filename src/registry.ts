// Personai registry — JSON list of registered repos, kept at
// ~/.agiterra/personai/registry.json. The registry tracks name → repo URL
// + last-pulled commit SHA + last-pulled timestamp. The cache directory
// holds the cloned content.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheRoot, ensureCacheRoot } from "./cache.ts";

function registryPath(): string {
  return join(cacheRoot(), "registry.json");
}
const REGISTRY_VERSION = 1;

export interface PersonaiEntry {
  name: string;
  repo: string;          // e.g. "agiterra/Alex" or full https URL
  commit?: string;       // last-pulled commit SHA
  pulledAt?: string;     // ISO timestamp of last successful pull
  registeredAt: string;  // ISO timestamp of original registration

  // Promotion: when set, the personai has a primary workspace at
  // `promotedPath` distinct from the cache. The cache at cachePath(name)
  // is still maintained as a fresh disposable mirror for borrows; the
  // primary is where the operator actually does work.
  promoted?: boolean;
  promotedAt?: string;     // ISO timestamp of promotion
  promotedPath?: string;   // absolute path of the primary workspace
}

interface Registry {
  version: number;
  personae: PersonaiEntry[];
}

export function loadRegistry(): Registry {
  ensureCacheRoot();
  if (!existsSync(registryPath())) {
    return { version: REGISTRY_VERSION, personae: [] };
  }
  const raw = readFileSync(registryPath(), "utf8");
  const parsed = JSON.parse(raw) as Registry;
  if (parsed.version !== REGISTRY_VERSION) {
    throw new Error(
      `Registry version mismatch: got ${parsed.version}, expected ${REGISTRY_VERSION}`,
    );
  }
  return parsed;
}

export function saveRegistry(reg: Registry): void {
  writeFileSync(registryPath(), JSON.stringify(reg, null, 2) + "\n");
}

export function registerPersonai(name: string, repo: string): PersonaiEntry {
  const reg = loadRegistry();
  if (reg.personae.some((p) => p.name === name)) {
    throw new Error(`Personai already registered: ${name}`);
  }
  const entry: PersonaiEntry = {
    name,
    repo,
    registeredAt: new Date().toISOString(),
  };
  reg.personae.push(entry);
  saveRegistry(reg);
  return entry;
}

export function unregisterPersonai(name: string): boolean {
  const reg = loadRegistry();
  const before = reg.personae.length;
  reg.personae = reg.personae.filter((p) => p.name !== name);
  if (reg.personae.length === before) return false;
  saveRegistry(reg);
  return true;
}

export function listPersonae(): PersonaiEntry[] {
  return loadRegistry().personae;
}

export function updatePersonaiState(
  name: string,
  patch: Partial<Omit<PersonaiEntry, "name" | "registeredAt">>,
): void {
  const reg = loadRegistry();
  const entry = reg.personae.find((p) => p.name === name);
  if (!entry) throw new Error(`Personai not registered: ${name}`);
  Object.assign(entry, patch);
  saveRegistry(reg);
}

export function findPersonai(name: string): PersonaiEntry | undefined {
  return loadRegistry().personae.find((p) => p.name === name);
}
