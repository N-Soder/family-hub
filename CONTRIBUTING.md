# Contributing

Thanks for taking a look. Family Hub started as one household's planner, so it has opinions;
please open an issue before a large change so we can agree on scope first.

## Set up

Node 22 and Docker. See [README.md](README.md) for running the stack and the dev server.

```sh
npm ci
npm run demo             # made-up household on :5173, no Docker needed
npm run check            # svelte-check, strict TypeScript
npm test                 # Vitest, unit + integration
npm run build && npm run test:e2e   # Playwright against a throwaway database
```

CI runs `check`, `test` and `npm audit --omit=dev` on every pull request.

## Conventions

- **Formatting:** tabs, single quotes. There is no Prettier config in the repo, so do not run
  `npx prettier --write` over files; it would reformat them with different defaults.
- **TypeScript strict**, **Zod** at every boundary (forms, HTTP, env, files from Tesserae).
- **Schema changes** need a Drizzle migration (`npm run db:generate`).
- **Writes are idempotent**: a repeated tap or request must not double-complete anything.
- **Tests** for domain logic you add or change; one e2e flow per new surface is plenty.
- **Docs:** if you change a decision, add an ADR row to `docs/architecture.md` and say why.
  [AGENTS.md](AGENTS.md) has the full working agreement (it also guides coding agents).
- **Tesserae** is pinned (`ghcr.io/dmellok/tesserae:0.475.0`). Upgrade deliberately, re-run the
  spikes it affects, and note it in `docs/roadmap.md`.

## Pull requests

Keep them focused, describe what you verified (and on what hardware, if any), and include a
screenshot for UI changes. Use made-up names and data in tests, fixtures and screenshots.

By contributing you agree your work is licensed under the [GNU AGPL v3.0 or later](LICENSE).
