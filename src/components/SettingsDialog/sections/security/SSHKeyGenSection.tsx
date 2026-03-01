import { Lock, Key, Loader2, FileKey, Download, CheckCircle } from "lucide-react";
import type { Mgr } from "./types";
function SSHKeyGenSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <h4 className="sor-section-heading">
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
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors"
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

export default SSHKeyGenSection;
