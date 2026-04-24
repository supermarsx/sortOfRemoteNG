# E2E Tier Map

## Purpose

This document is the current classification of the E2E surface into
`required`, `opt-in`, `nightly`, and `lab-only` tiers.

It complements [docs/testing/e2e-runbook.md](../testing/e2e-runbook.md) and
turns the rollout plan in [docs/plans/e2e-coverage-improvement-plan.md](../plans/e2e-coverage-improvement-plan.md)
into a concrete, reviewable map.

## Ruleset Target

The repo now contains the required smoke workflow in
[.github/workflows/e2e-smoke.yml](../../.github/workflows/e2e-smoke.yml),
but GitHub branch protection or rulesets still have to be configured in the
repository settings UI.

The check to require is:

- Workflow: `E2E Smoke`
- Job / status check: `SSH/SFTP smoke`

Source control cannot enforce that settings change by itself.

## Classification Logic

- `required`: deterministic, hosted-CI-safe, no specialty environment dependency, strong assertions expected
- `opt-in`: reproducible and useful for risky PRs, but slower, timing-heavier, or broader than a universal PR gate should carry
- `nightly`: useful regression signal with heavier UI coverage, weaker current signal quality, or timing-sensitive behavior
- `lab-only`: vendor, cloud, updater, multi-window, discovery, or other environment-sensitive flows that should not be treated as standard hosted-CI coverage

## WDIO Tiers

### `required`

Core startup, local CRUD, encryption, and persistent settings flows.

- [e2e/specs/01-startup/app-launch.spec.ts](../../e2e/specs/01-startup/app-launch.spec.ts)
- [e2e/specs/01-startup/app-window-controls.spec.ts](../../e2e/specs/01-startup/app-window-controls.spec.ts)
- [e2e/specs/02-collections/collection-create.spec.ts](../../e2e/specs/02-collections/collection-create.spec.ts)
- [e2e/specs/02-collections/collection-password.spec.ts](../../e2e/specs/02-collections/collection-password.spec.ts)
- [e2e/specs/02-collections/collection-switch.spec.ts](../../e2e/specs/02-collections/collection-switch.spec.ts)
- [e2e/specs/03-connections/connection-bulk.spec.ts](../../e2e/specs/03-connections/connection-bulk.spec.ts)
- [e2e/specs/03-connections/connection-create.spec.ts](../../e2e/specs/03-connections/connection-create.spec.ts)
- [e2e/specs/03-connections/connection-delete.spec.ts](../../e2e/specs/03-connections/connection-delete.spec.ts)
- [e2e/specs/03-connections/connection-edit.spec.ts](../../e2e/specs/03-connections/connection-edit.spec.ts)
- [e2e/specs/05-encryption/collection-encryption.spec.ts](../../e2e/specs/05-encryption/collection-encryption.spec.ts)
- [e2e/specs/05-encryption/export-encryption.spec.ts](../../e2e/specs/05-encryption/export-encryption.spec.ts)
- [e2e/specs/10-settings/settings-backup.spec.ts](../../e2e/specs/10-settings/settings-backup.spec.ts)
- [e2e/specs/10-settings/settings-general.spec.ts](../../e2e/specs/10-settings/settings-general.spec.ts)
- [e2e/specs/10-settings/settings-security.spec.ts](../../e2e/specs/10-settings/settings-security.spec.ts)
- [e2e/specs/10-settings/settings-startup.spec.ts](../../e2e/specs/10-settings/settings-startup.spec.ts)

### `opt-in`

Broader deterministic flows, including Docker-backed protocol coverage and
deeper configuration or session behavior.

