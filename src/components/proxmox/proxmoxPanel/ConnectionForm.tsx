import React from "react";
import { useTranslation } from "react-i18next";
import { LogIn, Key, ShieldOff, Loader2, AlertCircle } from "lucide-react";
import { useInsecureTlsAck } from "../../../hooks/security/useInsecureTlsAck";
import { InsecureTlsWarningModal } from "../../security/InsecureTlsWarningModal";
import type { SubProps } from "./types";

const ConnectionForm: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const connecting = mgr.connectionState === "connecting";
  const [tlsPromptOpen, setTlsPromptOpen] = React.useState(false);
  const compactFingerprint = mgr.fingerprint
    .trim()
    .replace(/^sha256:/i, "")
    .replace(/[:\s]/g, "");
  const fingerprintReady = /^[0-9a-f]{64}$/i.test(compactFingerprint);
  const credentialsReady = mgr.useApiToken
    ? Boolean(mgr.tokenId.trim() && mgr.tokenSecret)
    : Boolean(mgr.username.trim() && mgr.password);
  const portReady = Number.isInteger(mgr.port) && mgr.port > 0 && mgr.port <= 65535;
  const canConnect =
    Boolean(mgr.host.trim()) &&
    portReady &&
    credentialsReady &&
    (!mgr.insecure || fingerprintReady);
  const tlsAck = useInsecureTlsAck({
    configId: `proxmox:${mgr.host.trim().toLowerCase()}:${mgr.port}:${compactFingerprint.toLowerCase()}`,
    insecure: mgr.insecure,
  });

  const connectOnce = (acknowledgeInvalidCertRisk: boolean) => {
    void mgr.connect(acknowledgeInvalidCertRisk).finally(tlsAck.reset);
  };

  const handleConnect = () => {
    if (tlsAck.needsAck) {
      setTlsPromptOpen(true);
      return;
    }
    connectOnce(false);
  };

  const acknowledgeTlsAndConnect = () => {
    tlsAck.acknowledge();
    setTlsPromptOpen(false);
    connectOnce(true);
  };

  return (
    <>
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
          <p className="text-sm text-[var(--color-textSecondary)] mt-1">
            {t(
              "proxmox.connectSubtitle",
              "Enter your server credentials to get started",
            )}
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
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
              {t("proxmox.host", "Host")}
            </label>
            <input
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="192.168.1.100"
              value={mgr.host}
              onChange={(e) => mgr.setHost(e.target.value)}
              disabled={connecting}
              maxLength={253}
            />
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
              {t("proxmox.port", "Port")}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={mgr.port}
              onChange={(e) =>
                mgr.setPort(parseInt(e.target.value, 10) || 8006)
              }
              disabled={connecting}
              min={1}
              max={65535}
            />
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            {t("proxmox.username", "Username")}
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="root@pam"
            value={mgr.username}
            onChange={(e) => mgr.setUsername(e.target.value)}
            disabled={connecting}
            maxLength={256}
          />
        </div>

        {/* Auth method toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => mgr.setUseApiToken(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              !mgr.useApiToken
                ? "bg-warning/20 text-warning border border-warning/30"
                : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] border border-[var(--color-border)]"
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
                : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] border border-[var(--color-border)]"
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
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
              {t("proxmox.password", "Password")}
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              value={mgr.password}
              onChange={(e) => mgr.setPassword(e.target.value)}
              disabled={connecting}
              maxLength={4096}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                {t("proxmox.tokenIdLabel", "Token ID")}
              </label>
              <input
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="user@pam!tokenname"
                value={mgr.tokenId}
                onChange={(e) => mgr.setTokenId(e.target.value)}
                disabled={connecting}
                maxLength={512}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                {t("proxmox.tokenSecretLabel", "Token Secret")}
              </label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={mgr.tokenSecret}
                onChange={(e) => mgr.setTokenSecret(e.target.value)}
                disabled={connecting}
                maxLength={4096}
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
            className="w-4 h-4 rounded border-[var(--color-border)] text-warning focus:ring-primary"
            disabled={connecting}
          />
          <span className="text-xs text-[var(--color-textSecondary)]">
            {t("proxmox.insecure", "Accept self-signed certificates")}
          </span>
        </label>

        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            {t("proxmox.fingerprint", "Certificate SHA-256 fingerprint")}
          </label>
          <input
            className="w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="SHA256:AA:BB:..."
            value={mgr.fingerprint}
            onChange={(e) => mgr.setFingerprint(e.target.value)}
            disabled={connecting || !mgr.insecure}
            aria-required={mgr.insecure}
            maxLength={256}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
            {t(
              "proxmox.fingerprintHelp",
              "Required when accepting a self-signed certificate. Verify it through a separate trusted channel.",
            )}
          </p>
        </div>

        {/* Connect button */}
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting || !canConnect}
          className="w-full py-2.5 rounded-lg bg-warning hover:bg-warning/90 disabled:bg-warning/50 text-[var(--color-text)] font-medium text-sm transition-colors flex items-center justify-center gap-2"
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
      <InsecureTlsWarningModal
        isOpen={tlsPromptOpen}
        kind="integration"
        endpoint={`https://${mgr.host.trim()}:${mgr.port}`}
        connectionName="Proxmox VE"
        onAcknowledge={acknowledgeTlsAndConnect}
        onCancel={() => {
          setTlsPromptOpen(false);
          tlsAck.reset();
        }}
      />
    </>
  );
};

export default ConnectionForm;
