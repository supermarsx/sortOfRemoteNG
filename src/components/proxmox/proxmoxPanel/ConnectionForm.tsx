import React from "react";
import { useTranslation } from "react-i18next";
import {
  LogIn,
  Key,
  ShieldOff,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { SubProps } from "./types";

const ConnectionForm: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const connecting = mgr.connectionState === "connecting";

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8">
      <div className="w-full max-w-md space-y-5">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-warning/20 mb-4">
            <LogIn className="w-8 h-8 text-warning" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--color-text)]">
            {t("proxmox.connectTitle", "Connect to Proxmox VE")}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {t("proxmox.connectSubtitle", "Enter your server credentials to get started")}
          </p>
        </div>

        {/* Error banner */}
        {mgr.connectionError && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{mgr.connectionError}</span>
          </div>
        )}

        {/* Host + Port */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t("proxmox.host", "Host")}
            </label>
            <input
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-warning/50"
              placeholder="192.168.1.100"
              value={mgr.host}
              onChange={(e) => mgr.setHost(e.target.value)}
              disabled={connecting}
            />
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t("proxmox.port", "Port")}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-warning/50"
              value={mgr.port}
              onChange={(e) => mgr.setPort(parseInt(e.target.value, 10) || 8006)}
              disabled={connecting}
            />
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            {t("proxmox.username", "Username")}
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-warning/50"
            placeholder="root@pam"
            value={mgr.username}
            onChange={(e) => mgr.setUsername(e.target.value)}
            disabled={connecting}
          />
        </div>

        {/* Auth method toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => mgr.setUseApiToken(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              !mgr.useApiToken
                ? "bg-warning/20 text-warning border border-warning/30"
                : "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
            }`}
            disabled={connecting}
          >
            <Key className="w-3 h-3 inline mr-1" />
            {t("proxmox.password", "Password")}
          </button>
          <button
            onClick={() => mgr.setUseApiToken(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mgr.useApiToken
                ? "bg-warning/20 text-warning border border-warning/30"
                : "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
            }`}
            disabled={connecting}
          >
            <ShieldOff className="w-3 h-3 inline mr-1" />
            {t("proxmox.apiToken", "API Token")}
          </button>
        </div>

        {/* Password or Token fields */}
        {!mgr.useApiToken ? (
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t("proxmox.password", "Password")}
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-warning/50"
              value={mgr.password}
              onChange={(e) => mgr.setPassword(e.target.value)}
              disabled={connecting}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                {t("proxmox.tokenIdLabel", "Token ID")}
              </label>
              <input
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-warning/50"
                placeholder="user@pam!tokenname"
                value={mgr.tokenId}
                onChange={(e) => mgr.setTokenId(e.target.value)}
                disabled={connecting}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                {t("proxmox.tokenSecretLabel", "Token Secret")}
              </label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-warning/50"
                value={mgr.tokenSecret}
                onChange={(e) => mgr.setTokenSecret(e.target.value)}
                disabled={connecting}
              />
            </div>
          </div>
        )}

        {/* Insecure toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={mgr.insecure}
            onChange={(e) => mgr.setInsecure(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--color-border)] text-warning focus:ring-warning"
            disabled={connecting}
          />
          <span className="text-xs text-[var(--color-text-secondary)]">
            {t("proxmox.insecure", "Accept self-signed certificates")}
          </span>
        </label>

        {/* Connect button */}
        <button
          onClick={mgr.connect}
          disabled={connecting || !mgr.host || !mgr.username}
          className="w-full py-2.5 rounded-lg bg-warning hover:bg-warning/90 disabled:bg-warning/50 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2"
        >
          {connecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("proxmox.connecting", "Connecting...")}
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              {t("proxmox.connect", "Connect")}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ConnectionForm;
