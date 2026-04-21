import React from "react";
import {
  Shield,
  Key,
  Globe,
  Server,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "../../ui/forms";
import type { Mgr } from "./types";

const ConfigTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const c = mgr.config;

  if (!c) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const update = (patch: Partial<typeof c>) => mgr.updateConfig({ ...c, ...patch });

  return (
    <div className="sor-gpg-config space-y-4 text-sm">
      {/* Paths */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Server className="w-4 h-4" />
          {t("gpgAgent.config.paths", "Paths")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "home_dir", label: t("gpgAgent.config.homeDir", "Home directory") },
            { key: "gpg_binary", label: t("gpgAgent.config.gpgBinary", "GPG binary") },
            { key: "gpg_agent_binary", label: t("gpgAgent.config.agentBinary", "Agent binary") },
            { key: "scdaemon_binary", label: t("gpgAgent.config.scdaemonBin", "Scdaemon binary") },
          ].map((field) => (
            <div key={field.key}>
              <label className="text-xs text-muted-foreground block mb-1">{field.label}</label>
              <input
                type="text"
                value={(c as any)[field.key] ?? ""}
                onChange={(e) => update({ [field.key]: e.target.value })}
                className="sor-form-input-xs w-full font-mono"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Security */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Shield className="w-4 h-4" />
          {t("gpgAgent.config.security", "Security")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.pinentryMode", "Pinentry mode")}
            </label>
            <Select
              value={c.pinentry_mode ?? "Default"}
              onChange={(v) => update({ pinentry_mode: v as any })}
              variant="form-sm"
              className="w-full"
              options={[
                { value: 'Default', label: 'Default' },
                { value: 'Ask', label: 'Ask' },
                { value: 'Cancel', label: 'Cancel' },
                { value: 'Error', label: 'Error' },
                { value: 'Loopback', label: 'Loopback' },
              ]}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.defaultCacheTtl", "Default cache TTL (s)")}
            </label>
            <input
              type="number"
              value={c.default_cache_ttl ?? 600}
              onChange={(e) => update({ default_cache_ttl: parseInt(e.target.value) || 0 })}
              className="sor-form-input-xs w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.maxCacheTtl", "Max cache TTL (s)")}
            </label>
            <input
              type="number"
              value={c.max_cache_ttl ?? 7200}
              onChange={(e) => update({ max_cache_ttl: parseInt(e.target.value) || 0 })}
              className="sor-form-input-xs w-full"
            />
          </div>
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              checked={c.allow_loopback_pinentry ?? false}
              onChange={(e) => update({ allow_loopback_pinentry: e.target.checked })}
              className="rounded"
            />
            {t("gpgAgent.config.allowLoopback", "Allow loopback pinentry")}
          </label>
        </div>
      </div>

      {/* SSH */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Key className="w-4 h-4" />
          {t("gpgAgent.config.ssh", "SSH Support")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.enable_ssh_support ?? false}
              onChange={(e) => update({ enable_ssh_support: e.target.checked })}
              className="rounded"
            />
            {t("gpgAgent.config.enableSsh", "Enable SSH support")}
          </label>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.extraSocket", "Extra socket path")}
            </label>
            <input
              type="text"
              value={c.extra_socket ?? ""}
              onChange={(e) => update({ extra_socket: e.target.value })}
              className="sor-form-input-xs w-full font-mono"
            />
          </div>
        </div>
      </div>

      {/* Keys & Keyserver */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Globe className="w-4 h-4" />
          {t("gpgAgent.config.keysAndServer", "Keys & Keyserver")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.defaultKey", "Default key")}
            </label>
            <input
              type="text"
              value={c.default_key ?? ""}
              onChange={(e) => update({ default_key: e.target.value })}
              className="sor-form-input-xs w-full font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.autoKeyLocate", "Auto key locate")}
            </label>
            <input
              type="text"
              value={(c.auto_key_locate ?? []).join(", ")}
              onChange={(e) => update({ auto_key_locate: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className="sor-form-input-xs w-full font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.keyserver", "Keyserver URL")}
            </label>
            <input
              type="text"
              value={c.keyserver ?? ""}
              onChange={(e) => update({ keyserver: e.target.value })}
              placeholder="hkps://keys.openpgp.org"
              className="sor-form-input-xs w-full font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.keyserverOptions", "Keyserver options")}
            </label>
            <input
              type="text"
              value={(c.keyserver_options ?? []).join(", ")}
              onChange={(e) => update({ keyserver_options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className="sor-form-input-xs w-full font-mono"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigTab;
