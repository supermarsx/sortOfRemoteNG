# UI/CSS Centralization Plan

## Goal
Centralize repeated UI structures and styles for:
- Popup/dialog scaffolding
- List/table shells
- Settings option groups
- Shared color/spacing/elevation CSS patterns

## Success Criteria
- New and existing dialogs use a shared modal primitive.
- Core settings sections use shared option-group primitives.
- High-use list/table UIs share common table/list classes and patterns.
- New components can be built without re-copying modal/list/settings scaffolds.

## Architecture
### 1) Dialog Layer
- Use `src/components/ui/Modal.tsx` as the single modal scaffold.
- Standardize:
  - escape close handling
  - backdrop close handling
  - header/body/footer wrappers
  - panel sizing through shared class utilities
- Keep `data-testid` support for existing tests.

### 2) Settings Layer
- Use `src/components/ui/SettingsPrimitives.tsx` for:
  - section headers
  - cards
  - toggle rows
  - slider/select rows
  - collapsible groups
- Keep per-feature logic local; only centralize visual and structural primitives.

### 3) List/Table Layer
- Use centralized CSS classes for shared table behavior:
  - sticky headers
  - body separators
  - consistent spacing and hover behavior
- Gradually migrate existing tables to shared classes.

### 4) CSS Layer
- Keep global shared classes in `src/index.css` under centralized blocks:
  - modal primitives
  - settings primitives
  - data-table primitives
  - toolbar popup primitives
- Continue using existing theme variables (`--color-*`) as the source of truth.

## Rollout Plan
### Phase 1: Foundation (done)
- Modal primitive + modal CSS utilities available.
- Settings primitives + settings CSS utilities available.
- Shared table/popup CSS utility blocks available.

### Phase 2: Core Dialog Migration (in progress)
- Migrate major dialogs/managers to `Modal`.
- Completed in this pass:
  - `QuickConnect`
- Next targets:
  - `CollectionSelector`
  - `ConnectionEditor`
  - `SettingsDialog`
  - `PerformanceMonitor`

### Phase 3: Settings Consolidation
- Migrate all settings tabs to `SettingsPrimitives`.
- Prioritize high-churn sections first:
  - Behavior
  - Security
  - Layout
  - RDP defaults

### Phase 4: List/Table Consolidation
- Migrate operational/data-heavy components first:
  - Action log
  - File/SMB/MySQL viewers
  - Performance tables

### Phase 5: Cleanup
- Remove duplicated local helper components after migration.
- Remove legacy CSS overrides no longer needed.
- Update tests to target shared modal semantics where appropriate.

## Guardrails
- No behavior changes while centralizing structure/CSS.
- Keep accessibility attributes and keyboard flows intact.
- Preserve existing visual language unless explicitly redesigned.

## Verification Checklist
- `npm run lint`
- `npm test -- --run` (or fallback in environments without Bun)
- Targeted test runs for changed dialog components
- Manual open/close verification for migrated dialogs
