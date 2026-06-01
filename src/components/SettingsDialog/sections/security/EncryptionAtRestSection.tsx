/**
 * Settings → Security → Encryption-at-rest panel.
 *
 * Surfaces the live state of the `sorng-encryption` subsystem and
 * lets the user run the commands that ship today (Phases 0–3). Knobs
 * that need Phases 5/6 to be real (unlock-screen policy, disable &
 * decrypt, portable export) are rendered with explicit "ships in
 * Phase X" affordances so the panel is honest about what works now.
 *
 * Structure:
 *
 * 1. **Status card** — vault availability, backend name, what mode is
 *    in effect, whether settings.json is still plaintext on disk,
 *    schema version.
 * 2. **First-run wizard** — appears only when the master DEK hasn't
 *    been generated yet. Auto-detects the vault and offers the right
 *    setup choice; falls back to "ask for a password" when no vault.
 * 3. **Settings migration** — appears only when a plaintext
 *    settings.json is present. One click runs the migration command
 *    and the report renders inline.
 * 4. **Change password** — appears only in password / hybrid mode.
 *    Old + new + optional Argon2id parameter override.
 * 5. **Encrypted artifacts list** — read-only audit of every
 *    artifact's HKDF label and human name. Per-artifact migrate
 *    buttons land in Phase 5 once the corresponding scan-and-migrate
 *    commands exist.
 *
 * The component mounts inside `SecuritySettings.tsx` between the
 * existing `EncryptionAlgorithmSection` and `KeyDerivationSection`
 * subsections — see the parent for the visual order.
 */
import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Database,
  FileWarning,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Shield,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsPasswordRow,
  SettingsNumberRow,
  Toggle as SettingsToggleRow,
} from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import { useEncryption } from "../../../../hooks/settings/useEncryption";
import {
  ARGON2_OWASP,
  ARTIFACT_LABELS,
  describeStorage,
  type Argon2Params,
  type MigrationReport,
  type SetupMethod,
} from "../../../../types/encryption/encryption";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Build a stable timestamp string for the inline migration report. */
function formatNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

