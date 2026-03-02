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
  - `src/components/ui/ToolbarPopover.tsx`
  - `src/components/ui/OptionList.tsx`
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
  - `RDPSessionManager`
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
  - `WebBrowser` folder dropdown (bookmark folder children)
  - `CertificateInfoPopup`
  - `rdp/RDPTotpPanel` (anchored mode)
  - `rdp/RDPClientHeader` (send keys + host info)
  - `WebTerminal` (macro replay list)
  - `TabLayoutManager` (custom-grid popup)
  - `rdp/RDPTotpPanel` panel shell aligned to shared `sor-popover-panel`
  - shared toolbar popover shell/header extracted into `ToolbarPopover`
  - shared option list/group/items extracted into `OptionList`

### CSS Primitive Expansion

- `src/index.css` now centrally provides:
  - option styles: `.sor-option-chip`, `.sor-option-chip-active`, `.sor-option-card`
  - chip groups: `.sor-chip-list`, `.sor-chip-button`
  - selection rows: `.sor-selection-list`, `.sor-selection-row`, `.sor-selection-row-selected`, `.sor-selection-row-hover-action`
  - menu shell/items: `.sor-menu-surface`, `.sor-menu-item`, `.sor-menu-item-danger`, `.sor-menu-divider`
  - popover/list primitives: `.sor-popover-surface`, `.sor-option-list`, `.sor-option-item`
  - popover shell primitives: `.sor-popover-panel`, `.sor-popover-panel-strong`
  - option grouping primitives: `.sor-option-group`, `.sor-option-group-label`, `.sor-option-empty`, `.sor-option-item-*`
  - shared surface cards: `.sor-surface-card`
  - web error/help list primitives: `.sor-web-error-panel`, `.sor-guidance-list*`
  - performance card shells: `.sor-metric-card*`, `.sor-metric-summary-card`, `.sor-metric-table-shell`
  - shared settings form primitives: `.sor-settings-input*`, `.sor-settings-select`, `.sor-settings-range-*`, `.sor-settings-tile*`
  - shared editor/connect form primitives: `.sor-form-input`, `.sor-form-select`, `.sor-form-textarea`, `.sor-form-checkbox`
  - shared form composition primitives: `.sor-form-label*`, `.sor-form-inline-check`, `.sor-form-section-heading`, `.sor-form-input-*`, `.sor-form-select-*`, `.sor-form-textarea-*`
  - toolbar status popup primitives: `.sor-toolbar-popover-*`, `.sor-status-item`
  - **button primitives**: `.sor-btn-primary`, `.sor-btn-primary-sm`, `.sor-btn-secondary`, `.sor-btn-secondary-sm`, `.sor-btn-danger`, `.sor-btn-danger-sm`
  - **icon button primitives**: `.sor-icon-btn`, `.sor-icon-btn-sm`, `.sor-icon-btn-danger`
  - **badge pills**: `.sor-badge` + color modifiers (`-blue`, `-green`, `-red`, `-yellow`, `-purple`, `-orange`, `-gray`)
  - **section cards**: `.sor-section-card`, `.sor-diag-card`
  - **sidebar navigation**: `.sor-sidebar-tab`, `.sor-sidebar-tab-active`
  - **search input**: `.sor-search-input` (left-icon variant)
  - **alert banners**: `.sor-alert-error`, `.sor-alert-warning`
  - **mini buttons**: `.sor-btn-mini`, `.sor-btn-mini-primary`
  - **toggle cards**: `.sor-toggle-card`
  - **section headings**: `.sor-section-heading` (settings panels)
  - **settings form input**: `.sor-settings-input` (rounded-lg, --color-input bg)
  - **toggle labels**: `.sor-toggle-label` (group-hover color swap)
  - **inline tags**: `.sor-tag` (compact pill)
  - **table headers**: `.sor-th` (uppercase tracking header cell)
  - **diagnostics**: `.sor-diag-section-title`
