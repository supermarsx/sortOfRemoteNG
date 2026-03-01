import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";
import {
  Shield,
  Lock,
  Key,
  Timer,
  Gauge,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  FileKey,
  Download,
  CheckCircle,
  Database,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  useSecuritySettings,
  ENCRYPTION_ALGORITHMS,
} from "../../../hooks/settings/useSecuritySettings";
import { Checkbox, NumberInput, Select, Slider } from '../../ui/forms';

interface SecuritySettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  handleBenchmark: () => void;
  isBenchmarking: boolean;
}

type Mgr = ReturnType<typeof useSecuritySettings>;

export const SecuritySettings: React.FC<SecuritySettingsProps> = ({
  settings,
  updateSettings,
  handleBenchmark,
  isBenchmarking,
}) => {
  const { t } = useTranslation();
  const mgr = useSecuritySettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Shield className="w-5 h-5" />
        Security
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Encryption algorithms, key derivation, master password, and credential
        storage settings.
      </p>

      <EncryptionAlgorithmSection settings={settings} updateSettings={updateSettings} mgr={mgr} t={t} />
      <KeyDerivationSection settings={settings} updateSettings={updateSettings} handleBenchmark={handleBenchmark} isBenchmarking={isBenchmarking} t={t} />
      <AutoLockSection settings={settings} updateSettings={updateSettings} mgr={mgr} />
      <SSHKeyGenSection mgr={mgr} />
      <CollectionKeyGenSection mgr={mgr} />
      <CredSSPSection settings={settings} updateSettings={updateSettings} />
      <PasswordRevealSection settings={settings} updateSettings={updateSettings} />
      <TOTPDefaultsSection settings={settings} updateSettings={updateSettings} />
    </div>
  );
};

export default SecuritySettings;

// ─── Sub-components ────────────────────────────────────────────────

type TFunc = ReturnType<typeof useTranslation>["t"];

function EncryptionAlgorithmSection({
  settings,
  updateSettings,
  mgr,
  t,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
  mgr: Mgr;
  t: TFunc;
}) {
  const selectedAlgo = ENCRYPTION_ALGORITHMS.find(
    (a) => a.value === settings.encryptionAlgorithm,
  );

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
        <Lock className="w-4 h-4 text-blue-400" />
        {t("security.algorithm")}
      </h4>

      <div className="sor-settings-card space-y-4">
        <div data-setting-key="encryptionAlgorithm" className="flex items-center gap-3">
          <Lock className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <div className="flex-1">
            <Select value={settings.encryptionAlgorithm} onChange={(v: string) =>
                updateSettings({ encryptionAlgorithm: v as any })} options={[...ENCRYPTION_ALGORITHMS.map((algo) => ({ value: algo.value, label: `${algo.label}
                  ${algo.recommended ? " ★" : ""}` }))]} className="sor-settings-select w-full text-sm" />
          </div>
        </div>

        {selectedAlgo && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)]/60 rounded-md text-sm">
            {selectedAlgo.recommended && (
              <span className="px-1.5 py-0.5 text-[10px] bg-green-600/30 text-green-400 rounded">
                Recommended
              </span>
            )}
            <span className="text-[var(--color-textSecondary)]">
              {selectedAlgo.description}
            </span>
          </div>
        )}

        {mgr.validModes.length > 0 && (
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-purple-400 flex-shrink-0" />
            <div className="flex-1 flex items-center gap-2">
              <span className="text-sm text-[var(--color-textSecondary)] whitespace-nowrap">
                Mode:
              </span>
              <Select value={settings.blockCipherMode} onChange={(v: string) =>
                  updateSettings({ blockCipherMode: v as any })} options={[...mgr.validModes.map((mode) => ({ value: mode.value, label: mode.label }))]} className="sor-settings-select flex-1 text-sm" disabled={mgr.validModes.length === 1} />
            </div>
          </div>
        )}

        {settings.encryptionAlgorithm === "ChaCha20-Poly1305" && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)]/60 rounded-md text-[var(--color-textSecondary)] text-sm">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            Stream cipher with built-in AEAD (no block mode needed)
          </div>
        )}
      </div>
    </div>
  );
}

