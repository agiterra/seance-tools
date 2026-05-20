# Knowledge Architecture Rollout Plan — v2

> **v2 changelog (alex/fondant edit, 2026-05-20 13:23 EDT)** — based on Kiln's v1 (`/tmp/kiln-knowledge-architecture-plan.md`) + alex/fondant critique. Changes:
>
> 1. **Reordered**: frontmatter schema spec moved from Phase 4 into Phase 3 prep, so the content migration writes proper frontmatter as it goes instead of needing a retrofit pass. Phase 4 is now tooling-only.
> 2. **Phase 2 split** into 2a (composer in seance-tools) and 2b (adapter integration in seance-claude-code). Adapter coordination is real per-PR work, not "minimal" — splitting surfaces it.
> 3. **Phase 3 cutover step** added explicitly. Kiln's plan said "leave PID 28868 alone" + cross-phase invariant says "running agents finish under the identity they booted with" — but didn't surface the user-action moment when Brian closes the old agent and spawns the new one. Now an explicit deliverable.
> 4. **Pending-handbook universal-doctrine policy** added to Phase 3. Currently `agiterra/fondant` carries universal feedback rules (never-swallow-errors, etc.). With Phase 8 (handbook) deferred, those need a temporary home. Policy: they land in `toolsmith-core` for now with `scope: handbook-candidate` frontmatter, re-route upstream when handbook materializes.
> 5. **Stop-here line moved** from "after Phase 3" to "after Phase 4." Phase 4 (frontmatter routing tooling) is cheap discipline that makes everything downstream cleaner. The marginal cost is low; the marginal value is high. Stopping at Phase 3 leaves the system without the routing labels the whole architecture depends on.
> 6. **Effort estimates** added inline per phase. Rough sketch only; corrects scope drift.
> 7. **Phase 9 placeholder** (discovery registry) added so it's not forgotten when 3+ role-cores or 5+ personae materialize.
>
> All other Kiln-v1 content stands. Push back on these changes where wrong.

---

## Overview

Roll this out as a dependency chain, not a big-bang migration: first finish the safe workspace/promote foundation, then add version-pinned persona inheritance with composed CLAUDE.md and a frontmatter-disciplined content migration, then optionally extend with composition manifests, recall governance, cross-business pilot, and handbook layer.

**Stop-here candidate:** after Phase 4. That delivers safe seance cache + version-pinned inheritance + section composition with stale-override warnings + multi-vault search + real `toolsmith-core` + real `agiterra/fondant` specialization + boot provenance + frontmatter routing + a working promote-rule helper. Roughly **3–5 focused days** of work to that line. Phases 5–9 deferred until use cases demand them.

---

## Phase 0: Stabilize Current Seance Primitives

**Effort estimate:** trivial — gated only on Brian's merge of PR #2. ~0 days of new code.

**Purpose:** land the already-started foundation before adding inheritance. Do not build new architecture on a moving cache model.

**Deliverables:**

- Merge PR #2 in `agiterra/seance-tools`: `promote` / `demote` primitives.
- Verify PR #1 `safeSync` behavior stays intact after PR #2.
- Add a minimal regression fixture for divergent cache state.
- (Optional, low cost) document the current cache/workspace lifecycle in seance-tools README. Punt if scope risks growing.

**Decisions needed before start:**

- Confirm PR #2 command surface is final enough for inheritance work to depend on.
- Decide whether `demote` means "return to disposable cache" only, or also supports explicit recall semantics later. **Recommendation:** keep current demote narrow; do not overload it with knowledge recall.

**Repos / ownership:**

- `agiterra/seance-tools`: Brian-owned per j:9 context, fast merge.
- No persona repo changes.

**Risks:**

- Cache state corruption or workspace promotion ambiguity.
- New inheritance work starts while PR #2 semantics are still changing.

**Rollback:**

- Revert PR #2 only; PR #1 `safeSync` can remain.
- Delete promoted local workspace and recreate cache from remote if needed.

**Test plan:**

- Unit: `pullOrClone` refuses dirty/diverged cache.
- Unit: `promote` moves a cached repo to primary workspace and recreates disposable cache.
- Unit: `demote` restores expected disposable mode.
- Integration: register a persona, borrow, promote, edit, demote, borrow again.

---

## Phase 1: Registry Extends + Pinned Dependency Lock

**Effort estimate:** ½–1 day.

**Purpose:** add inheritance metadata without changing prompt composition yet. The system should understand dependency graphs before it acts on them.

**Deliverables:**

