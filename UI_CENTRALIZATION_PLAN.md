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
- New centralized CSS primitives added in `src/index.css`:
  - option chips/cards: `.sor-option-chip`, `.sor-option-chip-active`, `.sor-option-card`
  - chip lists: `.sor-chip-list`, `.sor-chip-button`
  - selectable list rows: `.sor-selection-list`, `.sor-selection-row`, `.sor-selection-row-selected`, `.sor-selection-row-hover-action`
- Component-level adoption in this wave:
  - Connection Editor protocol/option groups now use shared option classes.
  - WOL Quick Tool uses shared chip/list/selection classes.

## Remaining Migration Backlog

### Dialog Priority (next)

- `CollectionSelector`
- `SettingsDialog/index.tsx` and section sub-dialogs
- `PerformanceMonitor`
- `ConnectionDiagnostics`
- `InternalProxyManager`
- `RdpSessionManager`

### Dialog Priority (follow-up)

- `ActionLogViewer`
- `ImportExport/index.tsx`
- `FileTransferManager`
- `SSHKeyManager`
- `TOTPManager`
- `TrustWarningDialog`
- nested editor dialogs in `ConnectionTree` and `connectionEditor/HTTPOptions.tsx`

### Option/List/CSS Priority

- Standardize list rows in:
  - `WakeScheduleManager`
  - `TotpImportDialog`
  - `ConnectionDiagnostics` host/result lists
  - `InternalProxyManager` session/log lists
- Standardize button chip groups in settings and tool headers.
- Keep semantic color overrides local, but always layer over shared structural classes.

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
