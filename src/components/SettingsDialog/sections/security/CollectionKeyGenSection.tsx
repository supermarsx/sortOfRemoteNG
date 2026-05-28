import { Lock, Key, Loader2, FileKey, CheckCircle, Database, AlertTriangle } from "lucide-react";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function CollectionKeyGenSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-1">
            Generate Database Encryption Key File{" "}
            <InfoTooltip text="Create a cryptographic key file that can encrypt and decrypt your databases instead of using a password." />
          </span>
        }
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Generate a secure encryption key file that can be used to encrypt
          your databases. This key file can be used instead of a password
          when creating or opening encrypted databases.
        </p>

        <div className="flex items-start gap-2 px-3 py-2 bg-warning/10 border border-warning/40 rounded-md text-xs text-warning">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Keep this file secure — anyone with access to it can decrypt your
            databases.
          </span>
        </div>

        <SettingsSelectRow
          settingKey="databaseKeyLength"
          icon={<Key size={16} />}
          label="Key Strength"
          value={String(mgr.collectionKeyLength)}
          options={[
            { value: "32", label: "256-bit (Standard)" },
            { value: "64", label: "512-bit (High Security)" },
          ]}
          onChange={(v) => mgr.setCollectionKeyLength(Number(v) as 32 | 64)}
          infoTooltip="Bit length of the generated key — 256-bit is sufficient for most uses, 512-bit provides extra margin for high-security environments."
        />

        <div className="flex justify-end">
          <button
            onClick={mgr.generateCollectionKey}
            disabled={mgr.isGeneratingCollectionKey}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] text-[var(--color-text)] rounded-md transition-colors text-sm"
          >
            {mgr.isGeneratingCollectionKey ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating…</span>
              </>
            ) : (
              <>
                <FileKey className="w-4 h-4" />
                <span>Generate &amp; Save Database Key File</span>
              </>
            )}
          </button>
        </div>

        {mgr.collectionKeySuccess && (
          <div className="flex items-center gap-2 px-3 py-2 bg-primary/30 border border-primary/50 rounded-md text-primary text-sm">
            <CheckCircle className="w-4 h-4" />
            {mgr.collectionKeySuccess}
          </div>
        )}

        {mgr.collectionKeyError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-error/30 border border-error/50 rounded-md text-error text-sm">
            <Lock className="w-4 h-4" />
            {mgr.collectionKeyError}
          </div>
        )}
      </Card>
    </div>
  );
}

export default CollectionKeyGenSection;
