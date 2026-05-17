#!/usr/bin/env bun
// seance — CLI for personai borrow management.
// Usable directly (`bunx @agiterra/seance-tools seance ...`) or via runtime
// adapters (seance-claude-code, seance-codex).

import {
  registerPersonai,
  unregisterPersonai,
  listPersonae,
} from "./registry.ts";
import { borrowPersonai } from "./borrow.ts";
import { multiVaultSearch } from "./search.ts";

const USAGE = `\
seance — borrow AI personae across runtimes

Commands:
  register <name> <repo>      Add a personai to the local cache
  list                        Show registered personae
  borrow <name>               Pull latest + emit overlay payload as JSON
  search <query> [<name>...]  Search across CWD vault + named personai vaults
  unregister <name>           Remove a personai from the registry
  help                        Show this message

Examples:
  seance register alex workshop162/Alex
  seance borrow alex
  seance search "auth pattern" alex mochi
`;

function fail(msg: string, code = 1): never {
  console.error(`error: ${msg}`);
  process.exit(code);
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case undefined:
  case "help":
  case "-h":
  case "--help":
    console.log(USAGE);
    break;

  case "register": {
    const [name, repo] = args;
    if (!name || !repo) fail("usage: seance register <name> <repo>");
    try {
      const entry = registerPersonai(name, repo);
      console.log(JSON.stringify(entry, null, 2));
    } catch (e) {
      fail((e as Error).message);
    }
    break;
  }

  case "list": {
    console.log(JSON.stringify(listPersonae(), null, 2));
    break;
  }

  case "borrow": {
    const [name] = args;
    if (!name) fail("usage: seance borrow <name>");
    try {
      const payload = borrowPersonai(name);
      console.log(JSON.stringify(payload, null, 2));
    } catch (e) {
      fail((e as Error).message);
    }
    break;
  }

  case "search": {
    const [query, ...personaiNames] = args;
    if (!query) fail("usage: seance search <query> [<personai>...]");
    const cwd = process.cwd();
    const vaults = [
      { label: "project", vaultDir: `${cwd}/.knowledge` },
      ...personaiNames.map((n) => ({
        label: n,
        vaultDir: `${process.env.HOME}/.agiterra/personai/${n}/.knowledge`,
      })),
    ];
    const hits = multiVaultSearch(query, vaults);
    console.log(JSON.stringify(hits, null, 2));
    break;
  }

  case "unregister": {
    const [name] = args;
    if (!name) fail("usage: seance unregister <name>");
    const removed = unregisterPersonai(name);
    if (!removed) fail(`not registered: ${name}`);
    console.log(JSON.stringify({ unregistered: name }));
    break;
  }

  default:
    fail(`unknown command: ${cmd}\n\n${USAGE}`);
}
