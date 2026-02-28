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
} from "../../../hooks/useSecuritySettings";

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
            <select
              value={settings.encryptionAlgorithm}
              onChange={(e) =>
                updateSettings({ encryptionAlgorithm: e.target.value as any })
              }
              className="sor-settings-select w-full text-sm"
            >
              {ENCRYPTION_ALGORITHMS.map((algo) => (
                <option key={algo.value} value={algo.value}>
                  {algo.label}
                  {algo.recommended ? " ★" : ""}
                </option>
              ))}
            </select>
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
              <select
                value={settings.blockCipherMode}
                onChange={(e) =>
                  updateSettings({ blockCipherMode: e.target.value as any })
                }
                className="sor-settings-select flex-1 text-sm"
                disabled={mgr.validModes.length === 1}
              >
                {mgr.validModes.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
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
              <input
                type="number"
                value={settings.keyDerivationIterations}
                onChange={(e) =>
                  updateSettings({
                    keyDerivationIterations: parseInt(e.target.value),
                  })
                }
                className="sor-settings-input flex-1"
                min="10000"
                max="1000000"
              />
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
            <input
              type="number"
              value={settings.benchmarkTimeSeconds}
              onChange={(e) =>
                updateSettings({
                  benchmarkTimeSeconds: parseInt(e.target.value),
                })
              }
              className="sor-settings-input w-full"
              min="0.5"
              max="10"
              step="0.5"
            />
            <p className="text-xs text-gray-500">
              Target time for key derivation during benchmark
            </p>
          </div>
        </div>

        <label className="flex items-center space-x-3 cursor-pointer group pt-2">
          <input
            type="checkbox"
            checked={settings.autoBenchmarkIterations}
            onChange={(e) =>
              updateSettings({ autoBenchmarkIterations: e.target.checked })
            }
            className="sor-settings-checkbox"
          />
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
          <input
            type="checkbox"
            checked={settings.autoLock.enabled && mgr.hasPassword}
            onChange={(e) =>
              updateSettings({
                autoLock: { ...settings.autoLock, enabled: e.target.checked },
              })
            }
            className="sor-settings-checkbox"
            disabled={!mgr.hasPassword}
          />
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
          <input
            type="number"
            value={settings.autoLock.timeoutMinutes}
            onChange={(e) =>
              updateSettings({
                autoLock: {
                  ...settings.autoLock,
                  timeoutMinutes: parseInt(e.target.value),
                },
              })
            }
            className="sor-settings-input w-full"
            min="1"
            max="240"
            disabled={!mgr.hasPassword}
          />
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
        <select
          value={settings.credsspDefaults?.oracleRemediation ?? "mitigated"}
          onChange={(e) =>
            updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                oracleRemediation: e.target.value as
                  | "force-updated"
                  | "mitigated"
                  | "vulnerable",
              },
            })
          }
          className="sor-settings-select w-full text-sm"
        >
          <option value="force-updated">Force Updated Clients</option>
          <option value="mitigated">Mitigated (recommended)</option>
          <option value="vulnerable">Vulnerable (allow all)</option>
        </select>
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
        <select
          value={settings.credsspDefaults?.nlaMode ?? "required"}
          onChange={(e) =>
            updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                nlaMode: e.target.value as
                  | "required"
                  | "preferred"
                  | "disabled",
              },
            })
          }
          className="sor-settings-select w-full text-sm"
        >
          <option value="required">Required (reject if NLA unavailable)</option>
          <option value="preferred">Preferred (fallback to TLS)</option>
          <option value="disabled">Disabled (TLS only)</option>
        </select>
      </div>

      {/* Minimum TLS Version */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Minimum TLS Version
        </label>
        <select
          value={settings.credsspDefaults?.tlsMinVersion ?? "1.2"}
          onChange={(e) =>
            updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                tlsMinVersion: e.target.value as "1.0" | "1.1" | "1.2" | "1.3",
              },
            })
          }
          className="sor-settings-select w-full text-sm"
        >
          <option value="1.0">TLS 1.0 (legacy, insecure)</option>
          <option value="1.1">TLS 1.1 (deprecated)</option>
          <option value="1.2">TLS 1.2 (recommended)</option>
          <option value="1.3">TLS 1.3 (strictest)</option>
        </select>
      </div>

      {/* CredSSP Version */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          CredSSP TSRequest Version
        </label>
        <select
          value={String(settings.credsspDefaults?.credsspVersion ?? 6)}
          onChange={(e) =>
            updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                credsspVersion: parseInt(e.target.value) as 2 | 3 | 6,
              },
            })
          }
          className="sor-settings-select w-full text-sm"
        >
          <option value="2">Version 2 (legacy)</option>
          <option value="3">Version 3 (with client nonce)</option>
          <option value="6">Version 6 (latest, with nonce binding)</option>
        </select>
      </div>

      {/* Server Cert Validation */}
      <div>
        <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
          Server Certificate Validation
        </label>
        <select
          value={settings.credsspDefaults?.serverCertValidation ?? "validate"}
          onChange={(e) =>
            updateSettings({
              credsspDefaults: {
                ...settings.credsspDefaults,
                serverCertValidation: e.target.value as
                  | "validate"
                  | "warn"
                  | "ignore",
              },
            })
          }
          className="sor-settings-select w-full text-sm"
        >
          <option value="validate">Validate (reject untrusted)</option>
          <option value="warn">Warn (prompt on untrusted)</option>
          <option value="ignore">Ignore (accept all certificates)</option>
        </select>
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
            <input
              type="checkbox"
              checked={settings.credsspDefaults?.[key] ?? def}
              onChange={(e) =>
                updateSettings({
                  credsspDefaults: {
                    ...settings.credsspDefaults,
                    [key]: e.target.checked,
                  },
                })
              }
              className="sor-settings-checkbox"
            />
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
              <input
                type="checkbox"
                checked={settings.credsspDefaults?.[key] ?? def}
                onChange={(e) =>
                  updateSettings({
                    credsspDefaults: {
                      ...settings.credsspDefaults,
                      [key]: e.target.checked,
                    },
                  })
                }
                className="sor-settings-checkbox"
              />
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
        <input
          type="checkbox"
          checked={settings.passwordReveal?.enabled ?? true}
          onChange={(e) =>
            updateSettings({
              passwordReveal: {
                ...settings.passwordReveal,
                enabled: e.target.checked,
              },
            })
          }
          className="sor-settings-checkbox"
        />
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
            <select
              value={settings.passwordReveal?.mode ?? "toggle"}
              onChange={(e) =>
                updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    mode: e.target.value as "toggle" | "hold",
                  },
                })
              }
              className="sor-settings-select w-full text-sm"
            >
              <option value="toggle">Toggle (click to show/hide)</option>
              <option value="hold">Hold (hold mouse to reveal)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Auto-hide after (seconds):{" "}
              {settings.passwordReveal?.autoHideSeconds ?? 0}
              {(settings.passwordReveal?.autoHideSeconds ?? 0) === 0 &&
                " (disabled)"}
            </label>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={settings.passwordReveal?.autoHideSeconds ?? 0}
              onChange={(e) =>
                updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    autoHideSeconds: parseInt(e.target.value),
                  },
                })
              }
              className="sor-settings-range-full"
            />
            <div className="flex justify-between text-xs text-gray-600">
              <span>Off</span>
              <span>60s</span>
            </div>
          </div>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.passwordReveal?.showByDefault ?? false}
              onChange={(e) =>
                updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    showByDefault: e.target.checked,
                  },
                })
              }
              className="sor-settings-checkbox"
            />
            <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] transition-colors">
              Show passwords by default (not recommended)
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.passwordReveal?.maskIcon ?? false}
              onChange={(e) =>
                updateSettings({
                  passwordReveal: {
                    ...settings.passwordReveal,
                    maskIcon: e.target.checked,
                  },
                })
              }
              className="sor-settings-checkbox"
            />
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
        <input
          type="checkbox"
          checked={settings.totpEnabled}
          onChange={(e) => updateSettings({ totpEnabled: e.target.checked })}
          className="sor-settings-checkbox"
        />
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
          <select
            value={settings.totpDigits}
            onChange={(e) =>
              updateSettings({ totpDigits: parseInt(e.target.value) })
            }
            className="sor-settings-select w-full text-sm"
          >
            <option value={6}>6 digits</option>
            <option value={8}>8 digits</option>
          </select>
        </div>

        <div data-setting-key="totpPeriod">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Period
          </label>
          <select
            value={settings.totpPeriod}
            onChange={(e) =>
              updateSettings({ totpPeriod: parseInt(e.target.value) })
            }
            className="sor-settings-select w-full text-sm"
          >
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
          </select>
        </div>

        <div data-setting-key="totpAlgorithm">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            Default Algorithm
          </label>
          <select
            value={settings.totpAlgorithm}
            onChange={(e) =>
              updateSettings({
                totpAlgorithm: e.target.value as "sha1" | "sha256" | "sha512",
              })
            }
            className="sor-settings-select w-full text-sm"
          >
            <option value="sha1">SHA-1</option>
            <option value="sha256">SHA-256</option>
            <option value="sha512">SHA-512</option>
          </select>
        </div>
      </div>
    </div>
  );
}
