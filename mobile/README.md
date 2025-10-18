# Carebase Mobile

Expo React Native client for Carebase.

## Commands
```bash
npm install
npm run env:mobile:dev      # ngrok backend
npx expo start --clear
npm run env:mobile:prod     # carebase.dev backend
```

## Tests
```bash
npm test
npm run test:coverage      # enforces 65%+ coverage on logic modules (React Native screens/UI excluded)
```

### Current Coverage Status
- Mobile workspace sits at ~70% statements / 78% branches / 84% functions / 70% lines (logic presenters, hooks, APIs are instrumented).

### Known Gaps / Next Steps
- React Native screen components (`src/screens/**`) and UI helpers still rely on manual QA; we deliberately excluded them from coverage thresholds to avoid flakiness. Consider presenter patterns or Detox/E2E tests if UI regressions become frequent.
- Navigation flows (`AppNavigator`) are untested; add smoke tests or integration coverage if route guard logic grows.
- Realtime + Google webhook interactions are covered by unit stubs only. An end-to-end test hitting a live socket/server would increase confidence.

## Structure
```
src/
 ├── api          # axios client + feature APIs
 ├── auth         # auth context and helpers
 ├── components   # shared UI components
 ├── hooks        # custom hooks (calendar, etc.)
 ├── navigation   # React Navigation setup
 ├── screens      # feature screens
 ├── ui           # providers (Toast, Theme)
 └── utils        # realtime, plan event bus
```

Keep `.env.development.local` (ngrok) and `.env.production.local` (carebase.dev); use `npm run env:mobile:<dev|prod>` to swap.`
