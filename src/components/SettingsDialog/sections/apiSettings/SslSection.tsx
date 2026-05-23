import React from "react";
import { FileKey, Shield, Key, Globe, Zap } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";
import { TextInput } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings/settings";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
import { InfoTooltip } from "../../../ui/InfoTooltip";

export const SslSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => {
  const sslOn = settings.restApi?.sslEnabled ?? false;
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<FileKey className="w-4 h-4 text-primary" />}
        title={mgr.t("settings.api.ssl", "SSL/TLS")}
      />

      <div className="sor-settings-card">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <div className="flex items-center gap-3 min-w-0">
            <Shield className="w-4 h-4 text-[var(--color-textSecondary)] flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-[var(--color-text)] flex items-center gap-1">
                {mgr.t("settings.api.enableSsl", "Enable HTTPS")}
                <InfoTooltip text="Encrypt all API traffic with SSL/TLS. Required for secure communication, especially over public networks." />
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                {mgr.t("settings.api.enableSslDescription", "Use SSL/TLS encryption for API connections")}
              </p>
            </div>
          </div>
          <Checkbox
            checked={sslOn}
            onChange={(v: boolean) => mgr.updateRestApi({ sslEnabled: v })}
            className="sor-checkbox-lg flex-shrink-0"
          />
        </label>

        <div
          className={`space-y-4 pt-3 border-t border-[var(--color-border)] ${!sslOn ? "opacity-50 pointer-events-none" : ""}`}
        >
          {/* SSL Mode Selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Shield className="w-4 h-4" />
              {mgr.t("settings.api.sslMode", "Certificate Mode")}
              <InfoTooltip text="How the SSL certificate is obtained: provide your own, auto-generate a self-signed one, or use Let's Encrypt." />
            </label>
            <Select value={settings.restApi?.sslMode || "manual"} onChange={(v: string) => mgr.updateRestApi({ sslMode: v as "manual" | "self-signed" | "letsencrypt" })} options={[{ value: "manual", label: mgr.t("settings.api.sslManual", "Manual (Provide Certificate)") }, { value: "self-signed", label: mgr.t("settings.api.sslSelfSigned", "Auto-Generate Self-Signed") }, { value: "letsencrypt", label: mgr.t("settings.api.sslLetsEncrypt", "Let's Encrypt (Auto-Renew)") }]} className="w-full" />
          </div>

          {/* Manual Certificate Paths */}
          {settings.restApi?.sslMode === "manual" && (
            <>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <FileKey className="w-4 h-4" />
                  {mgr.t("settings.api.certPath", "Certificate Path")}
                  <InfoTooltip text="File path to the PEM-encoded SSL certificate used by the API server." />
                </label>
                <TextInput
                  value={settings.restApi?.sslCertPath || ""}
                  onChange={(v) => mgr.updateRestApi({ sslCertPath: v })}
                  variant="settings"
                  className="w-full"
                  placeholder="/path/to/certificate.pem"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <Key className="w-4 h-4" />
                  {mgr.t("settings.api.keyPath", "Private Key Path")}
                  <InfoTooltip text="File path to the PEM-encoded private key that corresponds to the SSL certificate." />
                </label>
                <TextInput
                  value={settings.restApi?.sslKeyPath || ""}
                  onChange={(v) => mgr.updateRestApi({ sslKeyPath: v })}
                  variant="settings"
                  className="w-full"
                  placeholder="/path/to/private-key.pem"
                />
              </div>
            </>
          )}

          {/* Self-Signed Info */}
          {settings.restApi?.sslMode === "self-signed" && (
            <div className="flex items-start gap-2 p-2 bg-primary/10 border border-primary/30 rounded text-primary text-xs">
              <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{mgr.t("settings.api.selfSignedInfo", "A self-signed certificate will be automatically generated. Browsers will show a security warning.")}</span>
            </div>
          )}

          {/* Let's Encrypt Configuration */}
          {settings.restApi?.sslMode === "letsencrypt" && (
            <>
              <div className="flex items-start gap-2 p-2 bg-success/10 border border-success/30 rounded text-success text-xs">
                <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{mgr.t("settings.api.letsEncryptInfo", "Let's Encrypt certificates are free, trusted, and auto-renewed. Requires a public domain pointing to this server.")}</span>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <Globe className="w-4 h-4" />
                  {mgr.t("settings.api.sslDomain", "Domain Name")}
                  <InfoTooltip text="Public domain name that points to this server. Required for Let's Encrypt certificate issuance." />
                </label>
                <TextInput
                  value={settings.restApi?.sslDomain || ""}
                  onChange={(v) => mgr.updateRestApi({ sslDomain: v })}
                  variant="settings"
                  className="w-full"
                  placeholder="api.example.com"
                />
                <p className="text-xs text-[var(--color-textMuted)]">
                  {mgr.t("settings.api.sslDomainDescription", "Must be a valid domain pointing to this server")}
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <Key className="w-4 h-4" />
                  {mgr.t("settings.api.sslEmail", "Email for Certificate Notices")}
                  <InfoTooltip text="Email address where Let's Encrypt sends certificate expiration and renewal notices." />
                </label>
                <input
                  type="email"
                  value={settings.restApi?.sslEmail || ""}
                  onChange={(e) => mgr.updateRestApi({ sslEmail: e.target.value })}
                  className="sor-settings-input w-full"
                  placeholder="admin@example.com"
                />
                <p className="text-xs text-[var(--color-textMuted)]">
                  {mgr.t("settings.api.sslEmailDescription", "Let's Encrypt will send renewal reminders to this email")}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SslSection;
