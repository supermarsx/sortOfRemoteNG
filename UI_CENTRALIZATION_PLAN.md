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
  - `src/components/ui/MenuSurface.tsx`
  - `src/components/ui/PopoverSurface.tsx`
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
  - `WebTerminal` (script selector modal)
  - `AutoLockManager` (locked overlay shell via non-dismissible modal)

### Menu/Popover Centralization

- New shared primitive:
  - `src/components/ui/MenuSurface.tsx`
  - `src/components/ui/PopoverSurface.tsx`
- Migrated context/action menus:
  - `ConnectionTree` (item menu + panel menu)
  - `WebBrowser` (bookmark item menu + bookmark bar menu)
- Migrated anchored popovers and option-list overlays:
  - `SyncBackupStatusBar`
  - `BackupStatusPopup`
  - `CloudSyncStatusPopup`
  - `CertificateInfoPopup`
  - `rdp/RDPTotpPanel` (anchored mode)
  - `rdp/RDPClientHeader` (send keys + host info)
  - `WebTerminal` (macro replay list)

### CSS Primitive Expansion

- `src/index.css` now centrally provides:
  - option styles: `.sor-option-chip`, `.sor-option-chip-active`, `.sor-option-card`
  - chip groups: `.sor-chip-list`, `.sor-chip-button`
  - selection rows: `.sor-selection-list`, `.sor-selection-row`, `.sor-selection-row-selected`, `.sor-selection-row-hover-action`
  - menu shell/items: `.sor-menu-surface`, `.sor-menu-item`, `.sor-menu-item-danger`, `.sor-menu-divider`
  - popover/list primitives: `.sor-popover-surface`, `.sor-option-list`, `.sor-option-item`
- Migrated components adopted these classes where behavior/style stacks were duplicated.

### Test Coverage Added/Updated

- New:
  - `tests/HTTPOptions.test.tsx`
  - `tests/AppDialogs.test.tsx`
  - `tests/AutoLockManager.test.tsx`
  - `tests/ColorTagManager.test.tsx`
  - `tests/MenuSurface.test.tsx`
  - `tests/PopoverSurface.test.tsx`
  - `tests/CertificateInfoPopup.test.tsx`
  - `tests/RDPClientHeader.test.tsx`
  - `tests/ProxyChainEditor.test.tsx`
  - `tests/ProxyProfileEditor.test.tsx`
  - `tests/SSHTunnelDialog.test.tsx`
  - `tests/TrustWarningDialog.test.tsx`
- Updated:
  - `tests/BulkSSHCommander.test.tsx`
  - `tests/ConnectionTree.test.tsx`
  - `tests/SettingsDialog.test.tsx`
  - `tests/WebTerminal.test.tsx`

## Remaining Scope

### Non-Modal Overlays To Triage

- fullscreen client containers and splash screen are intentionally not modal migrations

### Context/Action Menus (Different Primitive)

- `WebBrowser` folder dropdown (`absolute`) is still custom and can move to a shared anchored popover if needed.
- Any future right-click menus should use `MenuSurface` by default.

### CSS Consolidation Follow-Up

- Finish converging remaining dense lists to `.sor-selection-*`.
- Complete option chip adoption in settings/tool headers.
- Remove duplicate local class stacks once adoption is complete.

## Execution Plan (Next Steps)

1. Sweep remaining ad-hoc list/chip class stacks and replace with `.sor-*` primitives.
2. Evaluate a shared anchored popover for non-context-menu dropdowns (e.g., bookmark folder dropdown).
3. Continue reducing duplicated utility class combinations in managers/editors.
4. Run lint + targeted tests after each batch, then full suite pass.

## Guardrails

- No behavior changes while centralizing structure/CSS.
- Preserve existing keyboard and backdrop-close semantics per component.
- Keep theme variables (`--color-*`) as the single source of visual truth.

## Verification Checklist

- `npm run lint`
- `npm test -- --run` (fallback to direct Vitest when Bun is unavailable)
- targeted tests for every migrated dialog
- smoke-check backdrop click + escape close behavior for each popup class