function KeyDerivationSection({
  settings,
  updateSettings,
  handleBenchmark,
  isBenchmarking,
  t,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
  handleBenchmark: () => void;
  isBenchmarking: boolean;
  t: TFunc;
}) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
        <Key className="w-4 h-4 text-purple-400" />
        Key Derivation (PBKDF2)
      </h4>

      <div className="sor-settings-card space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Gauge className="w-4 h-4" />
              {t("security.iterations")}
            </label>
            <div className="flex space-x-2">
              <NumberInput value={settings.keyDerivationIterations} onChange={(v: number) => updateSettings({
                    keyDerivationIterations: v,
                  })} className="flex-1" min={10000} max={1000000} />
              <button
                onClick={handleBenchmark}
                disabled={isBenchmarking}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-[var(--color-text)] rounded-md transition-colors"
              >
                {isBenchmarking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <Gauge className="w-4 h-4" />
                    <span>Benchmark</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Higher values = more secure but slower. Benchmark to find optimal
              value.
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Timer className="w-4 h-4" />
              {t("security.benchmarkTime")}
            </label>
            <NumberInput value={settings.benchmarkTimeSeconds} onChange={(v: number) => updateSettings({
                  benchmarkTimeSeconds: v,
                })} className="w-full" min={0.5} max={10} step={0.5} />
            <p className="text-xs text-gray-500">
              Target time for key derivation during benchmark
            </p>
          </div>
        </div>

        <label className="flex items-center space-x-3 cursor-pointer group pt-2">
          <Checkbox checked={settings.autoBenchmarkIterations} onChange={(v: boolean) => updateSettings({ autoBenchmarkIterations: v })} />
          <Gauge className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
            {t("security.autoBenchmark")}
          </span>
        </label>
      </div>
    </div>
  );
}

