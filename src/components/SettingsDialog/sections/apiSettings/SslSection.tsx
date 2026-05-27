import React from "react";
import { FileKey, Shield, Key, Globe, Zap, Mail } from "lucide-react";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsTextRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

export const SslSection: React.FC<{ settings: GlobalSettings; mgr: Mgr }> = ({
  settings,
  mgr,
}) => {
  const sslOn = settings.restApi?.sslEnabled ?? false;
  const sslMode = settings.restApi?.sslMode || "manual";

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<FileKey className="w-4 h-4 text-primary" />}
        title={mgr.t("settings.api.ssl", "SSL/TLS")}
      />

      <Card>
        <Toggle
          settingKey="restApi.sslEnabled"
          icon={<Shield size={16} />}
          label={mgr.t("settings.api.enableSsl", "Enable HTTPS")}
          description={mgr.t(
            "settings.api.enableSslDescription",
            "Use SSL/TLS encryption for API connections",
          )}
          checked={sslOn}
          onChange={(v) => mgr.updateRestApi({ sslEnabled: v })}
          infoTooltip="Encrypt all API traffic with SSL/TLS. Required for secure communication, especially over public networks."
        />

        <div
          className={`flex flex-col gap-2.5 pt-3 border-t border-[var(--color-border)] ${
            !sslOn ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <SettingsSelectRow
            settingKey="restApi.sslMode"
            icon={<Shield size={16} />}
            label={mgr.t("settings.api.sslMode", "Certificate Mode")}
            value={sslMode}
            options={[
              {
                value: "manual",
                label: mgr.t(
                  "settings.api.sslManual",
                  "Manual (Provide Certificate)",
                ),
              },
              {
                value: "self-signed",
                label: mgr.t(
                  "settings.api.sslSelfSigned",
                  "Auto-Generate Self-Signed",
                ),
              },
              {
                value: "letsencrypt",
                label: mgr.t(
                  "settings.api.sslLetsEncrypt",
                  "Let's Encrypt (Auto-Renew)",
                ),
              },
            ]}
            onChange={(v) =>
              mgr.updateRestApi({
                sslMode: v as "manual" | "self-signed" | "letsencrypt",
              })
            }
            infoTooltip="How the SSL certificate is obtained: provide your own, auto-generate a self-signed one, or use Let's Encrypt."
          />

          {/* Manual Certificate Paths */}
          {sslMode === "manual" && (
            <>
              <SettingsTextRow
                settingKey="restApi.sslCertPath"
                icon={<FileKey size={16} />}
                label={mgr.t("settings.api.certPath", "Certificate Path")}
                value={settings.restApi?.sslCertPath || ""}
                onChange={(v) => mgr.updateRestApi({ sslCertPath: v })}
                placeholder="/path/to/certificate.pem"
                infoTooltip="File path to the PEM-encoded SSL certificate used by the API server."
              />
              <SettingsTextRow
                settingKey="restApi.sslKeyPath"
                icon={<Key size={16} />}
                label={mgr.t("settings.api.keyPath", "Private Key Path")}
                value={settings.restApi?.sslKeyPath || ""}
                onChange={(v) => mgr.updateRestApi({ sslKeyPath: v })}
                placeholder="/path/to/private-key.pem"
                infoTooltip="File path to the PEM-encoded private key that corresponds to the SSL certificate."
              />
            </>
          )}

          {/* Self-Signed Info */}
          {sslMode === "self-signed" && (
            <div className="flex items-start gap-2 p-2 bg-primary/10 border border-primary/30 rounded text-primary text-xs">
              <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {mgr.t(
                  "settings.api.selfSignedInfo",
                  "A self-signed certificate will be automatically generated. Browsers will show a security warning.",
                )}
              </span>
            </div>
          )}

          {/* Let's Encrypt Configuration */}
          {sslMode === "letsencrypt" && (
            <>
              <div className="flex items-start gap-2 p-2 bg-success/10 border border-success/30 rounded text-success text-xs">
                <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  {mgr.t(
                    "settings.api.letsEncryptInfo",
                    "Let's Encrypt certificates are free, trusted, and auto-renewed. Requires a public domain pointing to this server.",
                  )}
                </span>
              </div>

              <SettingsTextRow
                settingKey="restApi.sslDomain"
                icon={<Globe size={16} />}
                label={mgr.t("settings.api.sslDomain", "Domain Name")}
                description={mgr.t(
                  "settings.api.sslDomainDescription",
                  "Must be a valid domain pointing to this server",
                )}
                value={settings.restApi?.sslDomain || ""}
                onChange={(v) => mgr.updateRestApi({ sslDomain: v })}
                placeholder="api.example.com"
                infoTooltip="Public domain name that points to this server. Required for Let's Encrypt certificate issuance."
              />
              <SettingsTextRow
                settingKey="restApi.sslEmail"
                icon={<Mail size={16} />}
                label={mgr.t(
                  "settings.api.sslEmail",
                  "Email for Certificate Notices",
                )}
                description={mgr.t(
                  "settings.api.sslEmailDescription",
                  "Let's Encrypt will send renewal reminders to this email",
                )}
                value={settings.restApi?.sslEmail || ""}
                onChange={(v) => mgr.updateRestApi({ sslEmail: v })}
                placeholder="admin@example.com"
                infoTooltip="Email address where Let's Encrypt sends certificate expiration and renewal notices."
              />
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default SslSection;
