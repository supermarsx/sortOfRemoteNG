import React from "react";
import { useTranslation } from "react-i18next";
import {
  LogIn,
  Key,
  ShieldOff,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Fingerprint,
  KeyRound,
} from "lucide-react";
import { useInsecureTlsAck } from "../../../hooks/security/useInsecureTlsAck";
import { InsecureTlsWarningModal } from "../../security/InsecureTlsWarningModal";
import type { ProxmoxTfaKind } from "../../../types/hardware/proxmox";
import { splitRealm } from "../../../hooks/proxmox/useProxmoxManager";
import type { SubProps } from "./types";

const inputClass =
  "w-full px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)] border border-[var(--color-border)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
const labelClass =
  "block text-xs font-medium text-[var(--color-textSecondary)] mb-1";

/** Realm presets; anything else is typed as free text. */
const REALM_PRESETS = ["pam", "pve"] as const;

const ConnectionForm: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const connecting = mgr.connectionState === "connecting";
  const [tlsPromptOpen, setTlsPromptOpen] = React.useState(false);
  const [tfaCode, setTfaCode] = React.useState("");
  const [tfaKind, setTfaKind] = React.useState<ProxmoxTfaKind>("totp");
  const compactFingerprint = mgr.fingerprint
    .trim()
    .replace(/^sha256:/i, "")
    .replace(/[:\s]/g, "");
  const fingerprintReady = /^[0-9a-f]{64}$/i.test(compactFingerprint);
  const credentialsReady = mgr.useApiToken
    ? Boolean(mgr.tokenId.trim() && mgr.tokenSecret)
    : Boolean(mgr.username.trim() && mgr.password);
  const portReady =
    Number.isInteger(mgr.port) && mgr.port > 0 && mgr.port <= 65535;
  const hostReady = Boolean(mgr.host.trim());
  const canConnect =
    hostReady &&
    portReady &&
    credentialsReady &&
    (!mgr.insecure || fingerprintReady);
  const tlsAck = useInsecureTlsAck({
    configId: `proxmox:${mgr.host.trim().toLowerCase()}:${mgr.port}:${compactFingerprint.toLowerCase()}`,
    insecure: mgr.insecure,
  });
  const explicitRealm = splitRealm(mgr.username.trim()).realm;
  const [realmChoice, setRealmChoice] = React.useState<string>(() =>
    REALM_PRESETS.includes(mgr.realm as (typeof REALM_PRESETS)[number])
      ? mgr.realm
      : mgr.realm
        ? "custom"
        : "",
  );

  const connectOnce = (acknowledgeInvalidCertRisk: boolean) => {
    void mgr.connect(acknowledgeInvalidCertRisk).finally(tlsAck.reset);
  };

  const handleConnect = () => {
    // A certificate accepted through the probe dialog in this session already
    // carries the informed consent — skip the generic warning modal.
    if (tlsAck.needsAck && !mgr.certAccepted) {
      setTlsPromptOpen(true);
      return;
    }
    connectOnce(mgr.certAccepted);
  };

  const acknowledgeTlsAndConnect = () => {
    tlsAck.acknowledge();
    setTlsPromptOpen(false);
    connectOnce(true);
  };

  const submitTfa = () => {
    void mgr.submitTfa(tfaCode, tfaKind).then(() => setTfaCode(""));
  };

  const tfaKinds: ProxmoxTfaKind[] = (
    ["totp", "recovery", "yubico"] as const
  ).filter(
    (kind) =>
      !mgr.tfaChallenge?.tfaTypes.length ||
      mgr.tfaChallenge.tfaTypes.includes(kind),
  );

  // ── TFA second step ───────────────────────────────────────────
  if (mgr.connectionState === "tfa" && mgr.tfaChallenge) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-8">
        <div
          className="w-full max-w-md space-y-5"
          data-testid="proxmox-tfa-form"
        >
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-warning/20 mb-4">
              <KeyRound className="w-8 h-8 text-warning" />
            </div>
            <h2 className="text-xl font-semibold text-[var(--color-text)]">
              {t("proxmox.tfaTitle", "Second factor required")}
            </h2>
            <p className="text-sm text-[var(--color-textSecondary)] mt-1">
              {t(
                "proxmox.tfaSubtitle",
                "{{user}} is protected by two-factor authentication. Enter a code to finish signing in.",
                { user: mgr.tfaChallenge.username },
              )}
            </p>
          </div>

          {mgr.connectionError && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{mgr.connectionError}</span>
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass} htmlFor="proxmox-tfa-code">
                {t("proxmox.tfaCode", "Code")}
              </label>
              <input
                id="proxmox-tfa-code"
                data-testid="proxmox-tfa-code"
                className={`${inputClass} font-mono`}
                value={tfaCode}
                onChange={(e) => setTfaCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tfaCode.trim()) submitTfa();
                }}
                autoFocus
                autoComplete="one-time-code"
                inputMode={tfaKind === "totp" ? "numeric" : "text"}
                disabled={mgr.tfaSubmitting}
                maxLength={128}
              />
            </div>
            <div className="w-32">
              <label className={labelClass} htmlFor="proxmox-tfa-kind">
                {t("proxmox.tfaKind", "Type")}
              </label>
              <select
                id="proxmox-tfa-kind"
                data-testid="proxmox-tfa-kind"
                className={inputClass}
                value={tfaKind}
                onChange={(e) => setTfaKind(e.target.value as ProxmoxTfaKind)}
                disabled={mgr.tfaSubmitting}
              >
                {tfaKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "totp"
                      ? t("proxmox.tfaKindTotp", "TOTP")
                      : kind === "recovery"
                        ? t("proxmox.tfaKindRecovery", "Recovery key")
                        : t("proxmox.tfaKindYubico", "Yubico OTP")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={submitTfa}
            disabled={mgr.tfaSubmitting || !tfaCode.trim()}
            data-testid="proxmox-tfa-submit"
            className="w-full py-2.5 rounded-lg bg-warning hover:bg-warning/90 disabled:bg-warning/50 text-[var(--color-text)] font-medium text-sm transition-colors flex items-center justify-center gap-2"
          >
            {mgr.tfaSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            {t("proxmox.tfaSubmit", "Verify")}
          </button>
          <button
            type="button"
            onClick={mgr.cancelTfa}
            disabled={mgr.tfaSubmitting}
            data-testid="proxmox-tfa-cancel"
            className="w-full py-2 rounded-lg text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            {t("common.cancel", "Cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center flex-1 p-8 overflow-y-auto">
        <div
          className="w-full max-w-md space-y-5"
          data-testid="proxmox-connection-form"
        >
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

          {/* Singleton guard */}
          {mgr.busyElsewhere && (
            <div
              className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm text-[var(--color-text)]"
              data-testid="proxmox-busy-elsewhere"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
              <div className="flex-1">
                {t(
                  "proxmox.busyElsewhere",
                  "Already connected to {{host}} in another tab — disconnect there first, or take over the connection here.",
                  {
                    host: `${mgr.busyElsewhere.host}:${mgr.busyElsewhere.port}`,
                  },
                )}
              </div>
              <button
                type="button"
                onClick={() => void mgr.takeOver()}
                disabled={connecting}
                data-testid="proxmox-takeover-btn"
                className="shrink-0 rounded-md border border-warning/40 bg-warning/20 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/30"
              >
                {t("proxmox.takeOver", "Take over")}
              </button>
            </div>
          )}

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
              <label className={labelClass}>{t("proxmox.host", "Host")}</label>
              <input
                className={inputClass}
                placeholder="192.168.1.100"
                value={mgr.host}
                onChange={(e) => mgr.setHost(e.target.value)}
                disabled={connecting}
                maxLength={253}
                data-testid="proxmox-host"
              />
            </div>
            <div className="w-24">
              <label className={labelClass}>{t("proxmox.port", "Port")}</label>
              <input
                type="number"
                className={inputClass}
                value={mgr.port}
                onChange={(e) =>
                  mgr.setPort(parseInt(e.target.value, 10) || 8006)
                }
                disabled={connecting}
                min={1}
                max={65535}
                data-testid="proxmox-port"
              />
            </div>
          </div>

          {/* Auth method toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => mgr.setUseApiToken(false)}
              data-testid="proxmox-auth-mode-password"
              aria-pressed={!mgr.useApiToken}
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
              type="button"
              onClick={() => mgr.setUseApiToken(true)}
              data-testid="proxmox-auth-mode-apitoken"
              aria-pressed={mgr.useApiToken}
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
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelClass}>
                    {t("proxmox.username", "Username")}
                  </label>
                  <input
                    className={inputClass}
                    placeholder="root@pam"
                    value={mgr.username}
                    onChange={(e) => mgr.setUsername(e.target.value)}
                    disabled={connecting}
                    maxLength={256}
                    data-testid="proxmox-username"
                  />
                </div>
                <div className="w-32">
                  <label className={labelClass} htmlFor="proxmox-realm">
                    {t("proxmox.realm", "Realm")}
                  </label>
                  <select
                    id="proxmox-realm"
                    data-testid="proxmox-realm"
                    className={inputClass}
                    value={realmChoice}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRealmChoice(v);
                      mgr.setRealm(v === "custom" ? "" : v);
                    }}
                    disabled={connecting || Boolean(explicitRealm)}
                    title={
                      explicitRealm
                        ? t(
                            "proxmox.realmFromUsername",
                            "Realm taken from the username ({{realm}})",
                            { realm: explicitRealm },
                          )
                        : undefined
                    }
                  >
                    <option value="">
                      {explicitRealm
                        ? explicitRealm
                        : t("proxmox.realmDefault", "pam (default)")}
                    </option>
                    {REALM_PRESETS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="custom">
                      {t("proxmox.realmCustom", "Other…")}
                    </option>
                  </select>
                </div>
              </div>
              {realmChoice === "custom" && (
                <input
                  className={inputClass}
                  placeholder={t("proxmox.realmCustomPlaceholder", "ldap")}
                  value={mgr.realm}
                  onChange={(e) => mgr.setRealm(e.target.value)}
                  disabled={connecting}
                  maxLength={64}
                  data-testid="proxmox-realm-custom"
                />
              )}
              <div>
                <label className={labelClass}>
                  {t("proxmox.password", "Password")}
                </label>
                <input
                  type="password"
                  className={inputClass}
                  value={mgr.password}
                  onChange={(e) => mgr.setPassword(e.target.value)}
                  disabled={connecting}
                  maxLength={4096}
                  data-testid="proxmox-password"
                />
              </div>
              <div>
                <label className={labelClass}>
                  {t("proxmox.totpSecret", "TOTP secret (optional)")}
                </label>
                <input
                  type="password"
                  className={`${inputClass} font-mono`}
                  value={mgr.totpSecret}
                  onChange={(e) => mgr.setTotpSecret(e.target.value)}
                  disabled={connecting}
                  maxLength={256}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="proxmox-totp-secret"
                />
                <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
                  {t(
                    "proxmox.totpSecretHelp",
                    "Base32 secret of your authenticator entry — completes the two-factor step automatically.",
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>
                  {t("proxmox.tokenIdLabel", "Token ID")}
                </label>
                <input
                  className={inputClass}
                  placeholder="user@pam!tokenname"
                  value={mgr.tokenId}
                  onChange={(e) => mgr.setTokenId(e.target.value)}
                  disabled={connecting}
                  maxLength={512}
                  data-testid="proxmox-token-id"
                />
              </div>
              <div>
                <label className={labelClass}>
                  {t("proxmox.tokenSecretLabel", "Token Secret")}
                </label>
                <input
                  type="password"
                  className={inputClass}
                  value={mgr.tokenSecret}
                  onChange={(e) => mgr.setTokenSecret(e.target.value)}
                  disabled={connecting}
                  maxLength={4096}
                  data-testid="proxmox-token-secret"
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
              data-testid="proxmox-tls-skip"
            />
            <span className="text-xs text-[var(--color-textSecondary)]">
              {t("proxmox.insecure", "Accept self-signed certificates")}
            </span>
          </label>

          <div>
            <label className={labelClass}>
              {t("proxmox.fingerprint", "Certificate SHA-256 fingerprint")}
            </label>
            <div className="flex gap-2">
              <input
                className={`${inputClass} font-mono`}
                placeholder="SHA256:AA:BB:..."
                value={mgr.fingerprint}
                onChange={(e) => mgr.setFingerprint(e.target.value)}
                disabled={connecting || !mgr.insecure}
                aria-required={mgr.insecure}
                maxLength={256}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="proxmox-fingerprint"
              />
              <button
                type="button"
                onClick={() => void mgr.probeCertificate()}
                disabled={
                  connecting || mgr.certProbing || !hostReady || !portReady
                }
                data-testid="proxmox-probe-cert-btn"
                title={t(
                  "proxmox.probeCertHint",
                  "Fetch the server certificate without sending credentials",
                )}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-3 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-50"
              >
                {mgr.certProbing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Fingerprint className="w-3.5 h-3.5" />
                )}
                {t("proxmox.probeCert", "Fetch fingerprint")}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
              {t(
                "proxmox.fingerprintHelp",
                "Required when accepting a self-signed certificate. Verify it through a separate trusted channel.",
              )}
            </p>
            {mgr.certProbeError && (
              <p
                className="mt-1 text-[11px] text-error"
                data-testid="proxmox-probe-cert-error"
              >
                {mgr.certProbeError}
              </p>
            )}
          </div>

          {/* TOFU: probed certificate */}
          {mgr.certProbe && (
            <div
              className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs space-y-1"
              data-testid="proxmox-cert-probe"
            >
              <div className="font-medium text-[var(--color-text)]">
                {mgr.certProbe.selfSigned
                  ? t("proxmox.certProbeSelfSigned", "Self-signed certificate")
                  : t("proxmox.certProbeTitle", "Server certificate")}
              </div>
              <div className="font-mono break-all text-[var(--color-text)]">
                {mgr.certProbe.sha256}
              </div>
              <div className="text-[var(--color-textSecondary)]">
                {t("proxmox.certSubject", "Subject")}: {mgr.certProbe.subject}
              </div>
              <div className="text-[var(--color-textSecondary)]">
                {t("proxmox.certIssuer", "Issuer")}: {mgr.certProbe.issuer}
              </div>
              <div className="text-[var(--color-textSecondary)]">
                {t("proxmox.certExpires", "Expires")}: {mgr.certProbe.notAfter}
              </div>
              <p className="text-[var(--color-textMuted)]">
                {t(
                  "proxmox.certProbeWarning",
                  "Accepting pins this fingerprint for the connection. Only accept it if it matches the one shown on the server.",
                )}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={mgr.acceptCertProbe}
                  data-testid="proxmox-cert-accept-btn"
                  className="rounded-md border border-warning/40 bg-warning/20 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/30"
                >
                  {t("proxmox.certAccept", "Accept and pin")}
                </button>
                <button
                  type="button"
                  onClick={mgr.dismissCertProbe}
                  data-testid="proxmox-cert-dismiss-btn"
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)]"
                >
                  {t("common.cancel", "Cancel")}
                </button>
              </div>
            </div>
          )}

          {/* Connect button */}
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting || !canConnect}
            data-testid="proxmox-connect-btn"
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
