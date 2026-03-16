import { Lock, Key, Loader2, FileKey, Download, CheckCircle } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import type { Mgr } from "./types";
function SSHKeyGenSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <h4 className="sor-section-heading">
        <FileKey className="w-4 h-4 text-success" />
        <span className="flex items-center gap-1">Generate SSH Key File <InfoTooltip text="Generate a new SSH public/private key pair and save both files to disk for use with SSH connections" /></span>
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
            <span className="flex items-center gap-1">Key Type <InfoTooltip text="Ed25519 is modern, fast, and recommended for most uses. RSA 4096-bit offers broader compatibility with older servers." /></span>
          </label>
          <div className="flex space-x-3">
            <button
              onClick={() => mgr.setKeyType("ed25519")}
              className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                mgr.keyType === "ed25519"
                  ? "bg-success/30 border border-success text-success"
                  : "bg-[var(--color-border)] border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
              }`}
            >
              Ed25519 (Recommended)
            </button>
            <button
              onClick={() => mgr.setKeyType("rsa")}
              className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                mgr.keyType === "rsa"
                  ? "bg-success/30 border border-success text-success"
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
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-success hover:bg-success/90 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors"
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
      </div>
    </div>
  );
}

export default SSHKeyGenSection;
