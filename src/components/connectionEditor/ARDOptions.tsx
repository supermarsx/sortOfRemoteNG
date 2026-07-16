import React from "react";
import {
  ExternalLink,
  Info,
  Monitor,
  MousePointer2,
  Shield,
} from "lucide-react";
import type { Connection } from "../../types/connection/connection";
import {
  normalizeArdSettings,
  type ArdAuthMode,
} from "../../types/protocols/ard";
import { Checkbox, PasswordInput, Select } from "../ui/forms";

export type ArdOptionsSection =
  | "connection"
  | "authentication"
  | "display-input";

interface ARDOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  sections?: readonly ArdOptionsSection[];
}

const cardClass =
  "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3";

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}> = ({ checked, onChange, label, description }) => (
  <label className="flex min-w-0 items-start gap-2.5">
    <Checkbox
      checked={checked}
      onChange={onChange}
      variant="form"
      aria-label={label}
    />
    <span className="min-w-0">
      <span className="block text-xs font-medium text-[var(--color-text)]">
        {label}
      </span>
      <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-textMuted)]">
        {description}
      </span>
    </span>
  </label>
);

export const ARDOptions: React.FC<ARDOptionsProps> = ({
  formData,
  setFormData,
  sections,
}) => {
  const settings = normalizeArdSettings(formData.ardSettings);
  const shows = (section: ArdOptionsSection) =>
    !sections || sections.includes(section);
  const updateSettings = (patch: Partial<typeof settings>) =>
    setFormData((previous) => ({
      ...previous,
      ardSettings: { ...normalizeArdSettings(previous.ardSettings), ...patch },
    }));
  const updateAuthMode = (authMode: ArdAuthMode) =>
    setFormData((previous) => ({
      ...previous,
      // Native Screen Sharing performs authentication outside this app. Drop
      // any embedded ARD credentials when selecting it so an Apple Account is
      // never represented as a saved connection secret.
      ...(authMode === "appleAccountNative"
        ? { username: "", password: "" }
        : authMode === "vncPassword"
          ? { username: "" }
          : {}),
      ardSettings: {
        ...normalizeArdSettings(previous.ardSettings),
        authMode,
      },
    }));

  if (formData.isGroup || formData.protocol !== "ard") return null;

  return (
    <div data-editor-search-section="ard-options" className="min-w-0 space-y-3">
      {shows("connection") && (
        <section
          data-editor-search-field="ard-auto-reconnect"
          className={cardClass}
        >
          <div className="mb-3 flex items-start gap-2">
            <Monitor size={15} className="mt-0.5 shrink-0 text-primary" />
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-text)]">
                Embedded ARD session
              </h4>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
                Connects directly to Apple Remote Desktop or macOS Screen
                Sharing over RFB on port 5900 by default.
              </p>
            </div>
          </div>
          <Toggle
            checked={settings.autoReconnect}
            onChange={(autoReconnect) => updateSettings({ autoReconnect })}
            label="Automatically reconnect"
            description="Retry the embedded session after an unexpected disconnect."
          />
        </section>
      )}

      {shows("authentication") && (
        <section data-editor-search-field="ard-auth-mode" className={cardClass}>
          <div className="mb-3 flex items-start gap-2">
            <Shield size={15} className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <Select
                id="ard-auth-mode"
                label="Authentication mode"
                value={settings.authMode}
                onChange={(authMode) => updateAuthMode(authMode as ArdAuthMode)}
                options={[
                  {
                    value: "macOsAccount",
                    label: "Remote Mac account (embedded ARD)",
                  },
                  {
                    value: "vncPassword",
                    label: "Legacy VNC password (embedded RFB)",
                  },
                  {
                    value: "appleAccountNative",
                    label: "Apple Account via Screen Sharing.app",
                  },
                ]}
                searchable
                variant="form-sm"
                className="w-full min-w-0"
              />
            </div>
          </div>

          {settings.authMode === "macOsAccount" && (
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="min-w-0">
                <span className="sor-form-label">Remote Mac username</span>
                <input
                  id="ard-username"
                  data-editor-search-field="ard-username"
                  type="text"
                  value={formData.username ?? ""}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      username: event.target.value,
                    }))
                  }
                  autoComplete="username"
                  className="sor-form-input-sm w-full min-w-0"
                />
              </label>
              <label className="min-w-0">
                <span className="sor-form-label">Remote Mac password</span>
                <PasswordInput
                  id="ard-password"
                  data-editor-search-field="ard-password"
                  value={formData.password ?? ""}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      password: event.target.value,
                    }))
                  }
                  className="sor-form-input-sm w-full min-w-0"
                  autoComplete="current-password"
                />
              </label>
            </div>
          )}

          {settings.authMode === "vncPassword" && (
            <label className="block min-w-0">
              <span className="sor-form-label">VNC server password</span>
              <PasswordInput
                id="ard-password"
                data-editor-search-field="ard-password"
                value={formData.password ?? ""}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    password: event.target.value,
                    username: "",
                  }))
                }
                className="sor-form-input-sm w-full min-w-0"
                autoComplete="current-password"
              />
              <span className="mt-1 block text-[11px] text-[var(--color-textMuted)]">
                Uses the server's legacy VNC authentication, not an Apple
                Account.
              </span>
            </label>
          )}

          {settings.authMode === "appleAccountNative" && (
            <div
              data-editor-search-field="ard-native-handoff"
              className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-[11px] leading-4 text-[var(--color-textSecondary)]"
            >
              <div className="flex items-start gap-2">
                <ExternalLink size={14} className="mt-0.5 shrink-0 text-info" />
                <p>
                  Opens Apple's Screen Sharing app on macOS. Sign in or approve
                  the connection there. This app does not collect, store, or
                  send an Apple Account password, and macOS does not provide a
                  documented target-prefill API for this handoff.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {shows("display-input") && (
        <section
          data-editor-search-field="ard-display-input"
          className={`${cardClass} space-y-3`}
        >
          <div className="flex items-start gap-2">
            <MousePointer2 size={15} className="mt-0.5 shrink-0 text-primary" />
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-text)]">
                Display and input
              </h4>
              <p className="mt-0.5 text-[11px] text-[var(--color-textMuted)]">
                Controls applied by the embedded ARD viewer.
              </p>
            </div>
          </div>
          <Toggle
            checked={settings.localCursor}
            onChange={(localCursor) => updateSettings({ localCursor })}
            label="Show local cursor"
            description="Render the pointer locally for responsive movement."
          />
          <Toggle
            checked={settings.viewOnly}
            onChange={(viewOnly) => updateSettings({ viewOnly })}
            label="View only"
            description="Do not send keyboard or pointer input to the remote Mac."
          />
          <Toggle
            checked={settings.curtainOnConnect}
            onChange={(curtainOnConnect) =>
              updateSettings({ curtainOnConnect })
            }
            label="Enable curtain mode on connect"
            description="Ask the remote Mac to hide the local display while the session is active."
          />
          <div className="flex items-start gap-2 rounded-md bg-[var(--color-surfaceHover)] px-2.5 py-2 text-[10px] leading-4 text-[var(--color-textMuted)]">
            <Info size={13} className="mt-0.5 shrink-0" />
            Curtain mode depends on the remote Mac's ARD permissions and may be
            rejected by the server.
          </div>
        </section>
      )}
    </div>
  );
};

export default ARDOptions;
