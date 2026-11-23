# Stage 0 spike scripts (Tesserae 0.475.0)

Throwaway evidence for `docs/architecture.md` §8. Not part of the app; they assume a local
Tesserae on :8765, the stub (`node spikes/stub.mjs`, :9999) and a paired fake device whose
token was kept in `spikes/.tok-<id>` (deleted; tokens are never kept in the repo).

| Script | Spike | What it showed |
|---|---|---|
| `widget/family_hub/` | S2 | first authored widget: `server.py` fetch over `network:`, last-good on error |
| `s3.ts <page> <device> <runs>` | S3, S6 | pair a fake E1003, tap by region id, measure tap → patch available |
| `s3b.ts` | S3 | event-id dedupe, stale digest, old-frame taps with unchanged layout |
| `revert2.ts <page>` | S3b | a row changed back is not repainted by patches (anchor diff) |
| `force.ts <page>` | S3b | MCP push and `/send/page` mint full frames |
| `after-mcp.ts`, `manifest.ts`, `full2.ts`–`full4.ts` | S3c | MCP push reuses the page's last tap-region map; webhook push + MCP push fixes it |
| `stub.mjs` | all | minimal app stand-in: render JSON, webhook log, optional push, ICS feed |

`tesserae-src/` (git-ignored) is the image's `/app/app`, `/app/plugins`, `/app/schema`, copied
with `docker compose cp` for reading. Re-copy it when upgrading Tesserae.