- [e2e/specs/04-import-export/export-connections.spec.ts](../../e2e/specs/04-import-export/export-connections.spec.ts)
- [e2e/specs/04-import-export/import-connections.spec.ts](../../e2e/specs/04-import-export/import-connections.spec.ts)
- [e2e/specs/06-ssh/ssh-auth-methods.spec.ts](../../e2e/specs/06-ssh/ssh-auth-methods.spec.ts)
- [e2e/specs/06-ssh/ssh-bulk-commander.spec.ts](../../e2e/specs/06-ssh/ssh-bulk-commander.spec.ts)
- [e2e/specs/06-ssh/ssh-connect.spec.ts](../../e2e/specs/06-ssh/ssh-connect.spec.ts)
- [e2e/specs/06-ssh/ssh-file-transfer.spec.ts](../../e2e/specs/06-ssh/ssh-file-transfer.spec.ts)
- [e2e/specs/06-ssh/ssh-terminal.spec.ts](../../e2e/specs/06-ssh/ssh-terminal.spec.ts)
- [e2e/specs/06-ssh/ssh-tunnels.spec.ts](../../e2e/specs/06-ssh/ssh-tunnels.spec.ts)
- [e2e/specs/07-rdp/rdp-connect.spec.ts](../../e2e/specs/07-rdp/rdp-connect.spec.ts)
- [e2e/specs/07-rdp/rdp-error.spec.ts](../../e2e/specs/07-rdp/rdp-error.spec.ts)
- [e2e/specs/07-rdp/rdp-settings.spec.ts](../../e2e/specs/07-rdp/rdp-settings.spec.ts)
- [e2e/specs/08-protocols/ftp-client.spec.ts](../../e2e/specs/08-protocols/ftp-client.spec.ts)
- [e2e/specs/08-protocols/http-viewer.spec.ts](../../e2e/specs/08-protocols/http-viewer.spec.ts)
- [e2e/specs/08-protocols/mysql-client.spec.ts](../../e2e/specs/08-protocols/mysql-client.spec.ts)
- [e2e/specs/08-protocols/vnc-connect.spec.ts](../../e2e/specs/08-protocols/vnc-connect.spec.ts)
- [e2e/specs/09-sessions/session-layouts.spec.ts](../../e2e/specs/09-sessions/session-layouts.spec.ts)
- [e2e/specs/09-sessions/session-reconnect.spec.ts](../../e2e/specs/09-sessions/session-reconnect.spec.ts)
- [e2e/specs/09-sessions/session-tabs.spec.ts](../../e2e/specs/09-sessions/session-tabs.spec.ts)
- [e2e/specs/10-settings/settings-reset.spec.ts](../../e2e/specs/10-settings/settings-reset.spec.ts)
- [e2e/specs/11-security/auto-lock.spec.ts](../../e2e/specs/11-security/auto-lock.spec.ts)
- [e2e/specs/11-security/certificate-viewer.spec.ts](../../e2e/specs/11-security/certificate-viewer.spec.ts)
- [e2e/specs/11-security/credential-manager.spec.ts](../../e2e/specs/11-security/credential-manager.spec.ts)
- [e2e/specs/11-security/totp-manager.spec.ts](../../e2e/specs/11-security/totp-manager.spec.ts)
- [e2e/specs/11-security/trust-store.spec.ts](../../e2e/specs/11-security/trust-store.spec.ts)
- [e2e/specs/14-recording/macro-recorder.spec.ts](../../e2e/specs/14-recording/macro-recorder.spec.ts)
- [e2e/specs/14-recording/script-manager.spec.ts](../../e2e/specs/14-recording/script-manager.spec.ts)
- [e2e/specs/14-recording/session-recording.spec.ts](../../e2e/specs/14-recording/session-recording.spec.ts)
- [e2e/specs/21-i18n/language-switching.spec.ts](../../e2e/specs/21-i18n/language-switching.spec.ts)
- [e2e/specs/22-smart-filters/smart-filter-manager.spec.ts](../../e2e/specs/22-smart-filters/smart-filter-manager.spec.ts)
- [e2e/specs/22-smart-filters/smart-filter-presets.spec.ts](../../e2e/specs/22-smart-filters/smart-filter-presets.spec.ts)

### `nightly`

Broader UI surfaces that are still useful, but either too timing-heavy,
too shallow, or too broad for current PR-gated usage.