- Migrated components adopted these classes where behavior/style stacks were duplicated.
  - latest adoption: `InternalProxyManager` stats/log cards and `WebBrowser` categorized error help cards
  - latest adoption: `RecordingSettings`, `MacroSettings`, and `WebBrowserSettings` form controls/tile shells
  - latest adoption: `PerformanceMonitor` metric/table cards, `RDPLogViewer` filter controls, and `RecordingManager` inline rename fields
  - latest adoption: `GeneralSettings`, `BackendSettings`, and `RDPDefaultSettings` cards/inputs/selects/checkboxes
  - latest adoption: `WebBrowser` error guidance lists via shared list primitives
  - latest adoption: `PerformanceSettings`, `ThemeSettings`, `ProxySettings`, and `StartupSettings` cards/inputs/selects/checkboxes/ranges
  - latest adoption: `AdvancedSettings`, `LayoutSettings`, `ApiSettings`, `SecuritySettings`, `RecoverySettings`, and `TrustVerificationSettings` cards/inputs/selects/checkboxes/ranges
  - latest adoption: `QuickConnect`, `connectionEditor/GeneralSection`, `connectionEditor/CloudProviderOptions`, `connectionEditor/SSHOptions`, `connectionEditor/HTTPOptions`, and `connectionEditor/RDPOptions` form controls/checkboxes
  - latest adoption: `connectionEditor/SSHTerminalOverrides`, `connectionEditor/SSHConnectionOverrides`, and `connectionEditor/TOTPOptions` override/input/checkbox control stacks
  - latest adoption: `ProxyProfileEditor`, `ColorTagManager`, and `WakeScheduleManager` modal form labels/inputs/selects/checkboxes
  - **latest adoption (CSS primitive sweep)**: 397 inline Tailwind class stacks replaced across 64 file-touches via 3 migration passes. Top files: `CollectionSelector` (65), `CloudSyncSettings` (38), `RDPDefaultSettings` (25), `ProxyChainMenu` (22), `ConnectionDiagnostics` (16), `SecuritySettings` (15), `ScriptManager` (15), and 57 more. 22 new CSS primitive classes added to `src/index.css`.

### Theme Color Migration

- **547 hardcoded Tailwind gray colors** replaced with CSS variable references across **85 files**.
- Mappings applied:
  - `text-gray-500` / `text-gray-600` → `text-[var(--color-textMuted)]`
  - `text-gray-200` → `text-[var(--color-textSecondary)]`
  - `placeholder-gray-500` / `placeholder-gray-400` → `placeholder-[var(--color-textMuted)]`
  - `disabled:bg-gray-600` / `disabled:bg-gray-500` → `disabled:bg-[var(--color-surfaceHover)]`
  - standalone `bg-gray-600` → `bg-[var(--color-surfaceHover)]`
  - standalone `bg-gray-500` → `bg-[var(--color-secondary)]`
- Top files: `RDPOptions` (31), `RDPDefaultSettings` (25), `RDPInternalsPanel` (24), `RecordingSettings` (20), `HTTPOptions` (19), `ApiSettings` (19), `RDPErrorScreen` (16), and 78 more.
- All hardcoded grays for text/placeholder/disabled-bg now route through `--color-*` theme variables.

### Duplicate ClassName → CSS Primitive Adoption (Pass 2)

- **35 replacements** across **12 files** consolidating 7 long duplicated className patterns into new CSS primitives.
- New primitives added to `src/index.css`:
  - `.sor-info-pill` — info stat row (6× duplicate)
  - `.sor-toolbar-row` — toolbar/subheader strip (5× duplicate)
  - `.sor-micro-actions` — tiny action group (5× duplicate)
  - `.sor-th-xs` — 10px table header (5× duplicate)
  - `.sor-settings-row` — settings toggle row (4× duplicate)
  - `.sor-micro-badge` — micro badge pill (4× duplicate)
  - `.sor-sub-heading` — uppercase subsection label (4× duplicate)
- Top files: `TOTPOptions` (7), `ImportTab` (6), `TrustVerificationSettings` (6), `PerformanceMonitor` (5), and 8 more.

### Test Coverage Added/Updated

