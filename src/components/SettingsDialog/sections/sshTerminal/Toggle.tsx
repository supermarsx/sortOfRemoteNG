/**
 * SSH-section toggle re-export.
 *
 * Earlier this file rolled its own checkbox-on-the-right layout, but
 * every other settings panel uses the shared `SettingsToggleRow`
 * primitive (checkbox on the left via `sor-settings-toggle-row`,
 * matched font sizes via `sor-settings-toggle-label` /
 * `sor-settings-toggle-description`). Re-export the shared one so
 * the SSH panel renders identically to the rest of the dialog.
 */
export { SettingsToggleRow as default } from "../../../ui/settings/SettingsPrimitives";
