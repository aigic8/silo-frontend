# Silo frontend

Minimal full-screen TypeScript React client for Silo (E2E-encrypted notes).

## Stack

- Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`)
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- Lexical (editor, installed for upcoming features)
- Vitest + Testing Library (jsdom)
- ESLint 9 (flat config, typescript-eslint + react-hooks)

## Setup

```sh
npm install
npm run dev
```

The dev server listens on `http://127.0.0.1:5173` and proxies `/api`
(including websockets) to the backend at `http://127.0.0.1:3000`.

## Scripts

| Script            | Purpose                          |
| ----------------- | -------------------------------- |
| `npm run dev`     | Start dev server                 |
| `npm run build`   | Typecheck + production build     |
| `npm run typecheck` | TypeScript project check       |
| `npm run lint`    | ESLint                           |
| `npm test`        | Run unit tests once (Vitest)     |
| `npm run test:watch` | Vitest watch mode             |

## CI

`.github/workflows/ci.yml` runs `npm ci`, typecheck, lint, tests and build on
pushes to `main` and on pull requests.
