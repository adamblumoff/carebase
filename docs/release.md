# Release

Carebase uses EAS build profiles defined in `eas.json`.

## Profiles

- `development`: dev client, internal distribution
- `preview`: internal distribution
- `production`: auto-increments version

## Typical commands

- Install EAS CLI (if needed): `pnpm exec eas --version`
- Build dev client:
  - `pnpm exec eas build --profile development --platform ios`
  - `pnpm exec eas build --profile development --platform android`
- Build production:
  - `pnpm exec eas build --profile production --platform ios`
  - `pnpm exec eas build --profile production --platform android`

## Deploy checklist (API + DB)

- Run `pnpm lint` and `pnpm test`
- Apply migrations in the target environment: `pnpm db:migrate`
- Verify CareHub invariants in prod data:
  - Each caregiver has exactly one membership.
  - Each CareHub has at most one Primary Gmail source (`sources.isPrimary=true` for provider `gmail`).

## Notes

- Keep Expo/RN versions aligned; prefer `pnpm exec expo install <pkg>` for native deps.
- If you change native modules/config, run `pnpm prebuild` and ensure native projects (`ios/`, `android/`) still build.
