import { Lock, Key, Loader2, FileKey, CheckCircle, Database } from "lucide-react";
import type { Mgr } from "./types";
function CollectionKeyGenSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <h4 className="sor-section-heading">
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
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors"
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

export default CollectionKeyGenSection;
