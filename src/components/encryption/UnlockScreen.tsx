/**
 * Fully blocking unlock overlay shown at app start when the master
 * encryption key exists on disk but the in-memory state is locked.
 *
 * Mounted by `App.tsx` (Phase 5b). Self-dismisses when
 * `status.unlocked` becomes true — either because the user typed the
 * right password, the vault delivered the key silently, or another
 * window broadcast its unlock event.
 *
 * Locale-aware: the screen renders before encrypted settings have
 * been loaded, so it cannot rely on the i18n catalogue (it lives in
 * settings.enc). It uses native browser locale APIs for date/number
 * formatting and ships its labels in English with a hook for the
 * caller to override per language.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  Timer,
  Unlock,
} from "lucide-react";
import { useEncryption } from "../../hooks/settings/useEncryption";
import type {
  EncryptionStatus,
  UnlockResult,
} from "../../types/encryption/encryption";
import { describeStorage } from "../../types/encryption/encryption";

interface UnlockScreenProps {
  /** Called once the state is unlocked. Optional — the overlay
   *  hides itself based on `shouldShowUnlockScreen(status)` so the
   *  caller doesn't actually need to render-gate anything. Use this
   *  hook when the caller wants to run a side-effect (toast, audit
   *  log, focus restore) on unlock. */
  onUnlocked?: () => void;
  /** Optional label override, e.g. translated strings supplied by the
   *  caller. Falls back to English defaults. */
  labels?: Partial<Labels>;
}

interface Labels {
  title: string;
  vaultUnlocking: string;
  passwordPrompt: string;
  passwordPlaceholder: string;
  unlockButton: string;
  showPassword: string;
  hidePassword: string;
  wrongPassword: string;
  cooldownNotice: string;
  cooldownSeconds: string;
  needsSetup: string;
  vaultUnavailable: string;
  storageLabel: string;
  vaultBackendLabel: string;
}

const DEFAULT_LABELS: Labels = {
  title: "Encrypted storage is locked",
  vaultUnlocking: "Unlocking from your OS vault…",
  passwordPrompt:
    "Enter your master password to decrypt application data on disk.",
  passwordPlaceholder: "Master password",
  unlockButton: "Unlock",
  showPassword: "Show password",
  hidePassword: "Hide password",
  wrongPassword: "Wrong password. Try again.",
  cooldownNotice:
    "Too many failed attempts. Try again in {seconds}.",
  cooldownSeconds: "{seconds}s",
  needsSetup:
    "No master key found. Set up encryption from Settings → Security.",
  vaultUnavailable:
    "Your OS doesn't expose a usable vault and no password wrap was found.",
  storageLabel: "Key storage",
  vaultBackendLabel: "Vault backend",
};

function formatCooldown(template: string, secondsTemplate: string, ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const display = minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : secondsTemplate.replace("{seconds}", seconds.toString());
  return template.replace("{seconds}", display);
}

/** Reason that controls whether the unlock screen renders at all. */
export function shouldShowUnlockScreen(
  status: EncryptionStatus | null,
): boolean {
  if (!status) return false;
  if (status.unlocked) return false;
  // Show only when a master key actually exists somewhere; otherwise
  // the right next step is the setup wizard in Settings → Security,
  // not a password prompt the user can't possibly satisfy.
  return status.vaultHasMasterDek || status.passwordWrapPresent;
}

