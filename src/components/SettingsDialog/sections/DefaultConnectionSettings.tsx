import React from "react";
import { useTranslation } from "react-i18next";
import { Globe, ShieldCheck } from "lucide-react";
import type { GlobalSettings } from "../../../types/settings/settings";
import { normalizeDefaultConnectionProtocol } from "../../../utils/connection/defaultConnectionProtocol";
import { SettingsSelectRow } from "../../ui/settings/SettingsPrimitives";

export function DefaultConnectionSettings({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}) {
  const { t } = useTranslation();
  const protocol = normalizeDefaultConnectionProtocol(
    settings.defaultConnectionProtocol,
  );
  const browser = protocol === "http" || protocol === "https";
  return (
    <>
      <SettingsSelectRow
        settingKey="defaultConnectionProtocol"
        icon={<Globe className="w-4 h-4" />}
        label={t(
          "settingsGeneral.defaultConnectionType",
          "Default connection type",
        )}
        description={t(
          "settingsGeneral.defaultConnectionTypeDescription",
          "Used for new connections and Quick Connect. Saved connections, templates, and explicit choices are unchanged.",
        )}
        value={browser ? "browser" : protocol}
        options={[
          { value: "browser", label: t("connection.type.browser", "Browser") },
          { value: "rdp", label: "RDP (Remote Desktop)" },
          { value: "ssh", label: "SSH (Secure Shell)" },
          { value: "vnc", label: "VNC" },
          { value: "telnet", label: "Telnet" },
        ]}
        onChange={(value) =>
          updateSettings({
            defaultConnectionProtocol: normalizeDefaultConnectionProtocol(
              value === "browser" ? (browser ? protocol : "https") : value,
            ),
          })
        }
      />
      {browser && (
        <SettingsSelectRow
          icon={<ShieldCheck className="w-4 h-4" />}
          label={t(
            "settingsGeneral.defaultBrowserProtocol",
            "Default browser protocol",
          )}
          description={t(
            "settingsGeneral.defaultBrowserProtocolDescription",
            "HTTPS encrypts the connection. Use HTTP only for websites that require an unencrypted connection.",
          )}
          value={protocol}
          options={[
            {
              value: "https",
              label: "HTTPS",
            },
            {
              value: "http",
              label: "HTTP",
            },
          ]}
          onChange={(value) =>
            updateSettings({
              defaultConnectionProtocol:
                normalizeDefaultConnectionProtocol(value),
            })
          }
        />
      )}
    </>
  );
}