- New:
  - `tests/HTTPOptions.test.tsx`
  - `tests/AppDialogs.test.tsx`
  - `tests/AutoLockManager.test.tsx`
  - `tests/ColorTagManager.test.tsx`
  - `tests/MenuSurface.test.tsx`
  - `tests/PopoverSurface.test.tsx`
  - `tests/ToolbarPopover.test.tsx`
  - `tests/OptionList.test.tsx`
  - `tests/StatusPopovers.test.tsx`
  - `tests/CertificateInfoPopup.test.tsx`
  - `tests/RDPClientHeader.test.tsx`
  - `tests/ProxyChainEditor.test.tsx`
  - `tests/ProxyProfileEditor.test.tsx`
  - `tests/SSHTunnelDialog.test.tsx`
  - `tests/TrustWarningDialog.test.tsx`
  - `tests/SettingsSections.test.tsx`
  - `tests/TabLayoutManager.test.tsx`
  - `tests/RDPLogViewer.test.tsx`
  - `tests/SettingsCoreSections.test.tsx`
  - `tests/SettingsSecondarySections.test.tsx`
  - `tests/SettingsExtendedSections.test.tsx`
  - `tests/SSHOverridesSections.test.tsx`
- Updated:
  - `tests/BulkSSHCommander.test.tsx`
  - `tests/ConnectionEditorSections.test.tsx`
  - `tests/ConnectionTree.test.tsx`
  - `tests/HTTPOptions.test.tsx`
  - `tests/QuickConnect.test.tsx`
  - `tests/SettingsDialog.test.tsx`
  - `tests/WebTerminal.test.tsx`
  - `tests/PerformanceMonitor.test.tsx`
  - `tests/ProxyProfileEditor.test.tsx`
  - `tests/ColorTagManager.test.tsx`
  - `tests/WakeScheduleManager.test.tsx`

## Remaining Scope

### Non-Modal Overlays To Triage

- fullscreen client containers and splash screen are intentionally not modal migrations

### Context/Action Menus (Different Primitive)

- Any future right-click menus should use `MenuSurface` by default.

### CSS Consolidation Follow-Up (Minimal Tail)

- ~17 inline classNames with 80+ chars and 3+ occurrences remain, but these are almost entirely within-file duplicates (e.g., 9x in LayoutSettings alone) or fragmented 3x patterns across 2-3 files — further consolidation has no practical benefit.
- Zero hardcoded gray colors remain in components or hooks — theme compliance is 100% complete.
- Remaining long classNames include component-specific layouts (modal/dialog shells, specific grid containers, unique color variants) that are intentionally one-off.
- New components should use `sor-*` CSS primitives from `src/styles/primitives.css` instead of raw Tailwind stacks.

## Execution Plan (Completed)

All major consolidation is complete:

1. ✅ Modal scaffold centralization (21+ components)
2. ✅ Menu/popover primitives and migration
3. ✅ Form primitives (339+ raw elements → shared components)
4. ✅ Display primitives (EmptyState, ErrorBanner, StatusBar, etc.)
5. ✅ DialogHeader centralization (24+ components)
6. ✅ Directory reorganization (66 files → 12 domain directories)
7. ✅ Naming consolidation (Rdp→RDP, directory casing, dead code)
8. ✅ CSS primitive adoption sweep (397 replacements, 22 new `sor-*` classes)
9. ✅ Theme color migration (547 hardcoded grays → CSS variables across 85 files)
10. ✅ CSS primitive pass 2 (35 replacements, 7 new `sor-*` classes across 12 files)
11. ✅ CSS file modularization — split monolithic files into focused partials:
    - `src/index.css` (1630 lines) → 9 partials in `src/styles/`: base, tailwind-overrides, embedded, buttons, primitives, modals, forms, lists, tables-tabs
    - `app/globals.css` (784 lines) → 7 partials in `app/styles/`: theme-variables, app-shell, scrollbar, form-controls, tooltip-editor, tailwind-overrides, animations
    - Hub files reduced to `@tailwind` directives + `@import` manifests (14 and 12 lines respectively)
12. ✅ Component splitting — Wave 1 (5 large files → 62 sub-files in 5 directories):
    - `ConnectionDiagnostics` (1340 lines) → `connection/diagnostics/` (17 sub-files + orchestrator)
    - `RDPOptions` → `connectionEditor/rdpOptions/` (12 sub-files + types.ts)
    - `CloudSyncSettings` (1147 lines) → `settingsDialog/sections/cloudSync/` (12 sub-files + types.ts)
    - `BehaviorSettings` → `settingsDialog/sections/behavior/` (13 sub-files)
    - `SecuritySettings` (816 lines) → `settingsDialog/sections/security/` (8 sub-files + types.ts)