export const UnlockScreen: React.FC<UnlockScreenProps> = ({
  onUnlocked,
  labels: labelOverrides,
}) => {
  const enc = useEncryption();
  const labels: Labels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...(labelOverrides ?? {}) }),
    [labelOverrides],
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<UnlockResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Portable .dek import — vault-eviction recovery path. Visible only
  // when the password wrap is absent AND the vault is reachable but
  // unreadable (the OS keychain entry was wiped). The user pastes the
  // file path of an exported `.dek` and supplies its export password.
  const [importExpanded, setImportExpanded] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const status = enc.status;
  const lockout = enc.lockout;
  const remainingMs = lockout?.remainingCooldownMs ?? 0;
  const cooldownActive = remainingMs > 0;

  const passwordMode =
    !!status &&
    (status.masterKeyStorage === "password" ||
      status.masterKeyStorage === "vault-and-password" ||
      status.passwordWrapPresent);

  // Attempt silent vault unlock once on mount if no password wrap is
  // on disk (pure vault mode). That's the path that should always
  // succeed and let the unlock screen vanish without any user
  // interaction.
  useEffect(() => {
    if (!status) return;
    if (status.unlocked) {
      onUnlocked?.();
      return;
    }
    if (
      !status.passwordWrapPresent &&
      status.vaultHasMasterDek &&
      status.vaultAvailable
    ) {
      void enc.unlock();
    }
  }, [status, enc, onUnlocked]);

  // Auto-dismiss the instant the state flips to unlocked, regardless of
  // which window or method triggered it.
  useEffect(() => {
    if (status?.unlocked) onUnlocked?.();
  }, [status?.unlocked, onUnlocked]);

  const handleImportDek = async () => {
    if (importBusy || importPath.length === 0 || importPassword.length === 0) return;
    setImportBusy(true);
    setImportError(null);
    try {
      await enc.importPortableDek(importPath, importPassword);
      // On success the encryption state is now unlocked; the parent
      // effect will pick that up on the next status refresh and
      // dismiss the overlay automatically.
      setImportPath("");
      setImportPassword("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting || cooldownActive || password.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await enc.unlock(password);
      setLastResult(result);
      if (result !== "unlocked-from-password" && result !== "unlocked-from-vault") {
        setPassword("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Suppress the overlay entirely when the criteria aren't met. This
  // covers (a) status still loading, (b) status null (non-Tauri),
  // (c) state already unlocked, (d) no master key on disk.
  if (!shouldShowUnlockScreen(status)) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-screen-title"
      data-testid="encryption-unlock-screen"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm"
    >
      <div className="bg-[var(--color-surface)] rounded-xl p-6 max-w-md w-full mx-4 border border-[var(--color-border)] shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-warning/15 text-warning">
            <Lock className="w-5 h-5" />
          </div>
          <h2
            id="unlock-screen-title"
            className="text-base font-semibold text-[var(--color-text)]"
          >
            {labels.title}
          </h2>
        </div>

        <div className="text-xs text-[var(--color-textSecondary)] mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <span>{labels.storageLabel}</span>
          <span className="text-[var(--color-text)]">
            {describeStorage(status?.masterKeyStorage ?? null)}
          </span>
          {status?.vaultAvailable && (
            <>
              <span>{labels.vaultBackendLabel}</span>
              <span className="text-[var(--color-text)] font-mono">
                {status.vaultBackend}
              </span>
            </>
          )}
        </div>

        {passwordMode ? (
          <>
            <p className="text-sm text-[var(--color-textMuted)] mb-3">
              {labels.passwordPrompt}
            </p>

            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 relative">
                <input
                  autoFocus
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSubmit();
                  }}
                  disabled={submitting || cooldownActive}
                  placeholder={labels.passwordPlaceholder}
                  aria-label={labels.passwordPlaceholder}
                  className="w-full px-3 py-2 pr-9 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword ? labels.hidePassword : labels.showPassword
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  submitting || cooldownActive || password.length === 0
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Unlock className="w-4 h-4" />
                )}
                {labels.unlockButton}
              </button>
            </div>

            {cooldownActive && (
              <div className="flex items-start gap-2 p-2 rounded bg-warning/10 border border-warning/30 text-warning text-xs">
                <Timer className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span data-testid="unlock-cooldown">
                  {formatCooldown(
                    labels.cooldownNotice,
                    labels.cooldownSeconds,
                    remainingMs,
                  )}
                </span>
              </div>
            )}

            {!cooldownActive &&
              lastResult === "wrong-password" && (
                <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{labels.wrongPassword}</span>
                </div>
              )}

            {error && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs mt-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </>
        ) : status?.vaultAvailable && status.vaultHasMasterDek ? (
          <div className="flex items-center gap-2 text-sm text-[var(--color-textMuted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{labels.vaultUnlocking}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
            <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              {status?.vaultAvailable
                ? labels.needsSetup
                : labels.vaultUnavailable}
            </span>
          </div>
        )}

        {/* ── Portable .dek import expander ─────────────────────────
              Vault-eviction recovery path. The OS keychain entry can
              vanish (macOS keychain reset, Linux session logout that
              drops libsecret) and would otherwise strand the user.
              Shown whenever a master key exists on disk somewhere
              other than the vault — pure-vault users have nothing to
              import, while password / hybrid users can swap in a
              fresh `.dek` from removable media.
        */}
        {(status?.passwordWrapPresent || !status?.vaultAvailable) && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)]/40">
            <button
              type="button"
              onClick={() => setImportExpanded((v) => !v)}
              className="text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] flex items-center gap-1"
              data-testid="unlock-import-toggle"
            >
              <ShieldCheck className="w-3 h-3" />
              {importExpanded ? "Hide" : "Recover from portable .dek"}
            </button>
            {importExpanded && (
              <div className="mt-2 space-y-2 text-xs">
                <p className="text-[var(--color-textMuted)]">
                  If your OS keychain was wiped or you're recovering on
                  a new machine, paste the absolute path of an exported{" "}
                  <code>.dek</code> file and the export password used
                  when it was created.
                </p>
                <input
                  type="text"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  placeholder="/secure/backup/sorng-master.dek"
                  disabled={importBusy}
                  className="w-full px-3 py-1.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 font-mono"
                />
                <input
                  type="password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder="Export password"
                  disabled={importBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleImportDek();
                  }}
                  className="w-full px-3 py-1.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                {importError && (
                  <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-[10px]">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{importError}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleImportDek}
                  disabled={
                    importBusy ||
                    importPath.length === 0 ||
                    importPassword.length === 0
                  }
                  data-testid="unlock-import-submit"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                >
                  {importBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Unlock className="w-3.5 h-3.5" />
                  )}
                  Import + unlock
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnlockScreen;
