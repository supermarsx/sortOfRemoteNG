import { KeyRound, Phone, Settings2, ShieldCheck } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { Connection } from "../../types/connection/connection";
import {
  VOIP_PHONE_AUTH_MODES,
  VOIP_PHONE_DEFAULT_TIMEOUT_SECS,
  VOIP_PHONE_VENDORS,
  normalizeVoipPhoneSettings,
  type VoipPhoneAuthMode,
  type VoipPhoneSettings,
  type VoipPhoneVendor,
} from "../../types/voipPhone";
import { Checkbox } from "../ui/forms";

export type VoipPhoneOptionsSection =
  | "connection"
  | "authentication"
  | "security"
  | "advanced";

interface VoipPhoneOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  section?: VoipPhoneOptionsSection;
}

const cardClass =
  "min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3";

const VENDOR_FALLBACK_LABELS: Record<VoipPhoneVendor, string> = {
  yealink: "Yealink",
};

const AUTH_MODE_FALLBACK_LABELS: Record<VoipPhoneAuthMode, string> = {
  auto: "Auto-detect",
  basic: "HTTP Basic",
  form: "Login form",
};

const optionalNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const Toggle: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
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

/**
 * Protocol options for the `voip-phone` protocol (vendor drivers; Yealink
 * first). Writes only the non-secret `voipPhoneSettings` block — the phone's
 * admin username/password stay on the parent connection's Basics tab.
 */
const VoipPhoneOptions: React.FC<VoipPhoneOptionsProps> = ({
  formData,
  setFormData,
  section,
}) => {
  const { t } = useTranslation();
  if (formData.isGroup || formData.protocol !== "voip-phone") return null;

  const settings = normalizeVoipPhoneSettings(formData.voipPhoneSettings);
  const shows = (candidate: VoipPhoneOptionsSection) =>
    !section || section === candidate;

  const update = (patch: Partial<VoipPhoneSettings>) =>
    setFormData((previous) => ({
      ...previous,
      voipPhoneSettings: {
        vendor: previous.voipPhoneSettings?.vendor ?? "yealink",
        ...previous.voipPhoneSettings,
        ...patch,
      },
    }));

  return (
    <div
      data-editor-search-section="voip-phone-options"
      data-testid="voip-phone-options"
      className="min-w-0 space-y-3"
    >
      {shows("connection") && (
        <section className={cardClass}>
          <div className="flex items-start gap-2">
            <Phone size={15} className="mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-[var(--color-text)]">
                {t(
                  "connectionEditor.protocolOptions.voipPhone.label",
                  "VoIP Phone (Yealink)",
                )}
              </h4>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
                {t(
                  "connectionEditor.protocolOptions.voipPhone.description",
                  "Desk-phone web admin: status, web UI, reboot",
                )}
              </p>
            </div>
          </div>

          <label
            className="block min-w-0"
            data-editor-search-field="voip-phone-vendor"
          >
            <span className="sor-form-label">
              {t("voipPhone.vendor", "Phone vendor")}
            </span>
            <select
              id="voip-phone-vendor"
              data-testid="voip-phone-vendor"
              value={settings.vendor}
              onChange={(event) =>
                update({ vendor: event.target.value as VoipPhoneVendor })
              }
              className="sor-form-input-sm w-full min-w-0"
            >
              {VOIP_PHONE_VENDORS.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {t(
                    `voipPhone.vendors.${vendor}`,
                    VENDOR_FALLBACK_LABELS[vendor],
                  )}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
            {t(
              "voipPhone.vendorHelp",
              "Supported: Yealink SIP-T20P / T21P (incl. T21P E2) web admin. The firmware generation (legacy CGI or servlet) is detected automatically.",
            )}
          </p>
        </section>
      )}

      {shows("authentication") && (
        <section className={cardClass}>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
            <KeyRound size={15} className="text-primary" />
            {t("voipPhone.authentication", "Web admin login")}
          </div>
          <label
            className="block min-w-0"
            data-editor-search-field="voip-phone-auth-mode"
          >
            <span className="sor-form-label">
              {t("voipPhone.authMode", "Login mode")}
            </span>
            <select
              id="voip-phone-auth-mode"
              data-testid="voip-phone-auth-mode"
              value={settings.authMode}
              onChange={(event) =>
                update({ authMode: event.target.value as VoipPhoneAuthMode })
              }
              className="sor-form-input-sm w-full min-w-0"
            >
              {VOIP_PHONE_AUTH_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(
                    `voipPhone.authModes.${mode}`,
                    AUTH_MODE_FALLBACK_LABELS[mode],
                  )}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
            {t(
              "voipPhone.authModeHelp",
              "Auto-detect probes the phone and picks HTTP Basic (legacy firmware) or the servlet login form (T21P E2 / v8x+). Force a mode only if detection fails.",
            )}
          </p>
          <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
            {t(
              "voipPhone.credentialsStoredOnConnection",
              "Username and password remain in Basics (Yealink default admin/admin). Phone settings never duplicate the saved password.",
            )}
          </p>
        </section>
      )}

      {shows("security") && (
        <section className={cardClass}>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
            <ShieldCheck size={15} className="text-primary" />
            {t("voipPhone.tlsSecurity", "Transport security")}
          </div>
          <div data-editor-search-field="voip-phone-tls" className="space-y-3">
            <Toggle
              label={t("voipPhone.useSsl", "Use HTTPS")}
              description={t(
                "voipPhone.useSslHelp",
                "Connect to the phone's web admin over HTTPS instead of plain HTTP. Change the port to 443 if the phone serves TLS there.",
              )}
              checked={settings.useSsl}
              onChange={(useSsl) => update({ useSsl })}
            />
            <Toggle
              label={t("voipPhone.verifyCert", "Verify server certificate")}
              description={t(
                "voipPhone.verifyCertHelp",
                "Phones ship self-signed certificates: the first HTTPS connection is pinned (trust on first use) and later changes are rejected. Disable only for a trusted phone whose certificate rotates.",
              )}
              checked={settings.verifyCert}
              onChange={(verifyCert) => update({ verifyCert })}
            />
          </div>
        </section>
      )}

      {shows("advanced") && (
        <section className={cardClass}>
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
            <Settings2 size={15} className="text-primary" />
            {t("voipPhone.advanced", "Remote control")}
          </div>
          <div data-editor-search-field="voip-phone-action-uri">
            <Toggle
              label={t(
                "voipPhone.actionUri",
                "Action URI enabled on the phone",
              )}
              description={t(
                "voipPhone.actionUriHelp",
                "Reboot tries the Action URI (?key=Reboot) first. Enable Features > Remote Control > Action URI on the phone and allow this computer's IP; otherwise reboot falls back to the web admin reboot form.",
              )}
              checked={settings.actionUriEnabled}
              onChange={(actionUriEnabled) => update({ actionUriEnabled })}
            />
          </div>
          <label
            className="block min-w-0"
            data-editor-search-field="voip-phone-action-uri"
          >
            <span className="sor-form-label">
              {t("voipPhone.timeout", "Request timeout (seconds)")}
            </span>
            <input
              id="voip-phone-timeout"
              data-testid="voip-phone-timeout"
              type="number"
              min={1}
              max={600}
              value={formData.voipPhoneSettings?.timeoutSecs ?? ""}
              onChange={(event) =>
                update({ timeoutSecs: optionalNumber(event.target.value) })
              }
              className="sor-form-input-sm w-full min-w-0"
              placeholder={String(VOIP_PHONE_DEFAULT_TIMEOUT_SECS)}
            />
          </label>
        </section>
      )}
    </div>
  );
};

export default VoipPhoneOptions;
