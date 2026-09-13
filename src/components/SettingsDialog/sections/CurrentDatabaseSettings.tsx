import { useRef, useState } from "react";
import { Database } from "lucide-react";
import { useCurrentDatabaseSettings } from "../../../hooks/settings/useCurrentDatabaseSettings";
import type { DatabaseSettings } from "../../../types/settings/databaseSettings";
import {
  DOCUMENT_TYPE_OPTIONS,
  isDocumentTypeEnabled,
  normalizeDatabaseSettings,
} from "../../../utils/documents/documentTypePolicy";
import { DatabaseManager } from "../../../utils/connection/databaseManager";
import SectionHeading from "../../ui/SectionHeading";
import { SettingsToggleRow } from "../../ui/settings/SettingsPrimitives";
import CurrentDatabaseSecuritySection, {
  type DatabaseSecurityCallbacks,
} from "./security/CurrentDatabaseSecuritySection";
import ConnectionRecycleBinSection from "./security/ConnectionRecycleBinSection";
import DatabaseCredentialVaultSection from "./security/DatabaseCredentialVaultSection";

export function DatabaseDocumentTypesSection() {
  const mgr = useCurrentDatabaseSettings();
  const key = JSON.stringify([mgr.scope, mgr.settings]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [draft, setDraft] = useState<{
    key: string;
    settings: DatabaseSettings;
  } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const value = draft?.key === key ? draft.settings : mgr.settings;
  const dirty =
    !!value && JSON.stringify(value) !== JSON.stringify(mgr.settings);
  const database = DatabaseManager.getInstance().getCurrentDatabase();
  return (
    <section
      data-setting-key="databaseDocumentTypes"
      className="sor-settings-card space-y-3"
    >
      <h3 className="text-sm font-medium">Document types</h3>
      <p className="text-sm text-[var(--color-textSecondary)]">
        Choose which content can be created, added or imported in this database.
        Disabling a type never deletes or hides existing records: they remain
        editable, exportable and removable. This preference does not replace
        document encryption or access protection.
      </p>
      {mgr.scope && (
        <p className="text-sm break-words">
          Database:{" "}
          <strong>
            {database?.id === mgr.scope.databaseId
              ? database.name
              : mgr.scope.databaseId}
          </strong>
        </p>
      )}
      {mgr.loading && <p role="status">Loading current database settings…</p>}
      {!mgr.loading && !value && !mgr.error && (
        <p className="text-sm">
          Open and unlock a database to change its document types. No
          application-wide default is written.
        </p>
      )}
      {value && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {DOCUMENT_TYPE_OPTIONS.map(({ type, label }) => (
              <SettingsToggleRow
                key={type}
                label={label}
                checked={isDocumentTypeEnabled(value, type)}
                disabled={mgr.loading || mgr.saving}
                onChange={(enabled) => {
                  setSaved(null);
                  setDraft({
                    key,
                    settings: {
                      version: 1,
                      documentTypes: {
                        disabled: enabled
                          ? value.documentTypes.disabled.filter(
                              (item) => item !== type,
                            )
                          : [...value.documentTypes.disabled, type],
                      },
                    },
                  });
                }}
              />
            ))}
          </div>
          <p className="text-xs text-[var(--color-textSecondary)]">
            People and tickets are workspace records; the other choices control
            document blocks. Preferences travel with database exports and
            copies. Older databases enable every type.
          </p>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            disabled={!dirty || mgr.loading || mgr.saving}
            onClick={async () => {
              const source = key;
              const proposed = normalizeDatabaseSettings(value);
              if (await mgr.save(proposed)) {
                // The hook already checked the owning lease before publishing success.
                if (currentKey.current === source) setDraft(null);
                setSaved(JSON.stringify([mgr.scope, proposed]));
              }
            }}
          >
            {mgr.saving ? "Saving database settings…" : "Save document types"}
          </button>
          {saved === key && (
            <p role="status" className="text-sm">
              Document types saved for this database.
            </p>
          )}
        </>
      )}
      {mgr.error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-error">
            {mgr.error}
          </p>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={mgr.loading || mgr.saving}
            onClick={() => void mgr.reload()}
          >
            Reload database settings
          </button>
        </div>
      )}
    </section>
  );
}

export default function CurrentDatabaseSettings({
  onOpenCredentialVault,
  ...callbacks
}: DatabaseSecurityCallbacks & { onOpenCredentialVault?: () => void }) {
  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Database className="w-5 h-5 text-primary" />}
        title="Current Database"
        description="Protection, document types, recycle-bin retention and credentials owned by the current database. Global encryption and application policies remain in Security."
      />
      <CurrentDatabaseSecuritySection {...callbacks} />
      <DatabaseDocumentTypesSection />
      <ConnectionRecycleBinSection />
      <DatabaseCredentialVaultSection onOpen={onOpenCredentialVault} />
    </div>
  );
}
