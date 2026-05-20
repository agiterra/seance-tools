# Decision: Cache and workspace safety

**Status:** Adopted · **Date:** 2026-05-20 · **Authors:** alex (orchestrator), Kiln (validator), fondant-overlay

## Background

On 2026-05-19 / 2026-05-20, three commits on `agiterra/fondant`'s `brian` branch were silently destroyed across two `seance:summon fondant` calls. Root cause: `pullOrClone` in `@agiterra/seance-tools/src/git-ops.ts` ran `git reset --hard origin/HEAD` on every existing-cache borrow. Any local commits on the cache that weren't on `origin/HEAD` were wiped without warning.

Two PRs in this repo addressed the failure:

- **PR #1** (`safe-sync`, commit `7413d62`) — replaced the destructive reset with `safeSync`: fetch, then fast-forward the current branch to its upstream only if the worktree is clean, branch tracks an upstream, and the local has no unpushed commits. Any of those preconditions fail → throw with branch + SHA + recovery guidance, never overwrite.
- **PR #2** (`promote`, commit `594176e`) — added `seance promote` / `seance demote`. `promote` moves the cache to a primary workspace at `~/Projects/<DisplayName>/` and recreates the cache as a fresh disposable mirror. Future summons keep reading from the recreated cache; the primary is operator-owned. `demote` reverses.

This decision records the model both PRs encode, so future changes don't drift from it.

## Decision

Four invariants govern caches and workspaces under `seance`:

1. **Borrowed caches are disposable.** Anything that lives only in `~/.agiterra/personai/<name>/` is allowed to be wiped on the next summon. Operators should never accumulate durable work in a cache.

2. **Dirty or diverged caches fail loud.** `safeSync` refuses to overwrite a worktree with uncommitted changes, a non-tracking branch, unpushed local commits, or a divergent branch. The operator sees a precise error with branch name, local SHA, upstream SHA, and a recovery command. The tool never silently destroys state to make the operation succeed.

3. **Promotion creates durable ownership.** `seance promote <name>` is the supported path from "borrowed cache" to "primary workspace." After promotion, the workspace is owned by the operator; the cache is recreated as a fresh shallow mirror and continues to behave per invariants (1)–(2). Future `seance:summon` always reads from the cache, never from the primary — the borrow contract stays clean.

4. **There is no destructive recovery path.** When a cache is in an inconsistent state, the tool does not "fix" it by resetting. The operator resolves manually (commit, stash, restore, push, rebase, or merge) and re-runs. Anything else risks recreating the original incident.

## Scope

This decision covers `seance-tools` cache + workspace semantics only. It does NOT cover knowledge architecture, persona inheritance, role archetypes, manifest-driven discovery, or related multi-layer designs. Those topics are explored in `docs/plans/knowledge-architecture.md` (currently parked) and `agiterra/handbook/rfcs/2026-05-20-knowledge-bases.md`. They are not implemented and there is no committed timeline for implementing them.

## Consequences

- Operators using `seance:summon` on a clone they've been editing in-place will get a hard error on next summon. This is intended; previously they would silently lose work. The operator action is to push their commits (or stash + retry), not to expect the tool to figure it out.
- Operators who want a personai as a long-lived primary workspace use `seance promote`. After promotion, normal git workflows (branch, commit, push) apply; `seance:summon` no longer touches the primary.
- Tooling that wraps `seance-tools` MUST surface the `safeSync` error messages to the operator unchanged. Hiding them or auto-resolving recreates the original failure class.

## Related

- Implementation: `src/git-ops.ts:safeSync`, `src/promote.ts:promotePersonai`, `src/promote.ts:demotePersonai`.
- Tests: `tests/git-ops.test.ts`, `tests/promote.test.ts`.
- Holistic-step-back review (2026-05-20): confirmed these four invariants are the minimum needed to prevent the observed incident. Anything beyond is currently speculative.
