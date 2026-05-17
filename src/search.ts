// Multi-vault search wrapper over Tim's vector-search.py --vault primitive.
//
// We don't reimplement the search — we compose on top of it. Each vault is
// queried independently with top-K=50, results are merged by raw cosine
// score (same embedding model → directly comparable), labeled by vault
// origin, and the top-N is returned.
//
// Resolves the canonical "knowledge-tools scripts" path from the local
// agiterra plugin cache so this works wherever the user installed it.

import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export interface VaultHit {
  source: string;     // file path or "j:N" for a journal entry
  type: "vault" | "journal";
  score: number;      // raw cosine, comparable across vaults using the same model
  summary: string;
  vault: string;      // label = the secondary key passed in
}

interface LabeledVault {
  label: string;      // human-readable origin tag ("project", "alex", "tankloop")
  vaultDir: string;   // absolute path to a .knowledge/ dir
}

function findKnowledgeScripts(): string {
  // Mirror of the canonical resolver used in Tim's hooks:
  //   ls -d ~/.claude/plugins/cache/*/knowledge/*/node_modules/@agiterra/knowledge-tools/scripts
  const root = join(homedir(), ".claude", "plugins", "cache");
  if (!existsSync(root)) {
    throw new Error("No Claude Code plugin cache found");
  }
  const candidates: string[] = [];
  for (const owner of readdirSync(root)) {
    const knowledgeDir = join(root, owner, "knowledge");
    if (!existsSync(knowledgeDir)) continue;
    for (const version of readdirSync(knowledgeDir)) {
      const scripts = join(
        knowledgeDir,
        version,
        "node_modules",
        "@agiterra",
        "knowledge-tools",
        "scripts",
      );
      if (existsSync(scripts)) candidates.push(scripts);
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      "knowledge-tools scripts not found. Install @agiterra/knowledge first.",
    );
  }
  return candidates[candidates.length - 1]!;
}

export function multiVaultSearch(
  query: string,
  vaults: LabeledVault[],
  topK = 10,
  perVaultK = 50,
): VaultHit[] {
  if (vaults.length === 0) return [];
  const scriptsDir = findKnowledgeScripts();
  const script = join(scriptsDir, "vector-search.py");

  const allHits: VaultHit[] = [];
  for (const { label, vaultDir } of vaults) {
    if (!existsSync(vaultDir)) continue;
    let raw: string;
    try {
      raw = execFileSync(
        "python3",
        [script, "--vault", vaultDir, "--top", String(perVaultK), "--json", query],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      continue; // skip vaults that fail (no vectors.db, etc.)
    }
    const hits = JSON.parse(raw) as Array<{
      source: string;
      type: "vault" | "journal";
      score: number;
      summary: string;
    }>;
    for (const h of hits) allHits.push({ ...h, vault: label });
  }

  allHits.sort((a, b) => b.score - a.score);
  return allHits.slice(0, topK);
}
