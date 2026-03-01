import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { Shield, ShieldAlert, Fingerprint, Trash2, Pencil, Network, Server } from "lucide-react";
import { Connection, RDPConnectionSettings } from "../../../types/connection";
import { CredsspOracleRemediationPolicies, NlaModes, TlsVersions, CredsspVersions } from "../../../types/connection";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Checkbox, Select } from "../../ui/forms";
const SecuritySection: React.FC<
  SectionBaseProps & {
    formData: Partial<Connection>;
    setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
    mgr: RDPOptionsMgr;
  }
> = ({ rdp, updateRdp, formData, setFormData, mgr }) => (
  <Section
    title="Security"
    icon={<Shield size={14} className="text-red-400" />}
  >
    {/* CredSSP Master Toggle */}
    <div className="pb-2 mb-2 border-b border-[var(--color-border)]/60">
      <label className={CSS.label}>
        <Checkbox checked={rdp.security?.useCredSsp ?? true} onChange={(v: boolean) => updateRdp("security", { useCredSsp: v })} className="CSS.checkbox" />
        <span className="font-medium">Use CredSSP</span>
      </label>
      <p className="text-xs text-[var(--color-textMuted)] ml-5 mt-0.5">
        Master toggle – when disabled, CredSSP/NLA is entirely skipped
        (TLS-only or plain RDP).
      </p>
    </div>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.enableNla ?? true} onChange={(v: boolean) => updateRdp("security", { enableNla: v })} className="CSS.checkbox" disabled={!(rdp.security?.useCredSsp ?? true)} />
      <span
        className={!(rdp.security?.useCredSsp ?? true) ? "opacity-50" : ""}
      >
        Enable NLA (Network Level Authentication)
      </span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.enableTls ?? true} onChange={(v: boolean) => updateRdp("security", { enableTls: v })} className="CSS.checkbox" />
      <span>Enable TLS (legacy graphical logon)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.autoLogon ?? false} onChange={(v: boolean) => updateRdp("security", { autoLogon: v })} className="CSS.checkbox" />
      <span>Auto logon (send credentials in INFO packet)</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.enableServerPointer ?? true} onChange={(v: boolean) => updateRdp("security", { enableServerPointer: v })} className="CSS.checkbox" />
      <span>Server-side pointer rendering</span>
    </label>

    <label className={CSS.label}>
      <Checkbox checked={rdp.security?.pointerSoftwareRendering ?? true} onChange={(v: boolean) => updateRdp("security", {
            pointerSoftwareRendering: v,
          })} className="CSS.checkbox" />
      <span>Software pointer rendering</span>
    </label>

    {/* CredSSP Remediation */}
    <div className="pt-3 mt-2 border-t border-[var(--color-border)]/60">
      <div className="flex items-center gap-2 mb-3 text-sm text-[var(--color-textSecondary)]">
        <ShieldAlert size={14} className="text-amber-400" />
        <span className="font-medium">CredSSP Remediation</span>
        <span className="text-xs text-[var(--color-textMuted)] ml-1">(CVE-2018-0886)</span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Encryption Oracle Remediation Policy
          </label>
          <Select value={rdp.security?.credsspOracleRemediation ?? ""} onChange={(v: string) =>
              updateRdp("security", {
                credsspOracleRemediation:
                  v === ""
                    ? undefined
                    : (v as (typeof CredsspOracleRemediationPolicies)[number]),
              })} options={[{ value: '', label: 'Use global default' }, ...CredsspOracleRemediationPolicies.map((p) => ({ value: p, label: p === "force-updated"
                  ? "Force Updated Clients"
                  : p === "mitigated"
                    ? "Mitigated (recommended)"
                    : "Vulnerable (allow all)" }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            NLA Mode
          </label>
          <Select value={rdp.security?.enableNla === false ? "disabled" : ""} onChange={(v: string) => {
              const mode = v as (typeof NlaModes)[number] | "";
              if (mode === "") {
                updateRdp("security", { enableNla: undefined });
              } else {
                updateRdp("security", { enableNla: mode !== "disabled" });
              }
            }} options={[{ value: '', label: 'Use global default' }, ...NlaModes.map((m) => ({ value: m, label: m === "required"
                  ? "Required (reject if NLA unavailable)"
                  : m === "preferred"
                    ? "Preferred (fallback to TLS)"
                    : "Disabled (TLS only)" }))]} className={CSS.select} />
        </div>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.allowHybridEx ?? false} onChange={(v: boolean) => updateRdp("security", { allowHybridEx: v })} className="CSS.checkbox" />
          <span>Allow HYBRID_EX protocol (Early User Auth Result)</span>
        </label>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.nlaFallbackToTls ?? true} onChange={(v: boolean) => updateRdp("security", { nlaFallbackToTls: v })} className="CSS.checkbox" />
          <span>Allow NLA fallback to TLS on failure</span>
        </label>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Minimum TLS Version
          </label>
          <Select value={rdp.security?.tlsMinVersion ?? ""} onChange={(v: string) =>
              updateRdp("security", {
                tlsMinVersion:
                  v === ""
                    ? undefined
                    : (v as (typeof TlsVersions)[number]),
              })} options={[{ value: '', label: 'Use global default' }, ...TlsVersions.map((v) => ({ value: v, label: `TLS ${v}` }))]} className={CSS.select} />
        </div>

        {/* Auth packages */}
        <div className="space-y-1">
          <span className="block text-xs text-[var(--color-textSecondary)]">
            Authentication Packages
          </span>
          {([
            ["ntlmEnabled", true, "NTLM"],
            ["kerberosEnabled", false, "Kerberos"],
            ["pku2uEnabled", false, "PKU2U"],
          ] as [string, boolean, string][]).map(([key, def, label]) => (
            <label key={key} className={CSS.label}>
              <Checkbox checked={(rdp.security?.[key as keyof NonNullable<RDPConnectionSettings["security"]>] as boolean | undefined) ?? def} onChange={(v: boolean) => updateRdp("security", { [key]: v })} className="CSS.checkbox" />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.restrictedAdmin ?? false} onChange={(v: boolean) => updateRdp("security", { restrictedAdmin: v })} className="CSS.checkbox" />
          <span>Restricted Admin (no credential delegation)</span>
        </label>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.remoteCredentialGuard ?? false} onChange={(v: boolean) => updateRdp("security", {
                remoteCredentialGuard: v,
              })} className="CSS.checkbox" />
          <span>Remote Credential Guard</span>
        </label>

        <label className={CSS.label}>
          <Checkbox checked={rdp.security?.enforceServerPublicKeyValidation ?? true} onChange={(v: boolean) => updateRdp("security", {
                enforceServerPublicKeyValidation: v,
              })} className="CSS.checkbox" />
          <span>Enforce server public key validation</span>
        </label>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            CredSSP Version
          </label>
          <Select value={rdp.security?.credsspVersion?.toString() ?? ""} onChange={(v: string) =>
              updateRdp("security", {
                credsspVersion:
                  v === ""
                    ? undefined
                    : (parseInt(v) as (typeof CredsspVersions)[number]),
              })} options={[{ value: '', label: 'Use global default' }, ...CredsspVersions.map((v) => ({ value: v.toString(), label: `TSRequest v${v}${" "}
                ${v === 6
                  ? "(latest, with nonce)"
                  : v === 3
                    ? "(with client nonce)"
                    : "(legacy)"}` }))]} className={CSS.select} />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            Server Certificate Validation
          </label>
          <Select value={rdp.security?.serverCertValidation ?? ""} onChange={(v: string) => updateRdp("security", {
                serverCertValidation:
                  v === ""
                    ? undefined
                    : (v as "validate" | "warn" | "ignore"),
              })} options={[{ value: "", label: "Use global default" }, { value: "validate", label: "Validate (reject untrusted)" }, { value: "warn", label: "Warn (prompt on untrusted)" }, { value: "ignore", label: "Ignore (accept all)" }]} className="CSS.select" />
        </div>

        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
            SSPI Package List Override
          </label>
          <input
            type="text"
            value={rdp.security?.sspiPackageList ?? ""}
            onChange={(e) =>
              updateRdp("security", {
                sspiPackageList: e.target.value || undefined,
              })
            }
            className={CSS.input}
            placeholder="e.g. !kerberos,!pku2u (leave empty for auto)"
          />
        </div>
      </div>
    </div>

    {/* Trust policy */}
    <div className="pt-2">
      <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
        Server Certificate Trust Policy
      </label>
      <Select value={formData.rdpTrustPolicy ?? ""} onChange={(v: string) => setFormData({
            ...formData,
            rdpTrustPolicy:
              v === ""
                ? undefined
                : (v as
                    | "tofu"
                    | "always-ask"
                    | "always-trust"
                    | "strict"),
          })} options={[{ value: "", label: "Use global default" }, { value: "tofu", label: "Trust On First Use (TOFU)" }, { value: "always-ask", label: "Always Ask" }, { value: "always-trust", label: "Always Trust (skip verification)" }, { value: "strict", label: "Strict (reject unless pre-approved)" }]} className="CSS.select" />
    </div>

    {/* Trusted certificates */}
    {mgr.hostRecords.length > 0 && (
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            <Fingerprint size={12} />
            Trusted Certificates ({mgr.hostRecords.length})
          </span>
          <button
            type="button"
            onClick={mgr.handleClearAllRdpTrust}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Clear All
          </button>
        </div>
        <div className="space-y-2">
          {mgr.hostRecords.map((r) => (
            <div
              key={r.identity.fingerprint}
              className="bg-[var(--color-background)] rounded p-2 text-xs font-mono"
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[var(--color-textSecondary)] truncate max-w-[200px]"
                  title={r.identity.fingerprint}
                >
                  {r.nickname ||
                    mgr.formatFingerprint(r.identity.fingerprint).slice(0, 32) +
                      "…"}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      mgr.setEditingNickname(r.identity.fingerprint);
                      mgr.setNicknameInput(r.nickname || "");
                    }}
                    className="text-[var(--color-textMuted)] hover:text-blue-400"
                    title="Edit nickname"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => mgr.handleRemoveTrust(r)}
                    className="text-[var(--color-textMuted)] hover:text-red-400"
                    title="Remove trust"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
              {mgr.editingNickname === r.identity.fingerprint && (
                <div className="mt-1 flex gap-1">
                  <input
                    type="text"
                    value={mgr.nicknameInput}
                    onChange={(e) => mgr.setNicknameInput(e.target.value)}
                    className="flex-1 px-1 py-0.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-xs"
                    placeholder="Nickname"
                  />
                  <button
                    type="button"
                    onClick={() => mgr.handleSaveNickname(r)}
                    className="text-xs text-green-400 hover:text-green-300"
                  >
                    Save
                  </button>
                </div>
              )}
              <div className="text-[var(--color-textMuted)] mt-1">
                First seen:{" "}
                {new Date(r.identity.firstSeen).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </Section>
);

export default SecuritySection;