function AutoLockSection({
  settings,
  updateSettings,
  mgr,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
  mgr: Mgr;
}) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
        <Clock className="w-4 h-4 text-yellow-400" />
        Auto Lock
      </h4>

      <div className="sor-settings-card space-y-4">
        {!mgr.hasPassword && (
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border border-yellow-700/50 rounded-md text-yellow-400 text-sm">
            <Lock className="w-4 h-4" />
            Set a storage password to enable auto lock.
          </div>
        )}

        <label
          className={`flex items-center space-x-3 cursor-pointer group ${!mgr.hasPassword ? "opacity-50" : ""}`}
        >
          <Checkbox checked={settings.autoLock.enabled && mgr.hasPassword} onChange={(v: boolean) => updateSettings({
                autoLock: { ...settings.autoLock, enabled: v },
              })} disabled={!mgr.hasPassword} />
          <Clock className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
          <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
            Enable auto lock after inactivity
          </span>
        </label>

        <div
          className={`space-y-2 ${!mgr.hasPassword || !settings.autoLock.enabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Timer className="w-4 h-4" />
            Auto lock timeout (minutes)
          </label>
          <NumberInput value={settings.autoLock.timeoutMinutes} onChange={(v: number) => updateSettings({
                autoLock: {
                  ...settings.autoLock,
                  timeoutMinutes: v,
                },
              })} className="w-full" min={1} max={240} disabled={!mgr.hasPassword} />
        </div>
      </div>
    </div>
  );
}

function SSHKeyGenSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
        <FileKey className="w-4 h-4 text-emerald-400" />
        Generate SSH Key File
      </h4>

      <div className="sor-settings-card space-y-4">
        <p className="text-sm text-[var(--color-textSecondary)]">
          Generate a new SSH key pair and save it to a file. The private key will
          be saved to your chosen location, and the public key will be saved with
          a .pub extension.
        </p>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Key className="w-4 h-4" />
            Key Type
          </label>
          <div className="flex space-x-3">
            <button
              onClick={() => mgr.setKeyType("ed25519")}
              className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                mgr.keyType === "ed25519"
                  ? "bg-emerald-600/30 border border-emerald-500 text-emerald-300"
                  : "bg-[var(--color-border)] border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              Ed25519 (Recommended)
            </button>
            <button
              onClick={() => mgr.setKeyType("rsa")}
              className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                mgr.keyType === "rsa"
                  ? "bg-emerald-600/30 border border-emerald-500 text-emerald-300"
                  : "bg-[var(--color-border)] border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              RSA (4096-bit)
            </button>
          </div>
        </div>

        <button
          onClick={mgr.generateSSHKey}
          disabled={mgr.isGeneratingKey}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-[var(--color-text)] rounded-md transition-colors"
        >
          {mgr.isGeneratingKey ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Generate & Save Key File</span>
            </>
          )}
        </button>

        {mgr.keyGenSuccess && (
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-900/30 border border-emerald-700/50 rounded-md text-emerald-400 text-sm">
            <CheckCircle className="w-4 h-4" />
            {mgr.keyGenSuccess}
          </div>
        )}

        {mgr.keyGenError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-md text-red-400 text-sm">
            <Lock className="w-4 h-4" />
            {mgr.keyGenError}
          </div>
        )}
      </div>
    </div>
  );
}

function CollectionKeyGenSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
        <Database className="w-4 h-4 text-blue-400" />
        Generate Collection Encryption Key File
      </h4>

      <div className="sor-settings-card space-y-4">
        <p className="text-sm text-[var(--color-textSecondary)]">
          Generate a secure encryption key file that can be used to encrypt your
          connection collections. This key file can be used instead of a password
          when creating or opening encrypted collections.
          <span className="text-yellow-400 block mt-2">
            ⚠️ Keep this file secure! Anyone with access to it can decrypt your
            collections.
          </span>
        </p>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Key className="w-4 h-4" />
            Key Strength
          </label>
          <div className="flex space-x-3">
            <button
              onClick={() => mgr.setCollectionKeyLength(32)}
              className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                mgr.collectionKeyLength === 32
                  ? "bg-blue-600/30 border border-blue-500 text-blue-300"
                  : "bg-[var(--color-border)] border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              256-bit (Standard)
            </button>
            <button
              onClick={() => mgr.setCollectionKeyLength(64)}
              className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                mgr.collectionKeyLength === 64
                  ? "bg-blue-600/30 border border-blue-500 text-blue-300"
                  : "bg-[var(--color-border)] border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              512-bit (High Security)
            </button>
          </div>
        </div>

        <button
          onClick={mgr.generateCollectionKey}
          disabled={mgr.isGeneratingCollectionKey}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-[var(--color-text)] rounded-md transition-colors"
        >
          {mgr.isGeneratingCollectionKey ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <FileKey className="w-4 h-4" />
              <span>Generate & Save Collection Key File</span>
            </>
          )}
        </button>

        {mgr.collectionKeySuccess && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-900/30 border border-blue-700/50 rounded-md text-blue-400 text-sm">
            <CheckCircle className="w-4 h-4" />
            {mgr.collectionKeySuccess}
          </div>
        )}

        {mgr.collectionKeyError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-md text-red-400 text-sm">
            <Lock className="w-4 h-4" />
            {mgr.collectionKeyError}
          </div>
        )}
      </div>
    </div>
  );
}

function CredSSPSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  return (
    <div className="sor-settings-card space-y-4">
      <div>
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          CredSSP Remediation Defaults
        </h4>
        <p className="text-xs text-gray-500 mt-1">
          Global defaults for RDP CredSSP / NLA behaviour. Individual
          connections can override these.
        </p>
      </div>

      {/* Oracle Remediation Policy */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Encryption Oracle Remediation Policy
        </label>
        <Select value={settings.credsspDefaults?.oracleRemediation ?? "mitigated"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                oracleRemediation: v as
                  | "force-updated"
                  | "mitigated"
                  | "vulnerable",
              },
            })} options={[{ value: "force-updated", label: "Force Updated Clients" }, { value: "mitigated", label: "Mitigated (recommended)" }, { value: "vulnerable", label: "Vulnerable (allow all)" }]} className="w-full" />
        <p className="text-xs text-gray-500 mt-1">
          {settings.credsspDefaults?.oracleRemediation === "force-updated"
            ? "Both client and server must be patched for CVE-2018-0886."
            : settings.credsspDefaults?.oracleRemediation === "vulnerable"
              ? "Warning: Allows connections regardless of patch status. Security risk."
              : "Blocks connections to vulnerable servers but permits all others."}
        </p>
      </div>

      {/* NLA Mode */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default NLA Mode
        </label>
        <Select value={settings.credsspDefaults?.nlaMode ?? "required"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                nlaMode: v as
                  | "required"
                  | "preferred"
                  | "disabled",
              },
            })} options={[{ value: "required", label: "Required (reject if NLA unavailable)" }, { value: "preferred", label: "Preferred (fallback to TLS)" }, { value: "disabled", label: "Disabled (TLS only)" }]} className="w-full" />
      </div>

      {/* Minimum TLS Version */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Minimum TLS Version
        </label>
        <Select value={settings.credsspDefaults?.tlsMinVersion ?? "1.2"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                tlsMinVersion: v as "1.0" | "1.1" | "1.2" | "1.3",
              },
            })} options={[{ value: "1.0", label: "TLS 1.0 (legacy, insecure)" }, { value: "1.1", label: "TLS 1.1 (deprecated)" }, { value: "1.2", label: "TLS 1.2 (recommended)" }, { value: "1.3", label: "TLS 1.3 (strictest)" }]} className="w-full" />
      </div>

      {/* CredSSP Version */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          CredSSP TSRequest Version
        </label>
        <Select value={String(settings.credsspDefaults?.credsspVersion ?? 6)} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                credsspVersion: parseInt(v) as 2 | 3 | 6,
              },
            })} options={[{ value: "2", label: "Version 2 (legacy)" }, { value: "3", label: "Version 3 (with client nonce)" }, { value: "6", label: "Version 6 (latest, with nonce binding)" }]} className="w-full" />
      </div>

      {/* Server Cert Validation */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Server Certificate Validation
        </label>
        <Select value={settings.credsspDefaults?.serverCertValidation ?? "validate"} onChange={(v: string) => updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                serverCertValidation: v as
                  | "validate"
                  | "warn"
                  | "ignore",
              },
            })} options={[{ value: "validate", label: "Validate (reject untrusted)" }, { value: "warn", label: "Warn (prompt on untrusted)" }, { value: "ignore", label: "Ignore (accept all certificates)" }]} className="w-full" />
      </div>

      {/* Boolean toggles */}
      <div className="space-y-3">
        {[
          {
            key: "allowHybridEx" as const,
            default: false,
            label: "Allow HYBRID_EX protocol (Early User Auth Result)",
          },
          {
            key: "nlaFallbackToTls" as const,
            default: true,
            label: "Allow NLA fallback to TLS on failure",
          },
          {
            key: "enforceServerPublicKeyValidation" as const,
            default: true,
            label: "Enforce server public key validation during CredSSP",
          },
          {
            key: "restrictedAdmin" as const,
            default: false,
            label: "Restricted Admin mode (no credential delegation)",
          },
          {
            key: "remoteCredentialGuard" as const,
            default: false,
            label: "Remote Credential Guard (Kerberos delegation)",
          },
        ].map(({ key, default: def, label }) => (
          <label
            key={key}
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <Checkbox checked={settings.credsspDefaults?.[key] ?? def} onChange={(v: boolean) => updateSettings({
                  credsspDefaults: {
                    ...settings.credsspDefaults,
                    [key]: v,
                  },
                })} />
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
              {label}
            </span>
          </label>
        ))}
      </div>

      {/* Authentication packages */}
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Authentication Packages
        </label>
        <div className="space-y-2 pl-1">
          {[
            { key: "ntlmEnabled" as const, default: true, label: "NTLM" },
            {
              key: "kerberosEnabled" as const,
              default: false,
              label: "Kerberos",
            },
            { key: "pku2uEnabled" as const, default: false, label: "PKU2U" },
          ].map(({ key, default: def, label }) => (
            <label
              key={key}
              className="flex items-center space-x-3 cursor-pointer group"
            >
              <Checkbox checked={settings.credsspDefaults?.[key] ?? def} onChange={(v: boolean) => updateSettings({
                    credsspDefaults: {
                      ...settings.credsspDefaults,
                      [key]: v,
                    },
                  })} />
              <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
                {label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* SSPI Override */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          SSPI Package List Override
        </label>
        <input
          type="text"
          value={settings.credsspDefaults?.sspiPackageList ?? ""}
          onChange={(e) =>
            updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                sspiPackageList: e.target.value,
              },
            })
          }
          className="sor-settings-input w-full text-sm"
          placeholder="e.g. !kerberos,!pku2u (leave empty for auto)"
        />
        <p className="text-xs text-gray-500 mt-1">
          Advanced: Overrides the auth package checkboxes above. Prefix with !
          to exclude.
        </p>
      </div>
    </div>
  );
}

function PasswordRevealSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  return (
    <div className="sor-settings-card space-y-4">
      <div>
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Eye className="w-4 h-4 text-blue-400" />
          Password Reveal
        </h4>
        <p className="text-xs text-gray-500 mt-1">
          Controls the show/hide eye icon on all password fields throughout the
          application.
        </p>
      </div>

      <label className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={settings.passwordReveal?.enabled ?? true} onChange={(v: boolean) => updateSettings({
              passwordReveal: {
                ...settings.passwordReveal,
                enabled: v,
              },
            })} />
        <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
          Enable password reveal icon on all password fields
        </span>
      </label>

      {(settings.passwordReveal?.enabled ?? true) && (
        <>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Reveal Mode
            </label>
            <Select value={settings.passwordReveal?.mode ?? "toggle"} onChange={(v: string) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    mode: v as "toggle" | "hold",
                  },
                })} options={[{ value: "toggle", label: "Toggle (click to show/hide)" }, { value: "hold", label: "Hold (hold mouse to reveal)" }]} className="w-full" />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Auto-hide after (seconds):{" "}
              {settings.passwordReveal?.autoHideSeconds ?? 0}
              {(settings.passwordReveal?.autoHideSeconds ?? 0) === 0 &&
                " (disabled)"}
            </label>
            <Slider value={settings.passwordReveal?.autoHideSeconds ?? 0} onChange={(v: number) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    autoHideSeconds: v,
                  },
                })} min={0} max={60} variant="full" />
            <div className="flex justify-between text-xs text-gray-600">
              <span>Off</span>
              <span>60s</span>
            </div>
          </div>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.passwordReveal?.showByDefault ?? false} onChange={(v: boolean) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    showByDefault: v,
                  },
                })} />
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
              Show passwords by default (not recommended)
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.passwordReveal?.maskIcon ?? false} onChange={(v: boolean) => updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    maskIcon: v,
                  },
                })} />
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors flex items-center gap-2">
              Dim eye icon when password is hidden
              <EyeOff className="w-3.5 h-3.5 opacity-40" />
            </span>
          </label>
        </>
      )}
    </div>
  );
}

function TOTPDefaultsSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}) {
  return (
    <div className="sor-settings-card space-y-4">
      <div>
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-400" />
          2FA / TOTP Defaults
        </h4>
        <p className="text-xs text-gray-500 mt-1">
          Default values used when adding new TOTP configurations to
          connections.
        </p>
      </div>

      <label
        data-setting-key="totpEnabled"
        className="flex items-center space-x-3 cursor-pointer group"
      >
        <Checkbox checked={settings.totpEnabled} onChange={(v: boolean) => updateSettings({ totpEnabled: v })} />
        <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
          Enable TOTP functionality
        </span>
      </label>

      <div data-setting-key="totpIssuer">
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Default Issuer
        </label>
        <input
          type="text"
          value={settings.totpIssuer}
          onChange={(e) => updateSettings({ totpIssuer: e.target.value })}
          className="sor-settings-input w-full text-sm"
          placeholder="sortOfRemoteNG"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div data-setting-key="totpDigits">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Digits
          </label>
          <Select value={settings.totpDigits} onChange={(v: string) => updateSettings({ totpDigits: parseInt(v) })} options={[{ value: "6", label: "6 digits" }, { value: "8", label: "8 digits" }]} className="w-full" />
        </div>

        <div data-setting-key="totpPeriod">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Period
          </label>
          <Select value={settings.totpPeriod} onChange={(v: string) => updateSettings({ totpPeriod: parseInt(v) })} options={[{ value: "15", label: "15 seconds" }, { value: "30", label: "30 seconds" }, { value: "60", label: "60 seconds" }]} className="w-full" />
        </div>

        <div data-setting-key="totpAlgorithm">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Algorithm
          </label>
          <Select value={settings.totpAlgorithm} onChange={(v: string) => updateSettings({
                totpAlgorithm: v as "sha1" | "sha256" | "sha512",
              })} options={[{ value: "sha1", label: "SHA-1" }, { value: "sha256", label: "SHA-256" }, { value: "sha512", label: "SHA-512" }]} className="w-full" />
        </div>
      </div>
    </div>
  );
}