- [e2e/specs/03-connections/connection-favorites.spec.ts](../../e2e/specs/03-connections/connection-favorites.spec.ts)
- [e2e/specs/03-connections/connection-groups.spec.ts](../../e2e/specs/03-connections/connection-groups.spec.ts)
- [e2e/specs/03-connections/connection-search.spec.ts](../../e2e/specs/03-connections/connection-search.spec.ts)
- [e2e/specs/03-connections/connection-templates.spec.ts](../../e2e/specs/03-connections/connection-templates.spec.ts)
- [e2e/specs/10-settings/settings-rdp-defaults.spec.ts](../../e2e/specs/10-settings/settings-rdp-defaults.spec.ts)
- [e2e/specs/10-settings/settings-ssh-defaults.spec.ts](../../e2e/specs/10-settings/settings-ssh-defaults.spec.ts)
- [e2e/specs/12-network-tools/diagnostics.spec.ts](../../e2e/specs/12-network-tools/diagnostics.spec.ts)
- [e2e/specs/12-network-tools/proxy-chains.spec.ts](../../e2e/specs/12-network-tools/proxy-chains.spec.ts)
- [e2e/specs/12-network-tools/topology-visualizer.spec.ts](../../e2e/specs/12-network-tools/topology-visualizer.spec.ts)
- [e2e/specs/12-network-tools/wake-on-lan.spec.ts](../../e2e/specs/12-network-tools/wake-on-lan.spec.ts)
- [e2e/specs/13-monitoring/action-log.spec.ts](../../e2e/specs/13-monitoring/action-log.spec.ts)
- [e2e/specs/13-monitoring/health-dashboard.spec.ts](../../e2e/specs/13-monitoring/health-dashboard.spec.ts)
- [e2e/specs/13-monitoring/performance-monitor.spec.ts](../../e2e/specs/13-monitoring/performance-monitor.spec.ts)
- [e2e/specs/15-scheduler/scheduler-tasks.spec.ts](../../e2e/specs/15-scheduler/scheduler-tasks.spec.ts)
- [e2e/specs/16-windows-tools/winrm-tools.spec.ts](../../e2e/specs/16-windows-tools/winrm-tools.spec.ts)
- [e2e/specs/20-accessibility/keyboard-navigation.spec.ts](../../e2e/specs/20-accessibility/keyboard-navigation.spec.ts)
- [e2e/specs/20-accessibility/screen-reader.spec.ts](../../e2e/specs/20-accessibility/screen-reader.spec.ts)
- [e2e/specs/23-tags/tag-manager.spec.ts](../../e2e/specs/23-tags/tag-manager.spec.ts)
- [e2e/specs/30-ssh-tools/ssh-key-agent-mcp.spec.ts](../../e2e/specs/30-ssh-tools/ssh-key-agent-mcp.spec.ts)
- [e2e/specs/31-settings-extended/settings-extended-tabs.spec.ts](../../e2e/specs/31-settings-extended/settings-extended-tabs.spec.ts)
- [e2e/specs/32-protocols-extended/protocol-clients.spec.ts](../../e2e/specs/32-protocols-extended/protocol-clients.spec.ts)
- [e2e/specs/33-ui-features/shortcuts-contextmenu-errorlog.spec.ts](../../e2e/specs/33-ui-features/shortcuts-contextmenu-errorlog.spec.ts)
- [e2e/specs/34-security-extended/security-extended.spec.ts](../../e2e/specs/34-security-extended/security-extended.spec.ts)

### `lab-only`

Environment-sensitive, vendor, cloud, update, multi-window, or discovery
flows that should not be considered normal hosted-CI coverage.

- [e2e/specs/01-startup/app-error-recovery.spec.ts](../../e2e/specs/01-startup/app-error-recovery.spec.ts)
- [e2e/specs/02-collections/clone-and-check.spec.ts](../../e2e/specs/02-collections/clone-and-check.spec.ts)
- [e2e/specs/12-network-tools/network-discovery.spec.ts](../../e2e/specs/12-network-tools/network-discovery.spec.ts)
- [e2e/specs/17-marketplace/marketplace-browse.spec.ts](../../e2e/specs/17-marketplace/marketplace-browse.spec.ts)
- [e2e/specs/17-marketplace/marketplace-install.spec.ts](../../e2e/specs/17-marketplace/marketplace-install.spec.ts)
- [e2e/specs/18-updater/updater-check.spec.ts](../../e2e/specs/18-updater/updater-check.spec.ts)
- [e2e/specs/19-multi-window/session-detach.spec.ts](../../e2e/specs/19-multi-window/session-detach.spec.ts)
- [e2e/specs/19-multi-window/window-sync.spec.ts](../../e2e/specs/19-multi-window/window-sync.spec.ts)
- [e2e/specs/24-cloud-sync/cloud-sync.spec.ts](../../e2e/specs/24-cloud-sync/cloud-sync.spec.ts)
- [e2e/specs/25-ddns/ddns-manager.spec.ts](../../e2e/specs/25-ddns/ddns-manager.spec.ts)
- [e2e/specs/26-synology/synology-panel.spec.ts](../../e2e/specs/26-synology/synology-panel.spec.ts)
- [e2e/specs/27-idrac/idrac-panel.spec.ts](../../e2e/specs/27-idrac/idrac-panel.spec.ts)
- [e2e/specs/28-proxmox/proxmox-panel.spec.ts](../../e2e/specs/28-proxmox/proxmox-panel.spec.ts)
- [e2e/specs/29-debug/debug-panel.spec.ts](../../e2e/specs/29-debug/debug-panel.spec.ts)

