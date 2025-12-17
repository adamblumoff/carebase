# Developer documentation

This documentation is written for people actively developing Carebase. It’s intentionally small, current, and biased toward “how do I get unblocked and ship?”.

## Start here

- Setup + run app/API locally: `docs/development.md`
- System overview (what lives where, how it talks): `docs/architecture.md`
- API, database, and ingestion details: `docs/api.md`
- Product roadmap (what to build next): `docs/roadmap.md`
- Infra + deploy (Railway, Postgres, GCP Pub/Sub): `docs/infra.md`
- Common workflows (routes, UI, tRPC, migrations): `docs/workflows.md`
- Builds/releases (EAS profiles): `docs/release.md`

## Docs contract (low overhead)

- Docs reflect the current code. If something is stale, update it in the same PR that changed behavior.
- Prefer deleting outdated docs over keeping “maybe” guidance around.
- Keep new docs close to the developer action (commands, env vars, file paths, failure modes).

## Ownership

- App routing/UI: whoever changes `app/` owns the matching docs sections.
- API/tRPC/db: whoever changes `api/` / `drizzle/` owns the matching docs sections.
- Build/release: whoever changes `eas.json`, `app.json`, native projects owns `docs/release.md`.
