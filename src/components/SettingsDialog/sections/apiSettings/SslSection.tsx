import React from "react";
import { FileKey, Shield, Key, Globe, Zap } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";
import { TextInput } from "../../../ui/forms";
import { GlobalSettings } from "../../../../types/settings";
import type { Mgr } from "./types";

export const SslSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({ settings, mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <FileKey className="w-4 h-4 text-purple-400" />
      {mgr.t("settings.api.ssl", "SSL/TLS")}
    </h4>

    <div className="sor-settings-card space-y-4">
      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={settings.restApi?.sslEnabled || false} onChange={(v: boolean) => mgr.updateRestApi({ sslEnabled: v })} />
        <Shield className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-purple-400" />
        <div>
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
            {mgr.t("settings.api.enableSsl", "Enable HTTPS")}
          </span>
          <p className="text-xs text-[var(--color-textMuted)]">
            {mgr.t("settings.api.enableSslDescription", "Use SSL/TLS encryption for API connections")}
          </p>
        </div>
      </label>

      {settings.restApi?.sslEnabled && (
        <div className="space-y-4 pt-2 border-t border-[var(--color-border)]">
          {/* SSL Mode Selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Shield className="w-4 h-4" />
              {mgr.t("settings.api.sslMode", "Certificate Mode")}
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
                </label>
                <TextInput
                  value={settings.restApi?.sslCertPath || ""}
                  onChange={(e) => mgr.updateRestApi({ sslCertPath: e.target.value })}
                  variant="settings"
                  className="w-full"
                  placeholder="/path/to/certificate.pem"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <Key className="w-4 h-4" />
                  {mgr.t("settings.api.keyPath", "Private Key Path")}
                </label>
                <TextInput
                  value={settings.restApi?.sslKeyPath || ""}
                  onChange={(e) => mgr.updateRestApi({ sslKeyPath: e.target.value })}
                  variant="settings"
                  className="w-full"
                  placeholder="/path/to/private-key.pem"
                />
              </div>
            </>
          )}

          {/* Self-Signed Info */}
          {settings.restApi?.sslMode === "self-signed" && (
            <div className="flex items-start gap-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 text-xs">
              <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{mgr.t("settings.api.selfSignedInfo", "A self-signed certificate will be automatically generated. Browsers will show a security warning.")}</span>
            </div>
          )}

          {/* Let's Encrypt Configuration */}
          {settings.restApi?.sslMode === "letsencrypt" && (
            <>
              <div className="flex items-start gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-xs">
                <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{mgr.t("settings.api.letsEncryptInfo", "Let's Encrypt certificates are free, trusted, and auto-renewed. Requires a public domain pointing to this server.")}</span>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                  <Globe className="w-4 h-4" />
                  {mgr.t("settings.api.sslDomain", "Domain Name")}
                </label>
                <TextInput
                  value={settings.restApi?.sslDomain || ""}
                  onChange={(e) => mgr.updateRestApi({ sslDomain: e.target.value })}
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
      )}
    </div>
  </div>
);

export default SslSection;
