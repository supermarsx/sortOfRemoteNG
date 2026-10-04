import { useEffect, useId, useRef, useState } from "react";
import { CloudDownload, Database, Loader2, RefreshCw } from "lucide-react";
import { useSettings } from "../../../../contexts/SettingsContext";
import type {
  DatabaseProtectionCapabilities,
  DatabaseProtectionTarget,
} from "../../../../types/encryption/databaseProtection";
import type { CloudSyncTarget } from "../../../../types/settings/cloudSyncSettings";
import { databaseProtection } from "../../../../utils/connection/databaseProtection";
import { formatDatabaseBytes } from "../../../../utils/connection/databaseSize";
import { FullDatabaseRestoreIncompleteError } from "../../../../utils/connection/fullDatabaseArchive";
import {
  passwordPolicyError,
  validateNewPassword,
} from "../../../../utils/security/passwordPolicy";
import {
  discoverRemoteDatabases,
  pullRemoteDatabase,
  sameRemoteDatabaseSource,
  type RemoteDatabaseCatalog,
} from "../../../../utils/services/cloudSyncRemoteDatabases";
import {
  Checkbox,
  FormField,
  PasswordInput,
  Select,
  TextInput,
} from "../../../ui/forms";
import {
  Card,
  SettingsSectionHeader,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

type RemoteDatabase = RemoteDatabaseCatalog["databases"][number];
type PullOptions = {
  name: string;
  protectionTarget: DatabaseProtectionTarget;
  confirmDeviceBoundOnly?: boolean;
};
const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50 disabled:cursor-not-allowed";

function PullDatabaseForm({
  database,
  disabled,
  onPull,
  onCancel,
}: {
  database: RemoteDatabase;
  disabled: boolean;
  onPull: (options: PullOptions, addToSync: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const { settings } = useSettings();
  const [name, setName] = useState(
    database.nameAvailable ? database.label : "",
  );
  const [protection, setProtection] = useState("password");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deviceBound, setDeviceBound] = useState(false);
  const [addToSync, setAddToSync] = useState(true);
  const [capabilities, setCapabilities] =
    useState<DatabaseProtectionCapabilities | null>(null);
  const [capabilityFailed, setCapabilityFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const submitted = useRef(false);
  useEffect(() => {
    let current = true;
    setCapabilityFailed(false);
    void databaseProtection
      .capabilities()
      .then((result) => {
        if (current) setCapabilities(result);
      })
      .catch(() => {
        if (current) setCapabilityFailed(true);
      });
    return () => {
      current = false;
    };
  }, [retry]);
  const cipherAvailable = capabilities?.ciphers.some(
    (cipher) => cipher.id === "aes-256-gcm" && cipher.available,
  );
  const supports = (type: string) =>
    Boolean(
      cipherAvailable &&
      capabilities?.protectors.some(
        (protector) => protector.id === type && protector.available,
      ),
    );
  let passwordError: string | null = null;
  try {
    passwordError =
      [...password].length < 12 || [...password].length > 1024
        ? "Use 12–1024 characters for the local unlock password."
        : passwordPolicyError(password, settings.passwordPolicy, "database");
  } catch {
    passwordError =
      "Review the password policy in Security settings before pulling.";
  }
  const valid =
    Boolean(name.trim()) &&
    supports(protection) &&
    (protection === "password"
      ? !passwordError && password === confirmation
      : deviceBound);
  return (
    <form
      aria-label={`Pull ${database.label}`}
      className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || submitted.current || !valid) return;
        submitted.current = true;
        void onPull(
          {
            name: name.trim(),
            protectionTarget: {
              dataCipher: "aes-256-gcm",
              keepSlotIds: [],
              newSlots:
                protection === "password"
                  ? [
                      {
                        type: "password",
                        label: "Local unlock password",
                        password,
                      },
                    ]
                  : [{ type: "os-vault", label: "This device's OS vault" }],
            },
            ...(protection === "os-vault"
              ? { confirmDeviceBoundOnly: deviceBound }
              : {}),
          },
          addToSync,
        ).finally(() => {
          submitted.current = false;
          setPassword("");
          setConfirmation("");
        });
      }}
    >
      <fieldset disabled={disabled} className="space-y-4 min-w-0">
        <legend className="text-sm font-medium mb-3">
          Local copy of {database.label}
        </legend>
        {!database.nameAvailable && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            Older snapshots store the database ID without its display name.
            Choose a local name; its sync identity stays unchanged.
          </p>
        )}
        <FormField label="Local database name" htmlFor={`${id}-name`}>
          <TextInput
            id={`${id}-name`}
            variant="settings"
            className="w-full"
            maxLength={256}
            value={name}
            onChange={setName}
            required
          />
        </FormField>
        <FormField label="Local unlock protection" htmlFor={`${id}-protection`}>
          <Select
            id={`${id}-protection`}
            label="Local unlock protection"
            value={protection}
            className="w-full"
            options={[
              {
                value: "password",
                label: "Password",
                disabled: !supports("password"),
              },
              {
                value: "os-vault",
                label: supports("os-vault")
                  ? "OS vault (this device)"
                  : "OS vault (unavailable on this device)",
                disabled: !supports("os-vault"),
              },
            ]}
            onChange={(value) => {
              setProtection(value);
              setPassword("");
              setConfirmation("");
              setDeviceBound(false);
            }}
          />
        </FormField>
        {!capabilities && !capabilityFailed && (
          <p role="status">Checking local protection…</p>
        )}
        {capabilityFailed && (
          <div role="alert" className="text-sm text-error">
            Could not check local protection. Use the desktop app and retry.{" "}
            <button
              type="button"
              className={buttonClass}
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry protection check
            </button>
          </div>
        )}
        {capabilities && !cipherAvailable && (
          <p role="alert" className="text-sm text-error">
            AES-256-GCM protection is unavailable in this build. Update the
            desktop app before pulling.
          </p>
        )}
        <p className="text-xs text-[var(--color-textSecondary)]">
          This protects the new local database only. The cloud encryption
          password belongs in Encryption settings and is not copied into this
          form. The database will not be opened automatically.
        </p>
        {protection === "password" ? (
          <>
            <FormField label="Local unlock password" htmlFor={`${id}-password`}>
              <PasswordInput
                id={`${id}-password`}
                className="sor-settings-input w-full"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Confirm local unlock password"
              htmlFor={`${id}-confirmation`}
            >
              <PasswordInput
                id={`${id}-confirmation`}
                className="sor-settings-input w-full"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </FormField>
            {passwordError && (
              <p className="text-xs text-[var(--color-textSecondary)]">
                {passwordError}
              </p>
            )}
            {confirmation && confirmation !== password && (
              <p className="text-xs text-error">
                The local unlock passwords do not match.
              </p>
            )}
          </>
        ) : (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={deviceBound} onChange={setDeviceBound} />
            <span>
              I understand this local copy can only be unlocked using this
              device's OS vault. Keep the cloud encryption password for recovery
              on another device.
            </span>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={addToSync} onChange={setAddToSync} />
          <span>Add to What to Sync after pulling</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={buttonClass}
            disabled={disabled || !valid}
          >
            <CloudDownload className="w-4 h-4" aria-hidden="true" />
            Pull database
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setPassword("");
              setConfirmation("");
              onCancel();
            }}
          >
            Cancel pull
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/** Kept per target so changing targets discards the catalog and local secrets. */
function RemoteDatabaseSource({
  mgr,
  target,
}: {
  mgr: Mgr;
  target: CloudSyncTarget;
}) {
  const latest = useRef({ mgr, target });
  latest.current = { mgr, target };
  const source = useRef({
    target: structuredClone(target),
    config: structuredClone(mgr.cloudSync),
  });
  const lifecycle = useRef({ generation: 0 });
  const mounted = useRef(false);
  const running = useRef(false);
  const [busy, setBusy] = useState<"refresh" | "pull" | null>(null);
  const [catalog, setCatalog] = useState<RemoteDatabaseCatalog | null>(null);
  const [selected, setSelected] = useState<RemoteDatabase | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const sourceMatches = sameRemoteDatabaseSource(
    source.current.target,
    source.current.config,
    target,
    mgr.cloudSync,
  );
  useEffect(() => {
    const state = lifecycle.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      state.generation++;
    };
  }, []);
  useEffect(() => {
    if (
      sameRemoteDatabaseSource(
        source.current.target,
        source.current.config,
        target,
        mgr.cloudSync,
      )
    )
      return;
    lifecycle.current.generation++;
    source.current = {
      target: structuredClone(target),
      config: structuredClone(mgr.cloudSync),
    };
    setCatalog(null);
    setSelected(null);
    setError("");
    setStatus(
      "Sync source changed. Refresh remote databases to review the current snapshot.",
    );
  }, [target, mgr.cloudSync]);

  const start = () => {
    if (
      running.current ||
      latest.current.mgr.isBusy ||
      !latest.current.target.enabled
    )
      return null;
    running.current = true;
    const request = ++lifecycle.current.generation;
    const savedTarget = structuredClone(latest.current.target);
    const config = structuredClone(latest.current.mgr.cloudSync);
    const current = () =>
      mounted.current &&
      request === lifecycle.current.generation &&
      latest.current.target.enabled &&
      sameRemoteDatabaseSource(
        savedTarget,
        config,
        latest.current.target,
        latest.current.mgr.cloudSync,
      );
    return {
      target: savedTarget,
      config,
      current,
      assertCurrent: () => {
        if (!current())
          throw new Error(
            "Remote database source changed; refresh before pulling.",
          );
      },
    };
  };
  const finish = () => {
    running.current = false;
    if (mounted.current) setBusy(null);
  };
  const refresh = async () => {
    const operation = start();
    if (!operation) return;
    setBusy("refresh");
    setError("");
    setStatus("");
    setSelected(null);
    setCatalog(null);
    try {
      const result = await discoverRemoteDatabases(
        operation.target,
        operation.config,
        operation.assertCurrent,
      );
      operation.assertCurrent();
      setCatalog(result);
    } catch {
      if (operation.current())
        setError(
          "Could not read remote databases. Check the target credentials, cloud encryption password and size limit, then refresh. No local selection was changed.",
        );
    } finally {
      finish();
    }
  };
  const pull = async (options: PullOptions, addToSync: boolean) => {
    if (!catalog || !selected || selected.existsLocally || !sourceMatches)
      return;
    const operation = start();
    if (!operation) return;
    setBusy("pull");
    setError("");
    setStatus("");
    let attemptedPull = false;
    try {
      const passwordSlot = options.protectionTarget.newSlots.find(
        (slot) => slot.type === "password",
      );
      if (passwordSlot?.type === "password")
        await validateNewPassword(passwordSlot.password, "database");
      operation.assertCurrent();
      attemptedPull = true;
      const created = await pullRemoteDatabase(
        operation.target,
        operation.config,
        catalog,
        selected.id,
        { ...options, assertCurrent: operation.assertCurrent },
      );
      operation.assertCurrent();
      // Catalogs carry an opaque receipt. Never clone one to edit local state;
      // selecting the imported artifact can also invalidate that receipt.
      setCatalog(null);
      // Merge the latest selection, not the one captured before the download.
      if (addToSync)
        latest.current.mgr.updateCloudSync({
          selectedItems: [
            ...new Set([
              ...(latest.current.mgr.cloudSync.selectedItems ?? []),
              `database:${created.id}`,
            ]),
          ],
        });
      setStatus(
        `Pulled ${created.name}. It is available in Databases; your current database was not changed. Refresh to pull another database.`,
      );
    } catch (failure) {
      if (operation.current()) {
        setCatalog(null);
        setError(
          failure instanceof FullDatabaseRestoreIncompleteError
            ? failure.message
            : attemptedPull
              ? "Pull could not finish. A local copy may have been created; check Databases and refresh this list before retrying. Existing databases are not overwritten. If the remote snapshot changed, review the refreshed list."
              : "The local unlock password could not be validated. Review the password policy in Security settings, then refresh and try again. No pull was started.",
        );
      }
    } finally {
      if (mounted.current) setSelected(null);
      finish();
    }
  };
  // Global activity includes our own request: it disables controls, never the
  // in-flight ownership guard or result handling.
  const disabled = Boolean(busy) || mgr.isBusy;
  const visibleCatalog = sourceMatches ? catalog : null;
  return (
    <div className="space-y-4">
      <button
        type="button"
        className={buttonClass}
        disabled={disabled}
        onClick={() => void refresh()}
      >
        {busy === "refresh" ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
        )}
        Refresh remote databases
      </button>
      {busy && (
        <p role="status" className="text-sm">
          {busy === "pull" ? "Pulling database…" : "Reading remote snapshot…"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm text-[var(--color-textSecondary)]">
          {status}
        </p>
      )}
      {visibleCatalog && (
        <>
          {visibleCatalog.modifiedAt !== null && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              Remote snapshot:{" "}
              {new Date(visibleCatalog.modifiedAt).toLocaleString()}
            </p>
          )}
          {visibleCatalog.databases.length === 0 ? (
            <p className="text-sm text-[var(--color-textSecondary)]">
              {visibleCatalog.revision === null
                ? "No cloud snapshot was found on this target yet."
                : "This remote snapshot contains no databases."}
            </p>
          ) : (
            <ul
              aria-label={`Remote databases on ${target.label}`}
              className="space-y-2 max-h-80 overflow-y-auto"
            >
              {visibleCatalog.databases.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded border border-[var(--color-border)] p-3 text-sm"
                >
                  <Database
                    className="w-4 h-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 break-words">
                    <p>{item.label}</p>
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      {item.id} · {formatDatabaseBytes(item.bytes)} ·{" "}
                      {item.existsLocally
                        ? "Already on this device"
                        : "Not on this device"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={disabled || item.existsLocally}
                    aria-label={`Prepare pull for ${item.label}`}
                    onClick={() => {
                      setSelected(item);
                      setError("");
                      setStatus("");
                    }}
                  >
                    Pull…
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {selected && sourceMatches && (
        <PullDatabaseForm
          key={selected.id}
          database={selected}
          disabled={disabled}
          onPull={pull}
          onCancel={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export default function RemoteDatabasesSection({ mgr }: { mgr: Mgr }) {
  const [targetId, setTargetId] = useState("");
  const targets = (mgr.syncTargets ?? []).filter(
    (target) => target.enabled && target.provider !== "none",
  );
  const target = targets.find(
    (item) => item.id === (targetId || targets[0]?.id),
  );
  return (
    <section
      aria-label="Remote databases"
      className="space-y-4"
      data-setting-key="cloudSync.remoteDatabases"
    >
      <SettingsSectionHeader
        icon={<CloudDownload className="w-4 h-4 text-primary" />}
        title="Remote databases"
      />
      <Card>
        <p className="text-sm text-[var(--color-textSecondary)]">
          Find databases synced from another device and pull a protected local
          copy. Refresh is read-only and does not require any local database or
          What to Sync selection. Existing databases are never replaced.
        </p>
        <Select
          label="Remote database sync target"
          searchable
          placeholder="Choose an enabled sync target"
          value={target?.id ?? ""}
          options={targets.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          onChange={setTargetId}
          className="w-full"
        />
        {!mgr.cloudSync.enabled && (
          <p className="text-sm text-[var(--color-textSecondary)]">
            Automatic cloud sync is off. You can still refresh and pull manually
            from an enabled target.
          </p>
        )}
        {!targets.length && (
          <p className="text-sm text-[var(--color-textSecondary)]">
            Add and enable a sync target above to discover its databases.
          </p>
        )}
        {target && (
          <RemoteDatabaseSource key={target.id} mgr={mgr} target={target} />
        )}
      </Card>
    </section>
  );
}
