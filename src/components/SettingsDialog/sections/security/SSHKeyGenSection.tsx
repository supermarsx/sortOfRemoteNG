import { Lock, Key, Loader2, FileKey, Download, CheckCircle } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function SSHKeyGenSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<FileKey className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            Generate SSH Key File{" "}
            <InfoTooltip text="Generate a new SSH public/private key pair and save both files to disk for use with SSH connections." />
          </span>
        }
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Generate a new SSH key pair and save it to a file. The private key
          is written to your chosen location and the public key is saved
          alongside it with a <code className="font-mono">.pub</code> extension.
        </p>

        <SettingsSelectRow
          settingKey="sshKeyType"
          icon={<Key size={16} />}
          label="Key Type"
          value={mgr.keyType}
          options={[
            { value: "ed25519", label: "Ed25519 (Recommended)" },
            { value: "rsa", label: "RSA 4096-bit (Broad compatibility)" },
          ]}
          onChange={(v) => mgr.setKeyType(v as "ed25519" | "rsa")}
          infoTooltip="Ed25519 is modern, fast, and recommended for most uses. RSA 4096-bit offers broader compatibility with older servers."
        />

        <div className="flex justify-end">
          <button
            onClick={mgr.generateSSHKey}
            disabled={mgr.isGeneratingKey}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors text-sm"
          >
            {mgr.isGeneratingKey ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating…</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Generate &amp; Save Key File</span>
              </>
            )}
          </button>
        </div>

        {mgr.keyGenSuccess && (
          <div className="flex items-center gap-2 px-3 py-2 bg-success/30 border border-success/50 rounded-md text-success text-sm">
            <CheckCircle className="w-4 h-4" />
            {mgr.keyGenSuccess}
          </div>
        )}

        {mgr.keyGenError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-error/30 border border-error/50 rounded-md text-error text-sm">
            <Lock className="w-4 h-4" />
            {mgr.keyGenError}
          </div>
        )}
      </Card>
    </div>
  );
}

export default SSHKeyGenSection;
