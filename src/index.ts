// @agiterra/seance-tools — primitives for borrowing AI personae.
//
// A personai is data: a CLAUDE.md identity contract + a .knowledge/ vault,
// versioned in a GitHub repo. This package handles the local cache, git
// lifecycle, multi-vault search composition, and borrow payload assembly.
// Runtime-specific overlay injection lives in adapter packages
// (seance-claude-code, seance-codex).

export { cachePath, ensureCacheRoot } from "./cache.ts";
export {
  registerPersonai,
  listPersonae,
  unregisterPersonai,
  loadRegistry,
} from "./registry.ts";
export { pullOrClone, resolveCommitSha, safeSync } from "./git-ops.ts";
export { multiVaultSearch, type VaultHit } from "./search.ts";
export { borrowPersonai, type BorrowPayload } from "./borrow.ts";
