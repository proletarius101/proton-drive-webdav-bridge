# Agent instructions — Proton Drive WebDAV Bridge

Quick, focused notes to help an AI coding agent be productive in this repo.

## TL;DR
- Use Bun to run, build and test this project (not plain Node). Commands below. ✅
- Key areas: CLI (`src/cli/*`), Drive client (`src/drive.ts`), WebDAV adapter/resource (`src/webdav/*`), Keychain (`src/keychain.ts`), Lock/metadata DB (`src/webdav/*Manager.ts`), Frontend: React (`src/gui/`) using Mielo UI for an Adwaita look & feel. 🔧

## Quick commands
- Install: `bun install`
- Dev (watch): `bun run dev`
- Build: `bun run build`
- Type-check: `bun run build:check`
- Lint / format: `bun run lint` / `bun run format`
- Tests: `bun test:unit` (unit) — run a single E2E: `bun test test/webdav.propfind.e2e.test.ts` (run E2E tests in isolation). ✅
- Start server: `proton-drive-webdav-bridge start` (or `bun run start` during dev)

## Architecture & where to look 🔎
- Entry & CLI: `src/index.ts`, `src/cli/*.ts` (start/stop/status/auth/config)
- Auth & sessions: `src/auth.ts` (SRP, session forking, OpenPGP)
- Credentials: `src/keychain.ts` (native keyring via `@napi-rs/keyring` + AES file fallback; env var `KEYRING_PASSWORD` forces file mode)
- Drive SDK wrapper: `src/drive.ts` (DriveClientManager) — see `listFolder`, `resolvePath`, `uploadFile`, `downloadFile` for core patterns
- WebDAV interface: `src/webdav/server.ts`, `ProtonDriveAdapter.ts`, `ProtonDriveResource.ts` — Nephele adapter & resource mapping
- Locking & metadata persistence: `src/webdav/LockManager.ts`, `src/webdav/MetadataManager.ts` (uses `bun:sqlite`) 💾
- Frontend/UI: React components live in `src/gui/` (see `src/gui/components/`), styled with Mielo UI to provide the Adwaita look & feel — see `MIGRATION_TO_MIELO_UI.md` for migration notes
- Reference implementations: `https://github.com/sciactive/nephele/tree/master/packages/adapter-s3` (WebDAV server & adapter examples) and `https://github.com/ProtonMail/WebClients` (Drive API usage, pagination, and client-side patterns)

## Project-specific patterns & gotchas ⚠️
- Bun-first: code uses `bun:sqlite` and Bun's test runner; run and test with `bun`, not Node.
- ESM imports include `.js` extension in source imports (keep `./foo.js` in imports).
- Frontend: the UI is implemented with React and styled using Mielo UI to achieve an Adwaita look & feel. See `src/gui/` and `MIGRATION_TO_MIELO_UI.md` for guidance when modifying UI components and styles.
- Streaming: prefer streaming for uploads/downloads (avoid buffering). See `getFileDownloader()` + `downloadToStream(...)` and `uploadFile(...)` which accepts ReadableStream / Buffer / Uint8Array.
- Large-folder listing: `drive.ts::listFolder` uses a direct API pagination path when UIDs contain `~`, and then `iterateNodes` to preserve order — changing this can affect performance and ordering.
- Cache invalidation: after mutations call `adapter.invalidateFolderCache(parentUid)` and clear cached node/metadata (`this._node = undefined; this._metaReady = null; this._cachedProps = null`) — see `ProtonDriveResource.create/setStream/delete/move`.
- Locking: LOCK/UNLOCK handled in `webdav/server.ts` with `LockManager`; resource methods must call `checkLock(user, token)` to respect locks. Tests cover conflicts in `test/webdav.lock.*.e2e.test.ts`.
- Keyring in CI: set `KEYRING_PASSWORD` to force file-based encrypted storage (see `test/keychain.test.ts` for examples and `getCredentialsFilePath()` for file location).
- Singleton DBs: `locks.db` also stores metadata; E2E tests should run in isolation (mock `env-paths` to sandbox dirs).

## Testing tips 💡
- Unit tests use Bun mocks: `mock.module('...')` to stub native modules and `env-paths` to avoid touching real user dirs.
- Run sensitive E2E tests individually: `bun test test/webdav.propfind.e2e.test.ts` (avoids singleton/db collisions).
- When adding WebDAV behavior (PROPFIND, MOVE, COPY, LOCK), add both unit and at least one focused E2E test validating HTTP behavior.

## Error & response conventions
- Use the error types in `src/errors/*` (e.g., `ResourceNotFoundError`, `ConflictError`, `LockedError`) so Nephele returns correct HTTP statuses.
- Log failures with `logger.debug/error` and preserve user-facing messages in thrown errors where tests assert exact messages.

## PR checklist for behavioral changes ✅
- Add/update unit tests (see `test/*.test.ts`) and an E2E if protocol semantics changed
- Run `bun run pre-commit` (typecheck + eslint --fix + prettier)
- Update `README.md` or CLI help if you add flags or config

## Quick search shortcuts (use in repo)
- `invalidateFolderCache` — where mutation cache is cleared
- `checkLock` / `LockManager` — locking semantics
- `getFileDownloader` / `uploadFile` — streaming I/O
- `KEYRING_PASSWORD` / `getCredentialsFilePath` — credential storage guidance