13. ✅ Component splitting — Wave 2 (7 large files → 78 sub-files in 7 directories):
    - `SSHTerminalSettings` → `settingsDialog/sections/sshTerminal/` (14 sub-files)
    - `CollectionSelector` → `connection/collectionSelector/` (3 sub-files)
    - `WebBrowser` → `protocol/webBrowser/` (12 sub-files)
    - `SSHConnectionOverrides` → `connectionEditor/sshOverrides/` (13 sub-files)
    - `RDPDefaultSettings` → `settingsDialog/sections/rdpDefaults/` (11 sub-files + selectClass.tsx)
    - `TOTPOptions` → `connectionEditor/totpOptions/` (9 sub-files)
    - `BackupSettings` → `settingsDialog/sections/backup/` (9 sub-files)
14. ✅ Shared UI pattern extraction:
    - `src/components/ui/SectionHeading.tsx` — reusable heading with icon + title + optional description
    - `src/components/ui/CollapsibleSection.tsx` — expandable/collapsible section with controlled/uncontrolled modes
    - `src/components/ui/OverrideToggle.tsx` — checkbox toggle for connection-level setting overrides (shows global value when disabled)
    - `sshOverrides/OverrideToggle.tsx` converted to re-export wrapper; duplicate removed from `SSHTerminalOverrides.tsx`
    - `SectionHeading` adopted across 18 settings panel files (replacing inline `<h3>` + `<p>` heading patterns)
    - `CollapsibleSection` adopted in backup/AdvancedSection and cloudSync/AdvancedSection (replacing manual expand/collapse)
    - `SectionHeading` adopted in ApiSettings and StartupSettings
15. ✅ Component splitting — Wave 3 (9 large files → 76 sub-files in 9 directories):
    - `ConnectionTree` (584 lines) → `connection/connectionTree/` (6 sub-files)
    - `HTTPOptions` (658 lines) → `connectionEditor/httpOptions/` (10 sub-files)
    - `PerformanceMonitor` (503 lines) → `monitoring/performanceMonitor/` (6 sub-files)
    - `ProxyChainMenu` (685 lines) → `network/proxyChainMenu/` (5 sub-files)
    - `WhatsAppPanel` (1059 lines) → `protocol/whatsApp/` (11 sub-files)
    - `RDPClientHeader` (552 lines) → `rdp/rdpClientHeader/` (9 sub-files)
    - `ScriptManager` (492 lines) → `recording/scriptManager/` (10 sub-files)
    - `BulkSSHCommander` (605 lines) → `ssh/bulkCommander/` (8 sub-files)
    - `WebTerminal` (601 lines) → `ssh/webTerminal/` (11 sub-files)
16. ✅ Remaining hardcoded gray color cleanup — replaced ~40 remaining `gray-*` Tailwind classes with CSS variable references across wave 1-3 sub-files and rdpDefaults (including final 2 in RDPErrorScreen gradient stops)
17. ✅ CSS primitive pass 3 — extracted 18 new `sor-*` CSS classes, 80 replacements across 48 files:
    - `.sor-checkbox-lg` / `.sor-checkbox-sm` — checkbox input styling (16 occurrences)
    - `.sor-diag-panel` / `.sor-diag-heading` / `.sor-diag-empty` — diagnostics card/heading/empty (15 occurrences)
    - `.sor-totp-label` / `.sor-totp-action` — TOTP micro labels and actions (12 occurrences)
    - `.sor-modal-cancel` / `.sor-modal-primary` — modal button styles (7 occurrences)
    - `.sor-delete-btn-xs` — danger micro button (4 occurrences)
    - `.sor-recording-row` — recording list row (3 occurrences)
    - `.sor-perf-heading` — performance monitor section heading (3 occurrences)
    - `.sor-search-clear` / `.sor-search-icon-abs` / `.sor-search-inline` — search field primitives (11 occurrences)
    - `.sor-notification-dot` — notification badge dot (3 occurrences)
    - `.sor-settings-sub-card` — settings sub-card container (3 occurrences)
    - `.sor-form-label-icon` — form label with icon (3 occurrences)
