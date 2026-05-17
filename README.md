# @agiterra/seance-tools

> Runtime-agnostic primitives for borrowing AI personae across Claude Code, Codex, and other agentic CLIs.

A *personai* is data: a `CLAUDE.md` identity contract + a `.knowledge/` vault, both versioned in a GitHub repo. Anyone with read access to the repo can embody the persona on their own machine using their own Wire signing key. This package handles the local cache, git lifecycle, multi-vault search composition, and borrow payload assembly. Runtime-specific overlay injection lives in adapter packages:

- [`agiterra/seance-claude-code`](https://github.com/agiterra/seance-claude-code) — Claude Code adapter
- [`agiterra/seance-codex`](https://github.com/agiterra/seance-codex) — Codex adapter

## What this gets you

- **Coverage handoff** — when one engineer is on vacation, another can `seance:summon <personai>` to keep work moving without key transfer.
- **Multi-runtime portability** — Alex on CC and Alex on Codex are the same identity, slightly different voices. Both load from the same vault.
- **Composable on top of `agiterra/knowledge`** — multi-vault search reuses Tim's `vector-search.py --vault` primitive. Zero upstream change required.

## CLI

```
seance register <name> <repo>      Add a personai to the local cache
seance list                         Show registered personae
seance borrow <name>                Pull latest + emit overlay payload as JSON
seance search <query> [<name>...]   Search CWD vault + named personai vaults
seance unregister <name>            Remove a personai from the registry
```

## Example

```sh
seance register alex workshop162/Alex
seance borrow alex | jq .claudeMd      # the persona's identity contract
seance search "auth pattern" alex      # multi-vault hybrid search
```

## How it works

1. Each registered personai lives at `~/.agiterra/personai/<name>/` as a git clone.
2. `registry.json` next to the cache tracks repo URLs + last-pulled commit SHAs.
3. `borrow` pulls latest, reads `CLAUDE.md` + `meta/session-state.md` + the last 5 journal entries, returns a portable JSON payload an adapter injects into a live session.
4. `search` composes on `knowledge-tools/vector-search.py --vault <path>` — runs once per loaded vault with `--top 50`, merges by raw cosine score (same embedding model across vaults → directly comparable), returns the unified top-K labeled by origin.

## License

MIT
