import { Lock, Key, Loader2, FileKey, Download, CheckCircle } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
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

        {/* Key Type — selection-card row matching the row-label style. */}
        <div data-setting-key="sshKeyType" className="space-y-2">
          <span className="sor-settings-row-label flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] mr-1">
              <Key size={16} />
            </span>
            Key Type
            <InfoTooltip text="Ed25519 is modern, fast, and recommended for most uses. RSA 4096-bit offers broader compatibility with older servers." />
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => mgr.setKeyType("ed25519")}
              className={`flex flex-col items-center p-3 rounded-lg border text-sm transition-all ${
                mgr.keyType === "ed25519"
                  ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                  : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
              }`}
            >
              <Key
                className={`w-5 h-5 mb-1 ${
                  mgr.keyType === "ed25519" ? "text-primary" : ""
                }`}
              />
              <span className="font-medium">Ed25519</span>
              <span className="text-xs text-[var(--color-textSecondary)] mt-1">
                Recommended
              </span>
            </button>
            <button
              type="button"
              onClick={() => mgr.setKeyType("rsa")}
              className={`flex flex-col items-center p-3 rounded-lg border text-sm transition-all ${
                mgr.keyType === "rsa"
                  ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                  : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
              }`}
            >
              <Lock
                className={`w-5 h-5 mb-1 ${
                  mgr.keyType === "rsa" ? "text-primary" : ""
                }`}
              />
              <span className="font-medium">RSA 4096</span>
              <span className="text-xs text-[var(--color-textSecondary)] mt-1">
                Broad compatibility
              </span>
            </button>
          </div>
        </div>

        <button
          onClick={mgr.generateSSHKey}
          disabled={mgr.isGeneratingKey}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors"
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