- Extend seance registry schema with `extends: []` (array — supports both single-role and Flavor-2 multi-role inheritance).
- Each `extends` entry includes `name`, `repo`, and required pinned `ref`.
- Add a generated lockfile recording resolved commit SHAs:

```json
{
  "identity": "agiterra/fondant",
  "dependencies": [
    {
      "name": "toolsmith-core",
      "repo": "agiterra/toolsmith-core",
      "ref": "v0.1.0",
      "sha": "..."
    }
  ],
  "resolved_at": "2026-05-20T..."
}
```

- Lockfile lives in seance cache/workspace metadata, **not** committed to persona repos by default.
- Add dependency fetch order: parents before children.
- Add validation for cycles and missing refs.
- Keep existing borrow behavior unchanged until Phase 2 lands the composer.

**Decisions needed before start:**

- Registry schema versioning: **recommendation** `schema_version: 2` at the registry root.
- Pin format: **recommendation** tags or explicit SHAs; branches allowed only with `allow_unpinned: true` in dev mode.
- Whether multi-extends conflict resolution lives in Phase 1 or Phase 2. **Recommendation:** validation in Phase 1 (reject cycles, reject missing refs, reject conflicting role-cores without explicit override), conflict resolution in Phase 2 (composer's section-level logic).

**Repos / ownership:**

- `agiterra/seance-tools`: registry, dependency resolver, lockfile.
- Runtime adapters not modified yet.

**Risks:**

- Auto-pull semantics accidentally update inherited identity (mitigated by required pinned ref).
- Cycles or missing refs create confusing boot failures (mitigated by validation).

**Rollback:**

- Registry keeps backward compatibility. Remove `extends` from affected entries and borrow works as before.
- Lockfile can be deleted and regenerated.

**Test plan:**

- Unit: valid single dependency resolves to SHA.
- Unit: missing tag fails loud.
- Unit: branch ref rejected unless dev mode permits it.
- Unit: dependency cycle rejected.
- Integration: mock `toolsmith-core` + mock persona registered with `extends`; resolver fetches both but borrow output remains old behavior.

---

## Phase 2a: Section Composer in seance-tools

**Effort estimate:** 1–1.5 days.

**Purpose:** produce a resolved composed CLAUDE.md + composition report from pinned layers. Pure data transformation in seance-tools — no adapter changes yet.

**Deliverables:**

- Define section marker format in core CLAUDE.md files:

```md
<!-- section:operator-model version:1 -->
...
<!-- /section:operator-model -->
```
   Note: HTML comments are invisible to runtime prompt consumption (CC/Codex), so they survive composition cleanly. Markdown renderers that *strip* HTML comments would lose section boundaries — fine for runtime, document this if anyone ever renders these to docs.

- Define specialization override file format with `append`, `replace`, `disable`, and `based_on` hash for replacement.
- Implement composer:
  - parent sections load first;
  - child appends by default;
  - replace/disable require explicit section ID;
  - stale replace emits warning when parent section hash changed since `based_on`;
  - vault composition: ordered list `[handbook?, role-cores..., persona, host-overlay]` — passed straight to `multiVaultSearch` as the existing `{label, vaultDir}[]` shape;
  - journal is specialization-only — composer does NOT read journal from role-cores or handbook.
- Emit:
  - resolved CLAUDE.md text;
  - composition report (sections used, sections overridden, stale warnings, dependency lockfile contents);
  - provenance block for boot display.

**Decisions needed before start:**

- Warning channel: **recommendation** fail-loud for stale safety-critical sections (`core-behavior`, `write-safety`, `review-standards`), warn for ordinary sections.
- Resolved prompt artifact: **recommendation** generated into cache for runtime use, optionally committed during migration PRs for human diff review, then re-generated at runtime thereafter (gitignore the artifact after migration).
- Order resolution for multi-extends (Flavor 2): **recommendation** explicit list order — first-listed applied first, later entries override prior. Specialization MUST explicitly resolve any conflicting same-named sections via `replace`.

**Repos / ownership:**

- `agiterra/seance-tools` only.

**Risks:**

- Over-complicated override format blocks migration.
- Stale warnings get ignored if buried in logs.

**Rollback:**

- Feature flag composition off per registry entry. Fall back to direct persona CLAUDE.md.

**Test plan:**

- Unit: append-only composition.
- Unit: replace known section.
- Unit: stale replace warning when core section changes.
- Unit: disable section.
- Unit: multi-extends with conflicting sections rejected without explicit override.
- Snapshot: resolved prompt is stable for a fixture.
- Snapshot: composition report matches expected structure.

---

## Phase 2b: Adapter Integration

**Effort estimate:** ½ day.

**Purpose:** teach the CC adapter (and later Codex adapter) to consume the composed payload from `seance_borrow`. This is a separate repo with its own PR cycle — surface the coordination cost.

**Deliverables:**

- Update `agiterra/seance-claude-code` so the `/seance:summon` skill uses the composed CLAUDE.md from `seance_borrow`'s response, falling back to the direct persona CLAUDE.md when the registry entry has no `extends`.
- Surface the provenance block in the summon overlay output (one-line: `Embodying <name>. identity: <persona>, extends: <core>@<ref>, host-overlay: <branch?>, resolved-at: <ts>`).
- Surface stale-override warnings to the operator at summon time.
- `seance-codex` adapter integration **deferred** — only needed if/when a Codex persona starts inheriting. Phase 3 pilot is Fondant (CC), so codex adapter can lag.

**Decisions needed before start:**

- Provenance display format: one line vs. multi-line block. **Recommendation:** one line on summon, full block written into session-state.md for audit.

**Repos / ownership:**

- `agiterra/seance-claude-code`.
- `agiterra/seance-codex` deferred.

**Risks:**

- CC adapter PR + seance-tools PR coordination — landing order matters.
- Codex adapter lag means Codex personae temporarily can't use inheritance (acceptable — none do today).

**Rollback:**

- Feature flag the new CLAUDE.md consumption per persona in adapter config. Falls back to direct CLAUDE.md.

**Test plan:**

- Manual: summon a mock persona with `extends` from a CC session, verify composed identity appears and provenance line shows.
- Manual: stale-override warning surfaces visibly during summon.

---

## Phase 3: Content Pilot — `toolsmith-core` + `agiterra/fondant` (with frontmatter from the start)

**Effort estimate:** 1–1.5 days. Includes the frontmatter schema spec (prerequisite) and migration content classification.

**Purpose:** prove the architecture with one real role archetype and one real specialization. First value-delivering phase.

**Prerequisites:**

- **Frontmatter schema v1 spec** defined before any content moves. Spec lives in seance-tools docs (or a new agiterra/architecture repo if Brian wants one):

```yaml
---
schema: knowledge-note/v1
scope: local | composition | persona | role | docs | handbook-candidate
owner: repo-or-persona-name
status: local | candidate | platform | recalled
origin: optional-repo:path
spinoff: travels-with-owner | parent-context-only | duplicate-on-export
related:
  - optional-path-or-url
---
```
   No tooling yet — that's Phase 4. But the SHAPE is fixed so the migration writes notes in the right form.

**Deliverables:**

- Create new repo `agiterra/toolsmith-core` from a copy of agiterra/fondant, not a move.
- Strip core content of:
  - operator names;
  - Tim/Brioche/Herald specifics;
  - Brian host facts;
  - project paths;
  - project/code memory.
- Add section markers to core CLAUDE.md.
- **Classify each surviving note** with frontmatter as it lands in core:
  - role-general toolsmith doctrine → `scope: role, owner: agiterra/toolsmith-core, status: platform`
  - universal-engineering doctrine (never-swallow-errors, semver, etc.) → **temporary policy:** lives in toolsmith-core with `scope: handbook-candidate, status: platform` until Phase 8 materializes; then re-routes upstream.
- Tag `toolsmith-core@v0.1.0`.
- Update `agiterra/fondant` mainline to extend `toolsmith-core@v0.1.0`.
- Remove from `agiterra/fondant`'s vault any note that was promoted to core (or mark with `status: recalled` if leaving as audit trail).
- Generate resolved Fondant prompt + composition report; commit during migration for review diff against pre-migration Fondant prompt. Behavioral diff should be intentional and small.
- Update brian branch only after mainline works; keep it host-overlay-only (strip any operator/project identity that crept in).

**Live-agent cutover step (explicit):**

- After mainline migration commits land + composed prompt is reviewed:
  1. `mcp__plugin_crew_crew__agent_close({id: "fondant"})` — clean shutdown, fires SessionEnd hooks.
  2. Verify wire row goes to disconnected state; cache stays as-is (no destructive ops).
  3. `seance:summon fondant` (or relaunch via crew agent_launch with new composed identity).
  4. Verify provenance line in the boot overlay shows `extends: agiterra/toolsmith-core@v0.1.0`.
  5. If anything looks wrong, rollback path: feature-flag composition off; agent re-summons under direct CLAUDE.md.

**Decisions needed before start:**

- Final name: **recommendation** `toolsmith-core`, not `fondant-core` (per Kiln's earlier review).
- Whether resolved prompt artifact stays committed in `agiterra/fondant` after migration. **Recommendation:** commit once during migration for the review diff, then `.gitignore` it and let runtime regenerate. Don't half-commit a stale artifact.
- Governance for `toolsmith-core`: **recommendation** Agiterra-owned, single-owner-with-PR-contributions (per Kiln Q3).

**Repos / ownership:**

- `agiterra/toolsmith-core`: new repo; Agiterra-owned.
- `agiterra/fondant`: specialization repo, existing.
- No TankLoop persona yet (that's Phase 7).

**Risks:**

- Accidentally moving project memory into role core (mitigated by frontmatter classification + manual review).
- Breaking Fondant's current identity (mitigated by prompt diff review + feature flag rollback).
- Brian branch starts carrying operator/project identity instead of host-only overlay (mitigated by explicit strip pass).
- Cutover window — operator sees old Fondant disappear and new Fondant come up; should be smooth but not zero-downtime.

**Rollback:**

- Keep old `agiterra/fondant` tag before migration.
- Remove `extends` from registry and borrow old direct CLAUDE.md.
- Revert `agiterra/fondant` migration commit if composed prompt diverges too much.
- Do not delete any original notes until after successful new-session validation.

**Test plan:**

- Content audit: every moved note classified with frontmatter; every retained note classified.
- Prompt diff: old Fondant vs resolved Fondant reviewed manually before cutover.
- Borrow integration: new session boots with provenance line.
- Search integration: `multiVaultSearch` returns core and specialization hits with source labels.
- Live safety: old PID 28868 cleanly shut down via agent_close; new session boots from composed identity.

---

## Phase 4: Routing Tooling (frontmatter validator + promote-rule helper)

**Effort estimate:** ½–1 day.

**Purpose:** make future knowledge movement explicit and tool-supported. Schema was specified in Phase 3 prereq; this is the tooling on top.

**Deliverables:**

- Add a frontmatter validator command in `seance-tools`.
- Add `seance promote-rule <note>` helper:
  - parses frontmatter;
  - asks the 5-question routing algorithm (universal? role-general? submodule? composition? otherwise stay-put);
  - rewrites promoted note to remove project facts;
  - records `origin: <source-repo>:<path>` in destination;
  - opens a PR (or stages a commit) against the target repo;
  - updates local copy's frontmatter to `status: candidate, pending-promotion-to: <target>`.
- Add `candidate` marker support — composed search reads candidate notes alongside platform ones, marked clearly.
- (Stretch) skill `/seance:promote-rule` in seance-claude-code that wraps the CLI.

**Decisions needed before start:**

- Whether validator blocks borrow on invalid frontmatter. **Recommendation:** warn only at first; block only on promoted/core notes later.
- Required fields per scope.
- Whether `promote-rule` opens a real PR or just stages a commit branch the operator pushes. **Recommendation:** stages a branch + tells operator the PR command. Don't auto-PR — keep human in the loop.

**Repos / ownership:**

- `agiterra/seance-tools`: validator + promote-rule helper.
- `agiterra/toolsmith-core` and `agiterra/fondant`: adopt schema for touched notes going forward; do not mass-edit historical notes unless cheap.

**Risks:**

- Schema work becomes bureaucracy without enough workflow value.
- Mass frontmatter churn obscures real content diffs (mitigated by not mass-editing historical notes).

**Rollback:**

- Validator non-blocking by default; can be disabled.
- `promote-rule` helper is purely additive — disable by removing the skill/CLI command.

**Test plan:**

- Unit: frontmatter parser accepts valid notes, reports missing fields.
- Unit: invalid status/scope rejected.
- Unit: promotion helper preserves origin + status.
- Integration: promote a mock specialization note to mock core, then search returns both labeled.

---

## **STOP-HERE CANDIDATE — after Phase 4**

After Phase 4, the system has:

- ✅ Safe seance cache/workspace behavior (PR #1 + PR #2 from prior work).
- ✅ Version-pinned role inheritance with lockfile.
- ✅ Composed CLAUDE.md with named-section overrides + stale-override detection.
- ✅ Ordered multi-vault search across role-core + specialization (+ optional handbook later).
- ✅ Real `agiterra/toolsmith-core` and real `agiterra/fondant` specialization in production.
- ✅ Boot provenance disclosure.
- ✅ Frontmatter routing labels on all new + migrated notes.
- ✅ Tooling-supported promotion path (local → candidate → platform).
- ✅ No live Fondant disruption (cutover handled cleanly).

**Total effort to this line: ~3–5 focused days.**

That is the minimum viable hardening of the current system. Solves Brian's transferable-values problem AND establishes the routing discipline that downstream phases depend on.

Phases 5–9 are worthwhile only when concrete demand surfaces:
- Phase 5 (composition manifests): when AMAT or TankLoop parent repos materialize and need cross-package vault discovery.
- Phase 6 (recall): when the first promotion-then-regret happens.
- Phase 7 (TankLoop persona): when Brian's ready to spin up a TankLoop-specific role specialization.
- Phase 8 (handbook): when role-core has accumulated enough universal-doctrine notes to be worth extracting upstream.
- Phase 9 (registry): when there are 3+ role-cores or 5+ personae and operators can't find them by convention.

If the pilot at Phase 3 reveals the architecture isn't paying off, halt before Phase 4 and keep promotion manual.

---

## Phase 5: Composition Manifest MVP

**Effort estimate:** 1–2 days. Deferred until AMAT or TankLoop parent repos exist.

**Purpose:** add `.agiterra/knowledge.json` for project/code vault graphs. Keep orthogonal to persona inheritance.

(Content unchanged from v1.)

**Deliverables:**

- Define manifest schema v1 (per Kiln v1).
- Implement manifest reader.
- Add no-blind-ancestor rule.
- Add source labels to search results.
- Add write-target suggestion, not silent write selection.
- Create first manifest in a sandbox or AMAT parent if it exists; otherwise use `agiterra-platform` as planning fixture only.

(Decisions/risks/rollback/test plan unchanged from v1.)

---

## Phase 6: Recall and Demotion Governance

**Effort estimate:** ½ day. Deferred until first bad promotion needs recall.

(Content unchanged from v1.)

---

## Phase 7: TankLoop Pilot Persona

**Effort estimate:** ½ day (creating the repo + first content). Plus ongoing TankLoop-specific content authoring.

**Purpose:** prove role archetype reuse without named-persona cloning. **This is the cross-business reuse validation** — the architecture either survives a real second consumer or doesn't.

(Content unchanged from v1.)

---

## Phase 8: Handbook Layer

**Effort estimate:** ½ day (mechanics) + content classification time. Deferred until role-cores have accumulated enough universal-doctrine notes.

(Content unchanged from v1.)

**Additional note from v2:** the `handbook-candidate` scope tag from Phase 3's temporary policy is the input to this phase. When handbook materializes, sweep all `scope: handbook-candidate` notes from role-cores upstream.

---

## Phase 9: Discovery Registry (placeholder, future)

**Effort estimate:** ½–1 day. Deferred until 3+ role-cores or 5+ personae exist and convention-based discovery hits its limit.

**Purpose:** centralized catalog of known role-archetypes, personae, shared libs across the agiterra ecosystem (and any external orgs that consume them).

**Deliverables (sketch):**

- New repo (or file in `agiterra/handbook`): `agiterra/registry`.
- One JSON / YAML file listing all known role-archetypes, personae, composition products, with: canonical repo URL, current stable version tag, brief description, ownership.
- Optionally consumed by `seance register` autocomplete: when typing a name, suggest from registry.

**Why placeholder now:** doesn't earn its keep at today's scale (1 role-core, ~5 personae, 0 composition products). Add when scaling pain surfaces.

---

## Cross-Phase Invariants

Unchanged from v1:

- No blind ancestor walking as default behavior.
- No unpinned inherited identity in production.
- No project facts in role core.
- No named persona reused across business boundaries unless explicitly intended.
- No live-process migration. Running agents finish under the identity they booted with.
- Every boot should disclose provenance once Phase 2b lands.
- Every migration PR should include a rollback tag or direct-load fallback.

---

## Persistence

After this plan converges (this v2 → Kiln review → optional v3 → ...), it should leave `/tmp/` and live somewhere all hosts + future agents can access.

**Recommended home:** `agiterra/seance-tools/docs/plans/knowledge-architecture.md`. Reasons:
- The plan's primary code deliverables land in `agiterra/seance-tools`.
- `seance-tools` is already cloned on Brian's box (`~/NewProjects/seance-tools/`) and would be on Tim's.
- Adding a `docs/plans/` directory creates a precedent for future architecture plans without spinning a new repo for each.
- Lower-overhead than creating a new `agiterra/architecture` repo today.

**Alternative:** new `agiterra/architecture` repo if Brian wants a dedicated docs/decisions home. Slightly more setup; more durable.

**Kiln's call** on which lands the plan + which path. After approving v2 (or producing v3), commit and push to wherever the team agrees. Delete `/tmp/` copies once persisted.
