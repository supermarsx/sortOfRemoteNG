import React from "react";
import { useTranslation } from "react-i18next";
import {
  LogIn,
  Key,
  ShieldOff,
  Loader2,
  AlertCircle,
  Lock,
} from "lucide-react";
import type { SubProps } from "./types";

const ConnectionForm: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const connecting = mgr.connectionStatus === "connecting";

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8">
      <div className="w-full max-w-md space-y-5">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-500/20 mb-4">
            <LogIn className="w-8 h-8 text-teal-500" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--color-text)]">
            {t("synology.connectTitle", "Connect to Synology NAS")}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {t(
              "synology.connectSubtitle",
              "Enter your DSM credentials to get started",
            )}
          </p>
        </div>

        {/* Error banner */}
        {mgr.connectionError && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{mgr.connectionError}</span>
          </div>
        )}

        {/* Host + Port */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t("synology.host", "Host")}
            </label>
            <input
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              placeholder="192.168.1.1"
              value={mgr.host}
              onChange={(e) => mgr.setHost(e.target.value)}
              disabled={connecting}
            />
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {t("synology.port", "Port")}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              value={mgr.port}
              onChange={(e) =>
                mgr.setPort(parseInt(e.target.value, 10) || 5001)
              }
              disabled={connecting}
            />
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            {t("synology.username", "Username")}
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            placeholder="admin"
            value={mgr.username}
            onChange={(e) => mgr.setUsername(e.target.value)}
            disabled={connecting}
          />
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            {t("synology.password", "Password")}
          </label>
          <div className="relative">
            <input
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 pr-10"
              placeholder="••••••••"
              value={mgr.password}
              onChange={(e) => mgr.setPassword(e.target.value)}
              disabled={connecting}
            />
            <Key className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" />
          </div>
        </div>

        {/* OTP Code (optional) */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            {t("synology.otpCode", "2FA Code (optional)")}
          </label>
          <div className="relative">
            <input
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50 pr-10"
              placeholder="123456"
              value={mgr.otpCode}
              onChange={(e) => mgr.setOtpCode(e.target.value)}
              disabled={connecting}
            />
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" />
          </div>
        </div>

        {/* Access Token (optional) */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
            {t(
              "synology.accessToken",
              "Personal Access Token (DSM 7.2+, optional)",
            )}
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            placeholder="token..."
            value={mgr.accessToken}
            onChange={(e) => mgr.setAccessToken(e.target.value)}
            disabled={connecting}
          />
        </div>

        {/* HTTPS + Insecure */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={mgr.useHttps}
              onChange={(e) => mgr.setUseHttps(e.target.checked)}
              disabled={connecting}
              className="accent-teal-500"
            />
            HTTPS
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={mgr.insecure}
              onChange={(e) => mgr.setInsecure(e.target.checked)}
              disabled={connecting}
              className="accent-teal-500"
            />
            <ShieldOff className="w-3.5 h-3.5" />
            {t("synology.allowSelfSigned", "Allow self-signed")}
          </label>
        </div>

        {/* Connect button */}
        <button
          onClick={mgr.connect}
          disabled={connecting || !mgr.host || !mgr.username}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
        >
          {connecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("synology.connecting", "Connecting...")}
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              {t("synology.connect", "Connect")}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ConnectionForm;
