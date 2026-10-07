import React from "react";
import type {
  BrowserSessionRetention,
  BrowserSessionRetentionCapabilities,
} from "../../../../types/settings/browserSession";
import { resolveBrowserSessionRetention } from "../../../../utils/settings/browserSessionSettings";
import {
  BrowserNumberRow,
  BrowserSelectRow,
} from "../../BrowserSettingsFields";
import { Toggle } from "../../../ui/settings/SettingsPrimitives";

export default function BrowserSessionRetentionFields({
  value,
  onChange,
  settingPrefix = "webBrowser.sessionRetention",
  capabilities,
}: {
  value: BrowserSessionRetention;
  onChange: (value: BrowserSessionRetention) => void;
  settingPrefix?: string;
  capabilities?: BrowserSessionRetentionCapabilities;
}) {
  const resolution = resolveBrowserSessionRetention(value, capabilities);
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Each browser attempt has its own session, scoped to its owning database
        and connection. Browser profiles cannot be shared. Retention never
        grants permission to send credentials.
      </p>
      <BrowserSelectRow
        settingKey={`${settingPrefix}.mode`}
        label="Requested cookie retention"
        description="Applies to new attempts when supported by the runtime. Ephemeral is the default."
        value={value.mode}
        options={[
          {
            value: "ephemeral",
            label: "Ephemeral — clear cookies when closed",
          },
          { value: "memory", label: "Memory — cookies until application exit" },
          {
            value: "encrypted-database",
            label: "Sign-in cookies in this encrypted database",
          },
        ]}
        onChange={(mode) =>
          onChange({ ...value, mode: mode as BrowserSessionRetention["mode"] })
        }
      />
      {!resolution.supported && (
        <p role="status" className="sor-alert-warning text-sm">
          {value.mode === "memory" ? "Memory" : "Encrypted database"} retention
          is configured but runtime support has not been confirmed. The runtime
          must use ephemeral storage until support is available; saving this
          preference does not activate retention.
        </p>
      )}
      {resolution.supported && resolution.reason && (
        <p role="status" className="sor-alert-warning text-sm">
          {resolution.reason}
        </p>
      )}
      <p className="text-xs text-[var(--color-textMuted)]">
        Only cookies can be retained; localStorage and IndexedDB are not
        included. This does not preserve a full browser profile. Memory keeps
        cookies in RAM only. When database retention is supported, sign-in
        cookies are stored inside the owning encrypted database, protected by
        its key and included in that database's sync and exports. Restore
        requires unlocking the owning database, and creates a fresh isolated
        attempt for the same connection. Database lock always stops live browser
        attempts; retained cookies may remain encrypted for the next unlock.
      </p>
      <p className="text-xs text-[var(--color-textMuted)]">
        Updating an older retention setting configures database retention; it
        does not confirm that previously retained cookie data has been migrated.
      </p>
      <p className="text-xs text-[var(--color-textMuted)]">
        Changing to ephemeral clears previously retained cookies on the next
        connection startup. Saving this preference does not immediately erase
        existing cookie snapshots.
      </p>
      {capabilities?.policyExpiration === true && (
        <>
          <BrowserNumberRow
            settingKey={`${settingPrefix}.idleTimeoutMinutes`}
            label="Retained session idle expiry (minutes)"
            description="0 clears retained data when the attempt closes; maximum 7 days."
            value={value.idleTimeoutMinutes}
            min={0}
            max={10080}
            onChange={(idleTimeoutMinutes) =>
              onChange({ ...value, idleTimeoutMinutes })
            }
          />
          <BrowserNumberRow
            settingKey={`${settingPrefix}.maxAgeHours`}
            label="Retained session maximum age (hours)"
            description="Absolute lifetime of retained data, from 1 hour to 1 year."
            value={value.maxAgeHours}
            min={1}
            max={8760}
            onChange={(maxAgeHours) => onChange({ ...value, maxAgeHours })}
          />
        </>
      )}
      {capabilities?.clearOnDatabaseLock === true && (
        <Toggle
          settingKey={`${settingPrefix}.clearOnDatabaseLock`}
          label="Clear retained cookies when the database locks"
          description="Locking always closes live attempts. This also removes retained cookie snapshots."
          checked={value.clearOnDatabaseLock}
          onChange={(clearOnDatabaseLock) =>
            onChange({ ...value, clearOnDatabaseLock })
          }
        />
      )}
    </div>
  );
}