## Rust E2E Tiers

Only the Docker-backed golden-path tests below are treated as part of the E2E
tier model.

### Rust `required`

- [src-tauri/crates/sorng-ssh/tests/golden_path.rs](../../src-tauri/crates/sorng-ssh/tests/golden_path.rs)
- [src-tauri/crates/sorng-sftp/tests/golden_path.rs](../../src-tauri/crates/sorng-sftp/tests/golden_path.rs)

### Rust `opt-in`

- [src-tauri/crates/sorng-ftp/tests/golden_path.rs](../../src-tauri/crates/sorng-ftp/tests/golden_path.rs)
- [src-tauri/crates/sorng-rdp/tests/golden_path.rs](../../src-tauri/crates/sorng-rdp/tests/golden_path.rs)
- [src-tauri/crates/sorng-smb/tests/golden_path.rs](../../src-tauri/crates/sorng-smb/tests/golden_path.rs)
- [src-tauri/crates/sorng-vnc/tests/golden_path.rs](../../src-tauri/crates/sorng-vnc/tests/golden_path.rs)

### Rust `nightly`

- [src-tauri/crates/sorng-docker-compose/tests/compose_tests.rs](../../src-tauri/crates/sorng-docker-compose/tests/compose_tests.rs)
- [src-tauri/crates/sorng-vpn/tests/softether_e2e.rs](../../src-tauri/crates/sorng-vpn/tests/softether_e2e.rs)

### Excluded From The E2E Tier Map

These are integration or behavior tests, but they are not currently part of
the environment-driven E2E tiering model:

- [src-tauri/crates/sorng-probes/tests/bulk_check_integration.rs](../../src-tauri/crates/sorng-probes/tests/bulk_check_integration.rs)
- [src-tauri/crates/sorng-rdp/tests/cert_trust.rs](../../src-tauri/crates/sorng-rdp/tests/cert_trust.rs)
- [src-tauri/crates/sorng-rdp/tests/credential_hygiene.rs](../../src-tauri/crates/sorng-rdp/tests/credential_hygiene.rs)
- [src-tauri/crates/sorng-rdp/tests/redirection_flags.rs](../../src-tauri/crates/sorng-rdp/tests/redirection_flags.rs)

## Weak Or Misleading Specs

These files are especially important to clean up before any promotion into a
stricter gate:

- [e2e/specs/03-connections/connection-templates.spec.ts](../../e2e/specs/03-connections/connection-templates.spec.ts): useful core flow, but still pause-heavy
- [e2e/specs/32-protocols-extended/protocol-clients.spec.ts](../../e2e/specs/32-protocols-extended/protocol-clients.spec.ts): broad surface, but much of the current signal is render-level only
- [e2e/specs/34-security-extended/security-extended.spec.ts](../../e2e/specs/34-security-extended/security-extended.spec.ts): broad coverage with heavy timing assumptions
- [e2e/specs/01-startup/app-error-recovery.spec.ts](../../e2e/specs/01-startup/app-error-recovery.spec.ts): fragile recovery-path behavior, not a standard CI candidate
- [e2e/specs/12-network-tools/network-discovery.spec.ts](../../e2e/specs/12-network-tools/network-discovery.spec.ts): live network assumptions push it out of hosted-CI-safe territory

## Promotion Candidates

Best next WDIO candidates for eventual hosted-CI promotion after cleanup:

1. [e2e/specs/06-ssh/ssh-file-transfer.spec.ts](../../e2e/specs/06-ssh/ssh-file-transfer.spec.ts)
2. [e2e/specs/06-ssh/ssh-connect.spec.ts](../../e2e/specs/06-ssh/ssh-connect.spec.ts)
3. [e2e/specs/06-ssh/ssh-auth-methods.spec.ts](../../e2e/specs/06-ssh/ssh-auth-methods.spec.ts)
4. [e2e/specs/03-connections/connection-templates.spec.ts](../../e2e/specs/03-connections/connection-templates.spec.ts)
5. [e2e/specs/04-import-export/import-connections.spec.ts](../../e2e/specs/04-import-export/import-connections.spec.ts)
