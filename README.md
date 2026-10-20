# Silo frontend

Browser-side E2E-encrypted notes client. The server stores only an opaque
encrypted vault blob and never receives the passphrase, the encryption key, or
plaintext note content.

## Stack

- Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`)
- Tailwind CSS v4 (light/dark via the `.dark` class)
- Lexical rich-text editor with markdown typing shortcuts
- Web Crypto API (PBKDF2, HKDF, AES-GCM)
- Vitest + Testing Library (jsdom)
- ESLint 9 (typescript-eslint + react-hooks)

## Local setup

Requirements: Node 24 and the Silo backend running at `http://127.0.0.1:3000`.

```sh
npm ci
npm run dev
```

The dev server listens on `http://127.0.0.1:5173` and proxies `/api` (including
websockets) to the backend, so the browser stays same-origin and cookies work
without wildcard CORS. For reproducible CI installs use `npm ci`; for local
development `npm install` is also fine.

Production build:

```sh
npm run build
```

## Scripts

| Script               | Purpose                              |
| -------------------- | ------------------------------------ |
| `npm run dev`        | Start the Vite dev server            |
| `npm run build`      | Typecheck + production build         |
| `npm run typecheck`  | TypeScript project check             |
| `npm run lint`       | ESLint                               |
| `npm test`           | Run unit tests once (Vitest)         |
| `npm run test:watch` | Vitest watch mode                    |

## Architecture

- `src/lib/crypto.ts` — key derivation and AES-GCM vault encryption.
- `src/lib/vault.ts` — versioned, validated vault document schema and pure
  note/folder mutations.
- `src/lib/sync.ts` — serialized autosave, CAS conflict handling, websocket
  invalidation, and backoff retries.
- `src/lib/api.ts` — JSON HTTP client and the realtime socket factory.
- `src/hooks/useVaultSync.ts` — React binding for the sync controller.
- `src/components/` — auth dialog, unlock screen, Lexical editor, sidebar,
  conflict dialog, and status indicators.
- `src/VaultApp.tsx` — authenticated, ready-state application shell.

Only theme and sidebar preference are persisted to `localStorage`. Keys, the
passphrase, and decrypted vault bytes exist only in memory and are wiped when
the authenticated component unmounts (logout or session expiry).

## Crypto contract

- Passphrase minimum length: 12 characters.
- Random 16-byte client salt.
- `PBKDF2-HMAC-SHA256(passphrase UTF-8, salt, 600000 iterations, 256 bits)`.
- HKDF-SHA256 (empty salt) with info labels `silo-auth-v1` and
  `silo-encryption-v1` derives the 256-bit auth key and a non-extractable
  AES-GCM-256 key.
- The raw passphrase and vault key are never sent to the server.
- Every encryption uses a fresh random 12-byte nonce and
  `additionalData = "silo-vault-v1"`. The entire vault document (titles,
  folders, and serialized Lexical editor state) is encrypted as one blob.
- Decryption authenticates before parsing; tampering or a wrong passphrase
  fails closed and never resets or overwrites the vault.

## Sync model

Silo syncs whole-vault snapshots using an integer CAS version:

- Edits are debounced, encrypted, and saved with `expected_version`.
- Saves are serialized; edits made during an in-flight save are queued.
- A `409 Vault changed on another device` response or an incoming remote
  invalidation while local changes are unsaved pauses autosave and presents an
  explicit load-remote / keep-local choice. The local draft can be exported as
  JSON before choosing.
- Keep-local deliberately re-saves with the latest remote version.
- Transient network failures are retried with exponential backoff. Reconnects
  fetch the latest vault before applying.
- Websocket messages are invalidation-only (`vault_changed` with a version);
  they never carry plaintext.

This is not a multi-master character/operation merge. Last-writer-wins is
deliberate CAS only, after an explicit conflict decision.

## Threat model and metadata exposure

- The server (and anyone able to observe the server) sees the account email,
  the client salt after registration/salt lookup, and the encrypted vault size.
  It does not see note titles, folder names, editor content, or the passphrase.
- The `GET /api/auth/salt` endpoint reveals whether an email is registered.
  This metadata trade-off is inherent to the login flow; production deployments
  should add external rate limiting.
- This client provides confidentiality and authenticity of vault contents, not
  traffic-analysis resistance. Encrypted blob size changes can reveal when and
  roughly how much content changed.
- Production must be served over HTTPS. Session cookies are `HttpOnly`,
  `SameSite=Strict`, and scoped to `/api`; local development uses HTTP on
  loopback only.

## Limitations

- There is **no password recovery/reset**. Losing the passphrase loses the
  vault; the server cannot decrypt or recover it.
- There is no offline storage. Unsaved changes live in memory and are lost if
  the page is closed while offline/conflicted.
- Realtime sync is whole-vault snapshots, not collaborative character merging.
- This project makes no audit or compliance claim.
- No telemetry and no third-party CDNs are used.

## Tests

Unit tests cover crypto roundtrips, random nonces, wrong-key/tamper failures,
vault document validation, and sync conflict/retry/serialization behavior.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

## CI

`.github/workflows/ci.yml` runs `npm ci`, typecheck, lint, tests, and build on
pushes to `main` and on pull requests.
