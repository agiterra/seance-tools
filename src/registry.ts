// Personai registry — JSON list of registered repos, kept at
// ~/.agiterra/personai/registry.json. The registry tracks name → repo URL
// + last-pulled commit SHA + last-pulled timestamp. The cache directory
// holds the cloned content.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_ROOT, ensureCacheRoot } from "./cache.ts";

const REGISTRY_PATH = join(CACHE_ROOT, "registry.json");
const REGISTRY_VERSION = 1;

export interface PersonaiEntry {
  name: string;
  repo: string;          // e.g. "workshop162/Alex" or full https URL
  commit?: string;       // last-pulled commit SHA
  pulledAt?: string;     // ISO timestamp of last successful pull
  registeredAt: string;  // ISO timestamp of original registration
}

interface Registry {
  version: number;
  personae: PersonaiEntry[];
}

export function loadRegistry(): Registry {
  ensureCacheRoot();
  if (!existsSync(REGISTRY_PATH)) {
    return { version: REGISTRY_VERSION, personae: [] };
  }
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  const parsed = JSON.parse(raw) as Registry;
  if (parsed.version !== REGISTRY_VERSION) {
    throw new Error(
      `Registry version mismatch: got ${parsed.version}, expected ${REGISTRY_VERSION}`,
    );
  }
  return parsed;
}

function saveRegistry(reg: Registry): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n");
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
  patch: Partial<Pick<PersonaiEntry, "commit" | "pulledAt">>,
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
