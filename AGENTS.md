# Working agreement

Applies to any agent or person working in this repository.

## Read first
1. `docs/HANDOFF.md` — what to do now.
2. `docs/SPEC.md` — the decisions. Do not re-litigate a decision marked *answered*; add an
   ADR entry in `docs/architecture.md` if you must change one, and say why.
3. `docs/roadmap.md` — the ordered backlog. Work top-down.

## Ground rules
- **Verify before depending.** Tesserae is pre-1.0 and releases every few days. Anything marked
  **[SPIKE]** in the spec must be proven on a running Tesserae before code relies on it.
  Pin `ghcr.io/dmellok/tesserae:0.475.0`; upgrade deliberately and note it in the roadmap.
- **Scope.** Build what the stage says. No speculative abstractions, no extra services, no UI
  that is not in the spec. If something is blocked, finish everything else and say what was
  left out and why.
- **Other repositories.** Do not modify `health-dashboard`, Unraid services, or any other
  repo. The health-dashboard changes in `docs/SPEC.md` §13.2 are a *separate PR in that repo*
  to be done later with the owner's go-ahead.
- **Secrets.** Never commit secrets. `.env.example` lists every variable with a dummy value.
  Device tokens are shown once and stored hashed. Do not request production credentials;
  use the mock adapters.
- **Docker.** The maintainer runs Colima (`~/.colima/default/docker.sock`); any Docker works.
  Images must be multi-arch (arm64 here, amd64 on Unraid).
- **Standards.** TypeScript strict. Drizzle migrations for every schema change. Zod at every
  boundary. Completion writes idempotent. Timezone `Australia/Perth` for routines; the
  health dashboard's owner zone for habits. Tests for occurrence generation, toggle/dedupe,
  slot mapping, and auth; one end-to-end simulator flow.
- **Docs.** Keep `docs/` current as you go: replace "planned" with what was built, record
  spike results in `docs/architecture.md`, record measured latencies in `docs/testing.md`.
  Short and factual beats long.
- **Reporting.** When a stage is done, report: what was implemented and verified, how to run
  it, previews, test results, outstanding issues, decisions/tradeoffs, hardware-dependent
  tests not yet run, next 3–5 tasks.

## Definition of done for Stage 1
`docker compose up`, open the simulator, see the child's routine page rendered by Tesserae's
own renderer at 1404×1872, click a step, see it persisted in the Planner, and see the next Tesserae
render show the completed state. Every test green. Docs updated.