18. ✅ Barrel exports — added `index.ts` to all 21 sub-component directories for clean re-exports (later removed 19 convenience-only barrels; only `ui/forms` and `ui/display` barrels remain as they are imported by 168 consumer files)
19. ✅ OOM test fix — changed `package.json` test script to `node --max-old-space-size=4096 ./node_modules/vitest/vitest.mjs --run`; all 84 test files (580 tests) pass reliably; added `.claude` worktree exclusion to `vitest.config.ts`
20. ✅ TextInput adoption — replaced 6 raw `<input type="text">` elements with `<TextInput variant="form">` across 3 files: `NetworkDiscovery` (3), `WakeScheduleManager` (2), `ProxyChainEditor` (1)
21. ✅ ApiSettings split — `ApiSettings.tsx` (557 lines) → 41-line orchestrator + 7 sub-files in `settingsDialog/sections/apiSettings/`: types.ts, EnableSection, ServerControlsSection, NetworkSection, AuthenticationSection, SslSection, PerformanceSection, RateLimitSection
22. ✅ useComposeTab hook extraction — extracted 13 `useState` hooks + `handleSend` + derived state from `ComposeTab.tsx` (281→177 lines) into `protocol/whatsApp/useComposeTab.ts` (136 lines)
23. ✅ BehaviorSettings duplicate import fix — removed 14 duplicate `import SectionHeading` lines (corruption from prior session)
24. ✅ X11 forwarding backend — `sorng-ssh` crate: new `ssh/x11.rs` module (380 lines) with local X11 proxy listener + bi-directional TCP relay; `X11ForwardingConfig` struct (enabled, trusted, display_offset, screen, display_override, xauthority_path, timeout_secs); 4 Tauri commands (`enable_x11_forwarding`, `disable_x11_forwarding`, `get_x11_forward_status`, `list_x11_forwards`); integrated into `service.rs` start_shell + disconnect_ssh cleanup
25. ✅ ProxyCommand backend — `sorng-ssh` crate: new `ssh/proxy_command.rs` module (415 lines) with OS-native shell spawning, stdio↔TCP relay socket pair, `%h/%p/%r` placeholder expansion; 6 templates (nc, ncat, socat, connect, corkscrew, ssh_stdio); 4 Tauri commands (`get_proxy_command_info`, `stop_proxy_command_cmd`, `test_proxy_command`, `expand_proxy_command`); wired as priority 0 transport in `connect_ssh()`
26. ✅ SSH types expansion — `types.rs`: added `x11_forwarding`, `proxy_command`, `pty_type`, `environment` to `SshConnectionConfig`; 7 new type structs/enums: `X11ForwardingConfig`, `X11ForwardInfo`, `X11ForwardStatus`, `ProxyCommandConfig`, `ProxyCommandTemplate`, `ProxyCommandStatus`, `ProxyCommandState`
27. ✅ Frontend SSH config wiring — `useWebTerminal.ts`: sshConfig invoke payload now passes `agent_forwarding`, `x11_forwarding`, `proxy_command`, `pty_type`, `environment` to backend; added `sshConnectionConfig` merge memo from `mergeSSHConnectionConfig`
28. ✅ Frontend type expansion — `sshSettings.ts`: added `x11Trusted`, `x11Screen`, `x11DisplayOverride`, `x11XauthorityPath`, `x11TimeoutSecs`, `proxyCommandTemplate`, `proxyCommandHost/Port/Username/Password/ProxyType/Timeout` to `SSHConnectionConfig`; new `ProxyCommandTemplate` union type; defaults added
29. ✅ ForwardingSection UI — expanded from 2 toggles to full X11 controls (trusted mode, display offset, DISPLAY override) + Agent Forwarding toggle + ProxyCommand section (template picker, custom command, proxy host/port/user/timeout); added `sshConnection` field to `GlobalSettings` + 3 default objects

## Guardrails

- No behavior changes while centralizing structure/CSS.
- Preserve existing keyboard and backdrop-close semantics per component.
- Keep theme variables (`--color-*`) as the single source of visual truth.

## Verification Checklist

- `npm run lint`
- `npm test -- --run` (fallback to direct Vitest when Bun is unavailable)
- targeted tests for every migrated dialog
- smoke-check backdrop click + escape close behavior for each popup class
