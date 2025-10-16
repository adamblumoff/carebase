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
npm run test:coverage
```

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
