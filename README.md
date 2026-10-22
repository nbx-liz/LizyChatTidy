# LizyChatTidy

An open-source Chrome extension (Manifest V3) for reviewing your own web chat
history, marking conversations to keep, and selectively deleting the rest.

Targets: **ChatGPT (web)** and **Claude Code on the web** (cloud sessions at
claude.ai/code). Regular Claude chat and local Claude Code history are out of
scope.

> **Status: pre-alpha.** The repository holds an extension scaffold that only
> connects to a supported tab; it cannot list or delete anything yet. Nothing
> has been verified against the live services, and no feature — least of all
> automatic bulk deletion — should be assumed to work until its acceptance
> tests are recorded as passing. Automatic deletion is planned for a
> personal-use build only and will not be published to a store.

## Principles

- No developer-operated server; no telemetry, analytics, or external AI.
- Never reads cookies, and never stores or relays session tokens or API keys.
  One documented exception (HISTORY.md P-0003): on ChatGPT, the access token
  is held in content-script memory only, for same-origin requests to the
  service itself.
- Conversation text stays in memory by default and is never logged.
- Deletion only from a fixed, explicitly approved plan; KEEP is re-checked
  immediately before each item; anything uncertain stops instead of retrying.
- Browsing/organizing, deletion assistance, and automatic deletion are gated
  and released independently.

Not affiliated with or endorsed by OpenAI or Anthropic.

## Documentation

Specifications are written in Japanese; code and contributions are in English.

- [`BLUEPRINT.md`](BLUEPRINT.md) — the authoritative specification: scope,
  invariants, architecture, data model, deletion protocol, UI.
- [`HISTORY.md`](HISTORY.md) — proposals and decisions.
- [`docs/handoff/`](docs/handoff/) — the developer handoff bundle v0.1.1
  (requirements, backlog DEV01–14, acceptance tests AT01–35, reference
  contracts, sources). Kept verbatim; integrity is checked in CI against
  `SHA256SUMS.txt`.
- [`docs/p0/`](docs/p0/) — P0 research and the DEV01 scope table.

## Development

Requires Node.js 24 and pnpm (version pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm check:dist
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions`,
Developer mode). Use only throwaway conversations when trying it against a
live service.

## License

[MIT](LICENSE)
