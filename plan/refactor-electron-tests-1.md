---
goal: Refactor GUI tests to use Electron test helpers instead of legacy Tauri imports
version: 1.0
date_created: 2026-02-12
last_updated: 2026-02-12
owner: Copilot
status: Planned
tags: [refactor, tests, electron, gui]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan replaces remaining legacy Tauri test imports with Electron test equivalents, aligning GUI tests with the Electron runtime surface and removing obsolete Tauri wiring.

## 1. Requirements & Constraints

- **REQ-001**: Replace all remaining `TauriProvider` and `TauriApi` imports in tests with Electron equivalents.
- **REQ-002**: Preserve current test intent and assertions unless behavior differs due to Electron runtime semantics.
- **REQ-003**: Tests must pass under `npm test` after refactor.
- **CON-001**: Do not modify application runtime behavior; test-only refactor.
- **GUD-001**: Follow existing ESM import style with `.js` extension in source imports.
- **PAT-001**: Centralize Electron test stubs in a helper module to avoid duplication.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Introduce Electron test helper and update shared test utilities.

| Task     | Description | Completed | Date |
| -------- | ----------- | --------- | ---- |
| TASK-001 | Create a new helper `test/helpers/renderWithElectron.tsx` that: (1) defines a `ElectronTestApi` interface `{ invoke: (channel: string, ...args: unknown[]) => Promise<unknown>; on: (channel: string, listener: (data: unknown) => void) => () => void; }`, (2) stubs `window.electron` with `{ auth: { getStatus }, events: { on, off, once }, send }` where `auth.getStatus` calls `api.invoke('auth:getStatus', ...)` and `events.on` delegates to `api.on`, and (3) renders children optionally wrapped in `ElectronProvider` when the component under test requires it. |  |  |
| TASK-002 | Update `test/helpers/renderWithTauri.tsx` to either (a) re-export `renderWithElectron` with a deprecation comment, or (b) remove it after all call sites are migrated. Prefer option (a) first to minimize churn, then remove in Phase 2 if unused. |  |  |
| TASK-003 | Add/adjust TypeScript types in the helper so tests can import `ElectronTestApi` instead of `TauriApi`. |  |  |

### Implementation Phase 2

- **GOAL-002**: Migrate test files to Electron helper and remove legacy Tauri usage.

| Task     | Description | Completed | Date |
| -------- | ----------- | --------- | ---- |
| TASK-004 | Update `test/gui.mount.test.ts` to: (1) replace `TauriProvider` usage with `renderWithElectron` or wrap the tested component in `ElectronProvider`, (2) import `ElectronTestApi` from `test/helpers/renderWithElectron`, and (3) replace `TauriApi` type references. |  |  |
| TASK-005 | Update `test/gui.sidecar.e2e.test.ts` similarly: remove `TauriProvider` import and use `renderWithElectron` with `ElectronTestApi`. |  |  |
| TASK-006 | Update `test/debug/account-flow.test.ts` to use `renderWithElectron` and `ElectronTestApi` types; remove `TauriApi` import. |  |  |
| TASK-007 | Remove any remaining `src/gui/tauri/TauriProvider` imports in tests; verify with `grep -R "TauriProvider" test/` returns zero. |  |  |

### Implementation Phase 3

- **GOAL-003**: Clean up legacy Tauri shim if unused.

| Task     | Description | Completed | Date |
| -------- | ----------- | --------- | ---- |
| TASK-008 | If `src/gui/tauri/TauriProvider.tsx` is no longer referenced anywhere, delete it and update any index/exports if needed. |  |  |
| TASK-009 | Remove `TauriApi` type usage in tests; ensure no lingering references in `test/` or `src/gui/tauri/`. |  |  |

## 3. Alternatives

- **ALT-001**: Keep the Tauri shim permanently. Rejected because it retains legacy API surface and risks divergence from Electron behavior.
- **ALT-002**: Replace each test inline without shared helper. Rejected due to duplication and increased maintenance cost.

## 4. Dependencies

- **DEP-001**: `src/renderer/electron/ElectronProvider.tsx` for real Electron context expectations.
- **DEP-002**: Testing library React rendering utilities already in use.

## 5. Files

- **FILE-001**: `test/helpers/renderWithElectron.tsx` — new Electron test helper.
- **FILE-002**: `test/helpers/renderWithTauri.tsx` — compatibility re-export or removal.
- **FILE-003**: `test/gui.mount.test.ts` — migrate to Electron helper.
- **FILE-004**: `test/gui.sidecar.e2e.test.ts` — migrate to Electron helper.
- **FILE-005**: `test/debug/account-flow.test.ts` — migrate to Electron helper.
- **FILE-006**: `src/gui/tauri/TauriProvider.tsx` — remove if unused after migration.

## 6. Testing

- **TEST-001**: Run `npm test` and ensure all GUI tests pass.
- **TEST-002**: Run focused tests: `npx vitest test/gui.mount.test.ts`, `npx vitest test/gui.sidecar.e2e.test.ts`, `npx vitest test/debug/account-flow.test.ts`.
- **TEST-003**: Confirm no `TauriProvider` imports remain: `grep -R "TauriProvider" test/`.

## 7. Risks & Assumptions

- **RISK-001**: ElectronProvider may require additional `window.electron` stubs if new channels are used by future tests.
- **ASSUMPTION-001**: GUI components under test rely only on `auth:getStatus` and event listeners from Electron for current flows.

## 8. Related Specifications / Further Reading

- `AGENTS.md` (repo guidance)
- `src/renderer/electron/ElectronProvider.tsx`