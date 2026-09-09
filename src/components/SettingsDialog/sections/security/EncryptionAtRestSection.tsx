/** Global master-key lifecycle and inspected, per-artifact protection controls. */
import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Database,
  Download,
  FileWarning,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  FolderOpen,
  Shield,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsPasswordRow,
  SettingsNumberRow,
  SettingsTextRow,
  Toggle as SettingsToggleRow,
} from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import { useEncryption } from "../../../../hooks/settings/useEncryption";
import {
  ARGON2_OWASP,
  AUDIT_EVENT_LABELS,
  describeStorage,
  type Argon2Params,
  type SetupMethod,
} from "../../../../types/encryption/encryption";
import { useDatabaseEncryptionStatus } from "../../../../hooks/settings/useDatabaseEncryptionStatus";
import DatabaseProtectionStatus from "./DatabaseProtectionStatus";
import ArtifactProtectionPanel from "./ArtifactProtectionPanel";

const EncryptionAtRestSection: React.FC = () => {
  const enc = useEncryption();
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupChoice, setSetupChoice] = useState<"vault" | "password">("vault");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupArgon2, setSetupArgon2] = useState<Argon2Params>(ARGON2_OWASP);

  // Manual "Lock now" trigger — Phase 4 add-on. Surfaces the same
  // `encryption_lock` command the auto-lock listener uses, with an
  // explicit button + Ctrl/⌘-L keyboard binding.
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  /* Audit rows whose JSON detail is expanded. Keyed by `${ts}-${index}` so the
     identity survives the reverse()/slice() the table does on every render. */
  const [expandedAudit, setExpandedAudit] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleAuditDetail = (key: string) =>
    setExpandedAudit((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const [changeOldPw, setChangeOldPw] = useState("");
  const [changeNewPw, setChangeNewPw] = useState("");
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);

  const [rotateBusy, setRotateBusy] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateSummary, setRotateSummary] = useState<string | null>(null);
  const [rotatePassword, setRotatePassword] = useState("");

  const [portableExportBusy, setPortableExportBusy] = useState(false);
  const [portableExportError, setPortableExportError] = useState<string | null>(
    null,
  );
  const [portableExportSuccess, setPortableExportSuccess] = useState<
    string | null
  >(null);
  const [portableExportPath, setPortableExportPath] = useState("");
  const [portableExportPassword, setPortableExportPassword] = useState("");

  const [portableImportBusy, setPortableImportBusy] = useState(false);
  const [portableImportError, setPortableImportError] = useState<string | null>(
    null,
  );
  const [portableImportPath, setPortableImportPath] = useState("");
  const [portableImportPassword, setPortableImportPassword] = useState("");

  const status = enc.status;
  const diskProbe = useDatabaseEncryptionStatus(status);
  const isUnavailable = !enc.loading && status === null;
  const strandedArtifacts =
    !!status?.recoveryRequired ||
    !!status?.settingsEncryptedOnDisk ||
    (diskProbe.status?.summary.encrypted ?? 0) > 0;

  const needsSetup = useMemo(
    () =>
      !!status &&
      !status.vaultHasMasterDek &&
      !status.passwordWrapPresent &&
      !strandedArtifacts &&
      !!diskProbe.status &&
      !diskProbe.loading &&
      !diskProbe.error,
    [
      status,
      strandedArtifacts,
      diskProbe.status,
      diskProbe.loading,
      diskProbe.error,
    ],
  );

  const passwordModeActive =
    !!status &&
    (status.masterKeyStorage === "password" ||
      status.masterKeyStorage === "vault-and-password");

  const handleSetup = async () => {
    setSetupBusy(true);
    setSetupError(null);
    try {
      const method: SetupMethod =
        setupChoice === "vault"
          ? "vault"
          : { password: { password: setupPassword, argon2: setupArgon2 } };
      const result = await enc.setup(method);
      if (result === "vault-unavailable") {
        setSetupError(
          "Your OS doesn't expose a usable vault; switch to password mode.",
        );
      } else if (
        result === "wrong-password" ||
        result === "password-required"
      ) {
        setSetupError("Setup returned an unexpected unlock-only outcome.");
      }
      setSetupPassword("");
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e));
    } finally {
      setSetupBusy(false);
    }
  };

  const handleLockNow = async () => {
    if (lockBusy) return;
    setLockBusy(true);
    setLockError(null);
    try {
      await enc.lock("manual");
    } catch (e) {
      setLockError(e instanceof Error ? e.message : String(e));
    } finally {
      setLockBusy(false);
    }
  };

  const handleChangePassword = async () => {
    setChangeBusy(true);
    setChangeError(null);
    setChangeSuccess(false);
    try {
      await enc.changePassword(changeOldPw, changeNewPw);
      setChangeSuccess(true);
      setChangeOldPw("");
      setChangeNewPw("");
    } catch (e) {
      setChangeError(e instanceof Error ? e.message : String(e));
    } finally {
      setChangeBusy(false);
    }
  };

  const handleRotateMasterKey = async () => {
    setRotateBusy(true);
    setRotateError(null);
    setRotateSummary(null);
    try {
      // Use the full-artifact rotation (settings + connections + backups +
      // recordings + media + macros). The unsafe settings-only command is
      // retired and is no longer exposed by the frontend hook.
      const report = await enc.rotateMasterKeyFull(
        passwordModeActive ? rotatePassword : undefined,
      );
      const counts = [
        report.settingsRewritten && "settings",
        report.connectionsRewritten && "connections",
        report.backupsRewritten > 0 && `${report.backupsRewritten} backup(s)`,
        report.recordingEnvelopesRewritten > 0 &&
          `${report.recordingEnvelopesRewritten} recording metadata`,
        report.mediaSidecarsRewritten > 0 &&
          `${report.mediaSidecarsRewritten} media sidecar(s)`,
        report.macrosRewritten > 0 && `${report.macrosRewritten} macro(s)`,
      ].filter(Boolean) as string[];
      const bits = [
        counts.length > 0
          ? `Rewrote ${counts.join(", ")}`
          : "No v2 artifacts on disk to rewrite",
        report.vaultUpdated && "vault entry updated",
        report.dekEncUpdated && "dek.enc updated",
        report.failures.length > 0 &&
          `${report.failures.length} file(s) failed`,
      ]
        .filter(Boolean)
        .join("; ");
      setRotateSummary(bits);
      setRotatePassword("");
    } catch (e) {
      setRotateError(e instanceof Error ? e.message : String(e));
    } finally {
      setRotateBusy(false);
    }
  };

  const handleExportPortable = async () => {
    setPortableExportBusy(true);
    setPortableExportError(null);
    setPortableExportSuccess(null);
    try {
      const bytes = await enc.exportPortableDek(
        portableExportPath,
        portableExportPassword,
      );
      setPortableExportSuccess(
        `Wrote ${bytes.toLocaleString()} bytes to ${portableExportPath}`,
      );
      setPortableExportPassword("");
    } catch (e) {
      setPortableExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setPortableExportBusy(false);
    }
  };

  const handleImportPortable = async () => {
    setPortableImportBusy(true);
    setPortableImportError(null);
    try {
      await enc.importPortableDek(portableImportPath, portableImportPassword);
      setPortableImportPath("");
      setPortableImportPassword("");
    } catch (e) {
      setPortableImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setPortableImportBusy(false);
    }
  };

  const choosePortablePath = async (purpose: "import" | "export") => {
    try {
      const { open, save } = await import("@tauri-apps/plugin-dialog");
      const filters = [{ name: "Portable master key", extensions: ["dek"] }];
      const path =
        purpose === "export"
          ? await save({
              title: "Export portable master key",
              defaultPath: "sorng-master.dek",
              filters,
            })
          : await open({
              title: "Import portable master key",
              multiple: false,
              directory: false,
              filters,
            });
      if (typeof path === "string") {
        if (purpose === "export") {
          setPortableExportPath(path);
          setPortableExportError(null);
        } else {
          setPortableImportPath(path);
          setPortableImportError(null);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (purpose === "export") setPortableExportError(message);
      else setPortableImportError(message);
    }
  };

  if (isUnavailable) {
    return (
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield className="w-4 h-4 text-primary" />}
          title="Global master-key protection"
        />
        <Card>
          <p className="text-xs text-[var(--color-textMuted)]">
            Encryption subsystem not available in this build. Open the desktop
            app to manage on-disk encryption.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Status badge card ─────────────────────────────────────── */}
      <div className="space-y-4" data-setting-key="encryptionAtRest">
        <SectionHeader
          icon={<Shield className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              Global master-key protection
              <InfoTooltip text="Manages the application-wide encryption key and per-artifact codecs (settings, recordings, backups, macros, logs)." />
            </span>
          }
        />
        <Card>
          {enc.loading ? (
            <p className="text-xs text-[var(--color-textMuted)] flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Probing encryption
              state…
            </p>
          ) : status ? (
            <div className="grid grid-cols-2 gap-y-2 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                Master key location
              </span>
              <span className="text-[var(--color-text)] font-medium flex items-center gap-1.5">
                {status.unlocked ? (
                  <Unlock className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-warning" />
                )}
                {describeStorage(status.masterKeyStorage)}
              </span>

              <span className="text-[var(--color-textSecondary)]">
                OS vault backend
              </span>
              <span className="text-[var(--color-text)] font-mono">
                {status.vaultAvailable ? status.vaultBackend : "not detected"}
              </span>

              <span className="text-[var(--color-textSecondary)]">
                Master DEK in vault
              </span>
              <span className="text-[var(--color-text)]">
                {status.vaultHasMasterDek ? (
                  <Check className="inline w-3.5 h-3.5 text-success mr-1" />
                ) : (
                  <span className="text-[var(--color-textMuted)]">—</span>
                )}
                {status.vaultHasMasterDek && "stored"}
              </span>

              <span className="text-[var(--color-textSecondary)]">
                Password wrap on disk
              </span>
              <span className="text-[var(--color-text)]">
                {status.passwordWrapPresent ? (
                  <Check className="inline w-3.5 h-3.5 text-success mr-1" />
                ) : (
                  <span className="text-[var(--color-textMuted)]">—</span>
                )}
                {status.passwordWrapPresent && "dek.enc present"}
              </span>

              <span className="text-[var(--color-textSecondary)]">
                Settings on disk
              </span>
              <span className="text-[var(--color-text)] flex items-center gap-1.5">
                {status.settingsEncryptedOnDisk ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-success" />
                    settings.enc (v2)
                  </>
                ) : status.settingsPlaintextPresent ? (
                  <>
                    <FileWarning className="w-3.5 h-3.5 text-warning" />
                    settings.json (v0 plaintext)
                  </>
                ) : (
                  <span className="text-[var(--color-textMuted)]">absent</span>
                )}
              </span>

              <span className="text-[var(--color-textSecondary)]">
                Schema version
              </span>
              <span className="text-[var(--color-text)] font-mono">
                v{status.schemaVersion}
              </span>
            </div>
          ) : null}
        </Card>
      </div>

      <DatabaseProtectionStatus probe={diskProbe} />
      {status &&
        !status.vaultHasMasterDek &&
        !status.passwordWrapPresent &&
        strandedArtifacts && (
          <Card>
            <p role="alert" className="text-xs text-warning">
              Encrypted artifacts exist but the master key is unavailable.
              Recover the original vault or portable master key; creating a new
              key cannot decrypt existing data.
            </p>
          </Card>
        )}

      {/* ── Lock now (manual trigger, visible only when unlocked) ─── */}
      {status?.unlocked && (
        <div className="space-y-4" data-setting-key="encryptionAtRest.lockNow">
          <SectionHeader
            icon={<Lock className="w-4 h-4 text-primary" />}
            title={
              <span className="flex items-center gap-2">
                Lock now
                <InfoTooltip text="Drops the master key from memory immediately. The unlock screen appears next time an encrypted artifact is read." />
              </span>
            }
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              Drops the master key from memory and returns to the unlock screen.
              Keyboard shortcut:{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--color-input)] border border-[var(--color-border)] font-mono text-[10px]">
                Ctrl+L
              </kbd>{" "}
              (
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--color-input)] border border-[var(--color-border)] font-mono text-[10px]">
                ⌘L
              </kbd>{" "}
              on macOS).
            </p>
            {lockError && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{lockError}</span>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleLockNow}
                disabled={lockBusy}
                data-testid="encryption-lock-now"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-warning text-[var(--color-text)] hover:bg-warning/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                {lockBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Lock className="w-3.5 h-3.5" />
                )}
                Lock now
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── First-run setup wizard ───────────────────────────────── */}
      {needsSetup && (
        <div className="space-y-4" data-setting-key="encryptionAtRest.setup">
          <SectionHeader
            icon={<KeyRound className="w-4 h-4 text-primary" />}
            title="Set up encryption"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              No master key found. Choose how the application's master
              data-encryption key should be stored. The choice controls how this
              key is recovered; these controls do not promise a later
              vault/password mode conversion.
            </p>

            <SettingsToggleRow
              checked={setupChoice === "vault"}
              onChange={() => setSetupChoice("vault")}
              disabled={!status?.vaultAvailable}
              icon={<Shield size={16} />}
              label={
                <span>
                  Use the OS vault
                  {!status?.vaultAvailable && (
                    <span className="ml-2 text-[10px] text-[var(--color-textMuted)]">
                      (not detected)
                    </span>
                  )}
                </span>
              }
              description="Transparent unlock at app start. Recommended when the OS exposes a credential manager."
              infoTooltip="The 32-byte master key is generated by the OS RNG and stored in the platform's keychain. No password prompt at app start."
            />
            <SettingsToggleRow
              checked={setupChoice === "password"}
              onChange={() => setSetupChoice("password")}
              icon={<KeyRound size={16} />}
              label="Wrap with a password"
              description="Stores the master key Argon2id-wrapped in dek.enc. Useful when no OS vault is available or you want portability."
              infoTooltip="Master key is randomly generated, then encrypted under a key derived from your password via Argon2id (application defaults)."
            />

            {setupChoice === "password" && (
              <>
                <SettingsPasswordRow
                  settingKey="encryptionAtRest.masterPassword"
                  icon={<KeyRound size={16} />}
                  label="Master password"
                  value={setupPassword}
                  onChange={setSetupPassword}
                  placeholder="At least 12 characters recommended"
                  infoTooltip="Used to wrap the master DEK. Argon2id (OWASP) is the default; advanced settings let you tune memory/time/parallelism."
                />
                <SettingsNumberRow
                  settingKey="encryptionAtRest.argon2MemoryKib"
                  icon={<Database size={16} />}
                  label="Argon2id memory"
                  value={setupArgon2.memoryKib}
                  min={8}
                  max={4 * 1024 * 1024}
                  unit="KiB"
                  onChange={(v) =>
                    setSetupArgon2({ ...setupArgon2, memoryKib: v })
                  }
                  infoTooltip="Memory cost for the password KDF. Higher values dramatically slow offline guessing. The application default is 64 MiB."
                />
                <SettingsNumberRow
                  icon={<RefreshCw size={16} />}
                  settingKey="encryptionAtRest.argon2TimeCost"
                  label="Argon2id iterations"
                  value={setupArgon2.timeCost}
                  min={1}
                  max={50}
                  onChange={(v) =>
                    setSetupArgon2({ ...setupArgon2, timeCost: v })
                  }
                  infoTooltip="Time cost. 3 is the application default; raise if you can tolerate slower unlocks."
                />
                <SettingsNumberRow
                  icon={<RefreshCw size={16} />}
                  settingKey="encryptionAtRest.argon2Parallelism"
                  label="Argon2id parallelism"
                  value={setupArgon2.parallelism}
                  min={1}
                  max={64}
                  onChange={(v) =>
                    setSetupArgon2({ ...setupArgon2, parallelism: v })
                  }
                  infoTooltip="Number of parallel lanes. 4 is the application default and matches typical CPU thread counts."
                />
              </>
            )}

            {setupError && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{setupError}</span>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSetup}
                disabled={
                  setupBusy ||
                  (setupChoice === "password" && setupPassword.length < 8) ||
                  (setupChoice === "vault" && !status?.vaultAvailable)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                {setupBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <KeyRound className="w-3.5 h-3.5" />
                )}
                Generate master key
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Change password ──────────────────────────────────────── */}
      {passwordModeActive && (
        <div
          className="space-y-4"
          data-setting-key="encryptionAtRest.changePassword"
        >
          <SectionHeader
            icon={<KeyRound className="w-4 h-4 text-primary" />}
            title="Change master password"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              Rewrites <code>dek.enc</code> only — every encrypted artifact
              keeps its existing ciphertext, so this completes in milliseconds
              regardless of how much data you have on disk.
            </p>
            <SettingsPasswordRow
              icon={<Lock size={16} />}
              label="Current password"
              value={changeOldPw}
              onChange={setChangeOldPw}
              placeholder="Required to unwrap the existing dek.enc"
            />
            <SettingsPasswordRow
              icon={<KeyRound size={16} />}
              label="New password"
              value={changeNewPw}
              onChange={setChangeNewPw}
              placeholder="At least 12 characters recommended"
            />
            {changeError && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{changeError}</span>
              </div>
            )}
            {changeSuccess && (
              <div className="flex items-center gap-1.5 p-2 rounded bg-success/10 border border-success/30 text-success text-xs">
                <Check className="w-3.5 h-3.5" />
                Password changed.
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={
                  changeBusy ||
                  changeOldPw.length === 0 ||
                  changeNewPw.length < 8
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                {changeBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <KeyRound className="w-3.5 h-3.5" />
                )}
                Change password
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Rotate master key ─────────────────────────────────────── */}
      {status?.unlocked && (
        <div
          className="space-y-4"
          data-setting-key="encryptionAtRest.rotateMasterKey"
        >
          <SectionHeader
            icon={<RefreshCw className="w-4 h-4 text-primary" />}
            title="Rotate master key"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              Generates a fresh 32-byte master DEK, re-encrypts managed
              artifacts under freshly-derived sub-keys, then swaps the vault
              entry and/or <code>dek.enc</code> to match. Use after a suspected
              password or vault leak. Managed artifacts are re-encrypted, but up
              to five previous master keys are retained for recovery. Older
              external copies can remain decryptable. The full multi-file
              rotation is not a single power-loss-atomic transaction.
            </p>
            {passwordModeActive && (
              <SettingsPasswordRow
                icon={<KeyRound size={16} />}
                label="Current password"
                value={rotatePassword}
                onChange={setRotatePassword}
                placeholder="Required so dek.enc can be re-wrapped"
                infoTooltip="The same password you use to unlock at app start. Rotation re-wraps dek.enc under this password using the new DEK."
              />
            )}
            {rotateError && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{rotateError}</span>
              </div>
            )}
            {rotateSummary && (
              <div className="flex items-center gap-1.5 p-2 rounded bg-success/10 border border-success/30 text-success text-xs">
                <Check className="w-3.5 h-3.5" />
                {rotateSummary}
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleRotateMasterKey}
                disabled={
                  rotateBusy ||
                  (passwordModeActive && rotatePassword.length === 0)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                {rotateBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Rotate master key
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Portable key export ──────────────────────────────────── */}
      {status?.unlocked && (
        <div
          className="space-y-4"
          data-setting-key="encryptionAtRest.exportPortableKey"
        >
          <SectionHeader
            icon={<Download className="w-4 h-4 text-primary" />}
            title="Export portable master key"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              Writes a password-wrapped copy of the master DEK to the path you
              choose. Use this to migrate to a new machine where the OS vault is
              different, or as a one-shot backup you can store offline. Choose a
              strong, distinct password — the file is portable, so anyone with
              both the file and the password can decrypt your data.
            </p>
            <SettingsTextRow
              icon={<Download size={16} />}
              label="Destination path"
              value={portableExportPath}
              onChange={setPortableExportPath}
              placeholder="/secure/backup/sorng-master.dek"
              infoTooltip="Absolute path on disk. The file is overwritten if it exists. Place it on removable media for offline backup."
            />
            <button
              type="button"
              disabled={portableExportBusy}
              onClick={() => void choosePortablePath("export")}
              className="inline-flex self-end w-fit max-w-full items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              Choose portable key destination
            </button>
            <SettingsPasswordRow
              icon={<KeyRound size={16} />}
              label="Export password"
              value={portableExportPassword}
              onChange={setPortableExportPassword}
              placeholder="Used to wrap the DEK at export time"
              infoTooltip="Argon2id-derives a 256-bit key that wraps the master DEK. The recipient (or future you) needs this password to import."
            />
            {portableExportError && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{portableExportError}</span>
              </div>
            )}
            {portableExportSuccess && (
              <div className="flex items-center gap-1.5 p-2 rounded bg-success/10 border border-success/30 text-success text-xs">
                <Check className="w-3.5 h-3.5" />
                {portableExportSuccess}
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleExportPortable}
                disabled={
                  portableExportBusy ||
                  portableExportPath.length === 0 ||
                  portableExportPassword.length < 8
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                {portableExportBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Export key
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Portable key import ──────────────────────────────────── */}
      {!status?.unlocked && (
        <div
          className="space-y-4"
          data-setting-key="encryptionAtRest.importPortableKey"
        >
          <SectionHeader
            icon={<Upload className="w-4 h-4 text-primary" />}
            title="Import portable master key"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              Recover access on a new machine by pointing this at a
              <code>.dek</code> file you exported earlier. The key gets
              installed into the OS vault (if available) and saved as
              <code>dek.enc</code> so the next start finds it automatically.
            </p>
            <SettingsTextRow
              icon={<Upload size={16} />}
              label="Source path"
              value={portableImportPath}
              onChange={setPortableImportPath}
              placeholder="/secure/backup/sorng-master.dek"
              infoTooltip="Path to the .dek file produced by 'Export portable master key' on another machine."
            />
            <button
              type="button"
              disabled={portableImportBusy}
              onClick={() => void choosePortablePath("import")}
              className="text-xs underline"
            >
              Choose portable key source
            </button>
            <SettingsPasswordRow
              icon={<KeyRound size={16} />}
              label="Import password"
              value={portableImportPassword}
              onChange={setPortableImportPassword}
              placeholder="The password used at export time"
            />
            {portableImportError && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{portableImportError}</span>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleImportPortable}
                disabled={
                  portableImportBusy ||
                  portableImportPath.length === 0 ||
                  portableImportPassword.length === 0
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-[var(--color-text)] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                {portableImportBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                Import key
              </button>
            </div>
          </Card>
        </div>
      )}

      <ArtifactProtectionPanel
        refreshKey={`${status?.unlocked ?? "unavailable"}:${enc.lifecycleRevision}`}
        onChanged={async () => {
          await Promise.allSettled([enc.refresh(), diskProbe.refresh()]);
        }}
      />

      {/* ── Audit log ────────────────────────────────────────────── */}
      <div className="space-y-4" data-setting-key="encryptionAtRest.auditLog">
        <SectionHeader
          icon={<ClipboardList className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              Audit log
              <InfoTooltip text="Append-only log of every state-changing encryption operation. Plain-text JSON-lines; lives at <app_data_dir>/logs/encryption-audit.log so it's readable when everything else on disk is encrypted." />
            </span>
          }
        />
        <Card>
          {enc.audit.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)] italic">
              No audit entries yet. Each successful or failed operation records
              one line.
            </p>
          ) : (
            <div className="text-xs">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]/40">
                    <th className="py-1.5 pr-3 font-normal">Timestamp</th>
                    <th className="py-1.5 pr-3 font-normal">Event</th>
                    <th className="py-1.5 font-normal">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {enc.audit
                    .slice()
                    .reverse()
                    .slice(0, 25)
                    .map((entry, i) => {
                      const { ts, event, ...rest } = entry;
                      const label = AUDIT_EVENT_LABELS[event] ?? event;
                      const hasDetail = Object.keys(rest).length > 0;
                      const detail = hasDetail ? JSON.stringify(rest) : "";
                      const rowKey = `${ts}-${i}`;
                      const isExpanded = expandedAudit.has(rowKey);
                      return (
                        <tr
                          key={rowKey}
                          className="border-b border-[var(--color-border)]/20 last:border-0 align-top"
                        >
                          <td className="py-1.5 pr-3 font-mono text-[10px] text-[var(--color-textMuted)] whitespace-nowrap">
                            {ts}
                          </td>
                          <td className="py-1.5 pr-3 text-[var(--color-text)] whitespace-nowrap">
                            {label}
                          </td>
                          {/* `w-full max-w-0` lets the cell take the remaining
                              width while still giving the child a definite
                              basis to truncate against — without it an
                              auto-layout table just grows to fit the JSON. */}
                          <td className="w-full max-w-0 py-1.5 font-mono text-[10px] text-[var(--color-textSecondary)]">
                            {hasDetail ? (
                              <div className="flex items-start gap-2">
                                {isExpanded ? (
                                  <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[10px] m-0">
                                    {JSON.stringify(rest, null, 2)}
                                  </pre>
                                ) : (
                                  <span className="min-w-0 flex-1 truncate">
                                    {detail}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => toggleAuditDetail(rowKey)}
                                  aria-expanded={isExpanded}
                                  data-testid="audit-detail-toggle"
                                  className="shrink-0 text-[10px] underline text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
                                >
                                  {isExpanded ? "Show less" : "Show more"}
                                </button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--color-textMuted)]">
                <span>
                  Showing newest {Math.min(enc.audit.length, 25)} of{" "}
                  {enc.audit.length} entries
                </span>
                <button
                  type="button"
                  onClick={() => void enc.clearAudit()}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[var(--color-textSecondary)] hover:text-error"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear log
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
};

export default EncryptionAtRestSection;