const EncryptionAtRestSection: React.FC = () => {
  const enc = useEncryption();
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupChoice, setSetupChoice] = useState<"vault" | "password">("vault");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupArgon2, setSetupArgon2] = useState<Argon2Params>(ARGON2_OWASP);

  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [migrateReport, setMigrateReport] = useState<MigrationReport | null>(
    null,
  );
  const [migrateRanAt, setMigrateRanAt] = useState<string | null>(null);

  const [changeOldPw, setChangeOldPw] = useState("");
  const [changeNewPw, setChangeNewPw] = useState("");
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);

  const status = enc.status;
  const isUnavailable = !enc.loading && status === null;

  const needsSetup = useMemo(
    () =>
      !!status &&
      !status.vaultHasMasterDek &&
      !status.passwordWrapPresent,
    [status],
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
      } else if (result === "wrong-password" || result === "password-required") {
        setSetupError("Setup returned an unexpected unlock-only outcome.");
      }
      setSetupPassword("");
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e));
    } finally {
      setSetupBusy(false);
    }
  };

  const handleMigrate = async () => {
    setMigrateBusy(true);
    setMigrateError(null);
    try {
      const report = await enc.migrateSettings();
      setMigrateReport(report);
      setMigrateRanAt(formatNow());
    } catch (e) {
      setMigrateError(e instanceof Error ? e.message : String(e));
    } finally {
      setMigrateBusy(false);
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

  if (isUnavailable) {
    return (
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield className="w-4 h-4 text-primary" />}
          title="Encryption at rest"
        />
        <Card>
          <p className="text-xs text-[var(--color-textMuted)]">
            Encryption subsystem not available in this build. Open the
            desktop app to manage on-disk encryption.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* ── Status badge card ─────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Shield className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              Encryption at rest
              <InfoTooltip text="Manages the application-wide encryption key and per-artifact codecs (settings, recordings, backups, macros, logs)." />
            </span>
          }
        />
        <Card>
          {enc.loading ? (
            <p className="text-xs text-[var(--color-textMuted)] flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Probing
              encryption state…
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

      {/* ── First-run setup wizard ───────────────────────────────── */}
      {needsSetup && (
        <div className="space-y-4">
          <SectionHeader
            icon={<KeyRound className="w-4 h-4 text-primary" />}
            title="Set up encryption"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              No master key found. Choose how the application's master
              data-encryption key should be stored. Both options can be
              switched later via the change-password / migrate flows;
              defaults are tuned for current OWASP guidance.
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
              infoTooltip="Master key is randomly generated, then encrypted under a key derived from your password via Argon2id (OWASP defaults)."
            />

            {setupChoice === "password" && (
              <>
                <SettingsPasswordRow
                  icon={<KeyRound size={16} />}
                  label="Master password"
                  value={setupPassword}
                  onChange={setSetupPassword}
                  placeholder="At least 12 characters recommended"
                  infoTooltip="Used to wrap the master DEK. Argon2id (OWASP) is the default; advanced settings let you tune memory/time/parallelism."
                />
                <SettingsNumberRow
                  icon={<Database size={16} />}
                  label="Argon2id memory"
                  value={setupArgon2.memoryKib}
                  min={8}
                  max={4 * 1024 * 1024}
                  unit="KiB"
                  onChange={(v) =>
                    setSetupArgon2({ ...setupArgon2, memoryKib: v })
                  }
                  infoTooltip="Memory cost for the password KDF. Higher values dramatically slow offline guessing. OWASP recommends ≥ 64 MiB."
                />
                <SettingsNumberRow
                  icon={<RefreshCw size={16} />}
                  label="Argon2id iterations"
                  value={setupArgon2.timeCost}
                  min={1}
                  max={50}
                  onChange={(v) =>
                    setSetupArgon2({ ...setupArgon2, timeCost: v })
                  }
                  infoTooltip="Time cost. 3 is the OWASP default; raise if you can tolerate slower unlocks."
                />
                <SettingsNumberRow
                  icon={<RefreshCw size={16} />}
                  label="Argon2id parallelism"
                  value={setupArgon2.parallelism}
                  min={1}
                  max={64}
                  onChange={(v) =>
                    setSetupArgon2({ ...setupArgon2, parallelism: v })
                  }
                  infoTooltip="Number of parallel lanes. 4 is the OWASP default and matches typical CPU thread counts."
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

      {/* ── Migrate plaintext settings ───────────────────────────── */}
      {status?.settingsPlaintextPresent && status.unlocked && (
        <div className="space-y-4">
          <SectionHeader
            icon={<FileWarning className="w-4 h-4 text-warning" />}
            title="Migrate plaintext settings"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              A legacy <code>settings.json</code> was found alongside
              the new format. Running the migration encrypts it as
              <code>settings.enc</code> using the current master key,
              archives the original as
              <code>settings.json.v0.bak</code>, and updates the boot
              path to read from the encrypted file going forward. The
              backup stays on disk for one release cycle as a
              rollback safety net.
            </p>

            {migrateError && (
              <div className="flex items-start gap-2 p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{migrateError}</span>
              </div>
            )}

            {migrateReport && migrateRanAt && (
              <div className="text-xs space-y-1 p-2 rounded bg-success/10 border border-success/30">
                <div className="flex items-center gap-1.5 text-success font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Migrated at {migrateRanAt}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[var(--color-textSecondary)]">
                  <span>Source bytes</span>
                  <span className="text-[var(--color-text)] font-mono">
                    {migrateReport.bytesIn.toLocaleString()}
                  </span>
                  <span>Encrypted bytes</span>
                  <span className="text-[var(--color-text)] font-mono">
                    {migrateReport.bytesOut.toLocaleString()}
                  </span>
                  <span>Mode used</span>
                  <span className="text-[var(--color-text)]">
                    {describeStorage(migrateReport.masterKeyStorage)}
                  </span>
                  <span>Backup path</span>
                  <span className="text-[var(--color-text)] font-mono truncate">
                    {migrateReport.backupPath}
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleMigrate}
                disabled={migrateBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-warning text-[var(--color-text)] hover:bg-warning/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                {migrateBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileWarning className="w-3.5 h-3.5" />
                )}
                Migrate now
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Change password ──────────────────────────────────────── */}
      {passwordModeActive && (
        <div className="space-y-4">
          <SectionHeader
            icon={<KeyRound className="w-4 h-4 text-primary" />}
            title="Change master password"
          />
          <Card>
            <p className="text-xs text-[var(--color-textMuted)]">
              Rewrites <code>dek.enc</code> only — every encrypted
              artifact keeps its existing ciphertext, so this completes
              in milliseconds regardless of how much data you have on
              disk.
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
                  changeBusy || changeOldPw.length === 0 || changeNewPw.length < 8
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

      {/* ── Encrypted artifacts (read-only listing) ──────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Database className="w-4 h-4 text-primary" />}
          title="Encrypted artifacts"
        />
        <Card>
          <p className="text-xs text-[var(--color-textMuted)]">
            Each artifact derives its own AES-256-GCM sub-key from the
            master key via HKDF-SHA256 with the label shown below.
            Sub-keys are domain-separated: a settings ciphertext cannot
            be decrypted with the recordings key, and vice versa.
            Per-artifact migrate buttons land in a follow-up phase
            alongside the recordings-encryption rollout.
          </p>
          <div className="text-xs">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[var(--color-textSecondary)] border-b border-[var(--color-border)]/40">
                  <th className="py-1.5 pr-3 font-normal">Artifact</th>
                  <th className="py-1.5 pr-3 font-normal">HKDF label</th>
                  <th className="py-1.5 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {(status?.artifactLabels ?? []).map((label) => {
                  const isSettings = label === "sornG-v1::settings";
                  const isLive =
                    isSettings && status?.settingsEncryptedOnDisk;
                  return (
                    <tr
                      key={label}
                      className="border-b border-[var(--color-border)]/20 last:border-0"
                    >
                      <td className="py-1.5 pr-3 text-[var(--color-text)]">
                        {ARTIFACT_LABELS[label] ?? label}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[10px] text-[var(--color-textMuted)]">
                        {label}
                      </td>
                      <td className="py-1.5">
                        {isLive ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            encrypted on disk
                          </span>
                        ) : (
                          <span className="text-[var(--color-textMuted)]">
                            codec ready
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
};

export default EncryptionAtRestSection;
