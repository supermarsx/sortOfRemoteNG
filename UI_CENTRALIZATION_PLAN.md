# UI/CSS Centralization Plan

## Objective

Centralize repeated UI structure and styling for:

- Popup/dialog scaffolds
- Repeated option groups/chip buttons
- Selectable list-row patterns
- Data-table shells

## Current State Snapshot

- Shared primitives already present:
  - `src/components/ui/Modal.tsx`
  - `src/components/ui/SettingsPrimitives.tsx`
  - centralized blocks in `src/index.css` for modal/settings/table/toolbar popup
- Manual overlay dialogs still present across many components (`fixed inset-0` pattern remains in ~30 component files).
- Repeated option/list classes are duplicated in multiple tools (Connection Editor, WOL tools, schedule managers, diagnostics/managers).

## Executed In This Wave

- Dialog migrations to shared modal primitive:
  - `src/components/ConnectionEditor.tsx`
  - `src/components/WOLQuickTool.tsx`
  - `src/components/BulkConnectionEditor.tsx`
  - `src/components/InternalProxyManager.tsx`
  - `src/components/WakeScheduleManager.tsx`
  - `src/components/TotpImportDialog.tsx`
  - `src/components/ActionLogViewer.tsx`
  - `src/components/PerformanceMonitor.tsx`
  - `src/components/CollectionSelector.tsx`
  - `src/components/ConnectionDiagnostics.tsx`
  - `src/components/RdpSessionManager.tsx`
  - `src/components/ImportExport/index.tsx`
  - `src/components/FileTransferManager.tsx`
  - `src/components/SSHKeyManager.tsx`
  - `src/components/TOTPManager.tsx`
- New centralized CSS primitives added in `src/index.css`:
  - option chips/cards: `.sor-option-chip`, `.sor-option-chip-active`, `.sor-option-card`
  - chip lists: `.sor-chip-list`, `.sor-chip-button`
  - selectable list rows: `.sor-selection-list`, `.sor-selection-row`, `.sor-selection-row-selected`, `.sor-selection-row-hover-action`
- Component-level adoption in this wave:
  - Connection Editor protocol/option groups now use shared option classes.
  - WOL Quick Tool uses shared chip/list/selection classes.
  - Internal Proxy Manager uses shared modal + option/list/table primitives.
  - Wake Schedule Manager uses shared modal + selection row primitives.
  - TOTP Import dialog uses shared modal + selection row/chip primitives.
  - Action Log Viewer uses shared modal + option chip primitives.
  - Performance Monitor uses shared modal + option chip primitives.
  - Collection Selector uses shared modal scaffold while preserving nested editor dialogs.
  - Connection Diagnostics uses shared modal scaffold and centralized action chip styling.
  - RDP Session Manager uses shared modal scaffold and selection-list primitives.
  - Import/Export dialog uses shared modal scaffold while preserving embedded mode behavior.
  - File Transfer Manager uses shared modal scaffold (including nested upload dialog) and shared selection-list primitives for transfer queue rows.
  - SSH Key Manager uses shared modal scaffold with centralized header/body/footer primitives.
  - TOTP Manager uses shared modal scaffold and selection-list primitives for config rows.
- Overlay reduction:
  - manual `fixed inset-0` popup wrappers reduced from ~30 to 15 component files in this pass.

## Remaining Migration Backlog

### Dialog Priority (next)

- `SettingsDialog/index.tsx` and section sub-dialogs
- `ConnectionTree` nested editors
- `connectionEditor/HTTPOptions.tsx`

### Dialog Priority (follow-up)

- `TrustWarningDialog`
- nested editor dialogs in `ConnectionTree` and `connectionEditor/HTTPOptions.tsx`
- proxy editors (`ProxyProfileEditor`, `ProxyChainEditor`, `ProxyChainMenu`, `SSHTunnelDialog`)

### Option/List/CSS Priority

- Standardize list rows in:
  - `ConnectionDiagnostics` host/result lists
  - `CollectionSelector` dense lists
  - `ImportExport` previews
  - `FileTransferManager` transfer queues
  - `TOTPManager` configuration rows
- Standardize button chip groups in settings and tool headers.
- Keep semantic color overrides local, but always layer over shared structural classes.

## Next Execution Wave (Immediate)

1. Migrate settings-related nested dialogs to `Modal` while preserving existing close semantics.
2. Apply `.sor-tab-trigger` in at least two additional manager-style components to complete tab-header standardization.
3. Expand `.sor-selection-*` adoption to dense operational lists in `ConnectionTree` and settings sub-dialogs.
4. Re-run lint and targeted test set after each batch to catch regressions early.

## Execution Plan

### Phase 1: Dialog Unification

- Migrate highest-traffic dialogs to `Modal` first.
- Preserve existing `data-testid` values and close behavior semantics.
- Where a dialog needs custom escape handling, set `closeOnEscape={false}` and keep local keyboard flow.

### Phase 2: Option/List Primitive Adoption

- Replace repeated ad-hoc Tailwind class stacks with shared `.sor-option-*`, `.sor-chip-*`, `.sor-selection-*` classes.
- Keep component-specific state coloring additive (e.g. green selected rows in WOL).

### Phase 3: Table Shell Consolidation

- Move remaining table shells to `.sor-data-table`.
- Add companion table utility classes only when at least 2 components share them.

### Phase 4: Cleanup + Hardening

- Remove no-longer-used local style fragments after migration completion.
- Add regression tests for backdrop close, escape behavior, and selected-row rendering on migrated dialogs.

## Guardrails

- No feature/logic changes while centralizing structure and CSS.
- Preserve keyboard behavior and focus flow.
- Keep theme variable usage (`--color-*`) as the single style source.

## Verification

- `npm run lint`
- `npm test -- --run` (fallback to direct Vitest if Bun is unavailable)
- Targeted tests for touched dialogs/components
- Manual spot check: open/close, backdrop click, escape key, selection states
