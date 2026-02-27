# UI/CSS Centralization Plan

## Goal

Consolidate reusable UI structure and CSS for:

- dialog/popup scaffolds
- option groups and chip controls
- selectable list rows
- shared table shells

## Current Baseline (After This Migration Wave)

- Shared primitives in active use:
  - `src/components/ui/Modal.tsx`
  - `src/components/ui/SettingsPrimitives.tsx`
  - shared CSS primitives in `src/index.css`
- Major popup/dialog surfaces already migrated to `Modal`.
- New tests cover dialog open/close behavior and key interaction paths for migrated components.

## Completed Migrations

### Modal Scaffold Centralization

- Earlier wave:
  - `ConnectionEditor`
  - `WOLQuickTool`
  - `BulkConnectionEditor`
  - `InternalProxyManager`
  - `WakeScheduleManager`
  - `TotpImportDialog`
  - `ActionLogViewer`
  - `PerformanceMonitor`
  - `CollectionSelector`
  - `ConnectionDiagnostics`
  - `RdpSessionManager`
  - `ImportExport/index`
  - `FileTransferManager`
  - `SSHKeyManager`
  - `TOTPManager`
  - `TrustWarningDialog`
  - `SSHTunnelDialog`
  - `ProxyProfileEditor`
  - `ProxyChainEditor`
  - `ProxyChainMenu`
  - `ColorTagManager`

- Current wave:
  - `SettingsDialog/index`
  - `SettingsDialog/sections/CloudSyncSettings`
  - `SettingsDialog/sections/RecoverySettings`
  - `ConnectionTree` (rename/connect-options dialogs)
  - `connectionEditor/HTTPOptions` (bookmark/header dialogs)
  - `BulkSSHCommander`
  - `AppDialogs` (RDP popup wrapper)

### CSS Primitive Expansion

- `src/index.css` now centrally provides:
  - option styles: `.sor-option-chip`, `.sor-option-chip-active`, `.sor-option-card`
  - chip groups: `.sor-chip-list`, `.sor-chip-button`
  - selection rows: `.sor-selection-list`, `.sor-selection-row`, `.sor-selection-row-selected`, `.sor-selection-row-hover-action`
- Migrated components adopted these classes where behavior/style stacks were duplicated.

### Test Coverage Added/Updated

- New:
  - `tests/HTTPOptions.test.tsx`
  - `tests/AppDialogs.test.tsx`
  - `tests/ColorTagManager.test.tsx`
  - `tests/ProxyChainEditor.test.tsx`
  - `tests/ProxyProfileEditor.test.tsx`
  - `tests/SSHTunnelDialog.test.tsx`
  - `tests/TrustWarningDialog.test.tsx`
- Updated:
  - `tests/BulkSSHCommander.test.tsx`
  - `tests/SettingsDialog.test.tsx`

## Remaining Scope

### Non-Modal Overlays To Triage

- `WebTerminal` script overlay (candidate for `Modal`)
- `AutoLockManager` lock overlay (special security UX; evaluate separately)
- fullscreen client containers and splash screen are intentionally not modal migrations

### Context/Action Menus (Different Primitive)

- `ConnectionTree` and `WebBrowser` still use ad-hoc fixed/absolute menu shells.
- Next centralization target should be a shared menu/popover primitive instead of forcing these into `Modal`.

### CSS Consolidation Follow-Up

- Finish converging remaining dense lists to `.sor-selection-*`.
- Complete option chip adoption in settings/tool headers.
- Remove duplicate local class stacks once adoption is complete.

## Execution Plan (Next Steps)

1. Create shared `MenuSurface` primitive for context menus/popovers and migrate `ConnectionTree` + `WebBrowser`.
2. Migrate `WebTerminal` script modal overlay to `Modal` with current close semantics preserved.
3. Decide whether `AutoLockManager` should remain a dedicated hard lock overlay or adopt a locked-down `Modal` variant.
4. Sweep duplicated list/chip styles and replace with existing `.sor-*` utilities.
5. Run lint + targeted tests after each batch, then full suite pass.

## Guardrails

- No behavior changes while centralizing structure/CSS.
- Preserve existing keyboard and backdrop-close semantics per component.
- Keep theme variables (`--color-*`) as the single source of visual truth.

## Verification Checklist

- `npm run lint`
- `npm test -- --run` (fallback to direct Vitest when Bun is unavailable)
- targeted tests for every migrated dialog
- smoke-check backdrop click + escape close behavior for each popup class
