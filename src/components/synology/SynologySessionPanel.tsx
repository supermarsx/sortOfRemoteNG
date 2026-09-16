import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { PackageX, CircleHelp, X, ShieldCheck, ShieldOff } from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  normalizeSynologySettings,
  assertSynologyNativeRoute,
  isSynologyFileConnection,
} from "../../types/protocols/synology";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import {
  DatabaseManager,
  onDatabaseAccessChange,
} from "../../utils/connection/databaseManager";
import { ENCRYPTION_EVENT_LOCKED } from "../../types/encryption/encryption";
import { getInvoke } from "../../utils/tauri/invoke";
import { useSynologyFileConnection } from "../../hooks/synology/useSynologyFileConnection";
import { registerSynologySession } from "../../utils/session/synologySessionLifecycle";
import {
  getRuntimeProtocolUnavailableMessage,
  loadRuntimeCapabilities,
  type RuntimeCapabilities,
} from "../../utils/runtime/runtimeCapabilities";
import { SynologySessionContent } from "./SynologyPanel";
import { resolveHttpBasicCredentials } from "../../utils/auth/httpCredentials";
import SynologyInitializationStatus from "./synologyPanel/SynologyInitializationStatus";
import { useRuntimeCredentialVault } from "../../hooks/security/useRuntimeCredentialVault";
import { useRuntimeVaultTotp } from "../../hooks/security/useRuntimeVaultTotp";
import {
  DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
  DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
  DEVICE_TRUST_VAULT_REQUIRED_MESSAGE,
} from "../../utils/security/runtimeCredentialVault";
import type { SynologyDeviceTrustAdapter } from "../../types/hardware/synologyFileStation";
import {
  generateSynologyTotpCode,
  resolveLocalSynologyAuthenticator,
  SYNOLOGY_AUTOMATIC_CODE_UNAVAILABLE_MESSAGE,
  waitForSynologyTotpWindow,
} from "../../utils/synology/synologyAuthenticator";

const unavailable =
  "Open and unlock this session's owning database, then reopen the Synology connection.";

function RuntimeUnavailable({
  capabilities,
  onClose,
}: {
  capabilities: RuntimeCapabilities;
  onClose?: () => void;
}) {
  const unknown = capabilities.source !== "native";
  const titleId = useId();
  const Icon = unknown ? CircleHelp : PackageX;
  const missing = [
    capabilities.ops !== true ? "ops" : null,
    capabilities.platform !== true ? "platform" : null,
  ].filter(Boolean);
  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      className="flex h-full min-h-0 items-center justify-center overflow-auto p-6"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-warning/10 p-2 text-warning">
            <Icon size={24} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--color-textSecondary)] mb-1">
              Synology NAS API
            </p>
            <h2 id={titleId} className="text-lg font-semibold">
              {unknown
                ? "Desktop capabilities unavailable"
                : "Feature unavailable in this build"}
            </h2>
          </div>
        </div>
        <p className="text-sm text-[var(--color-textSecondary)]">
          {unknown
            ? "The app could not verify the running desktop's native capabilities. This is not a NAS login or network failure."
            : "This running desktop does not report the native features required for Synology NAS API. Your saved connection is unchanged; no NAS sign-in was attempted."}
        </p>
        {!unknown && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            Required build capabilities not reported:{" "}
            <code>{missing.join(", ")}</code>.
          </p>
        )}
        <div className="rounded-lg bg-[var(--color-background)] p-3 text-sm space-y-2">
          <p>
            {unknown
              ? "Open the installed desktop app, or update/reinstall it if this message persists."
              : "Use the current full desktop build. If developing, stop the existing desktop process and relaunch with:"}
          </p>
          {!unknown && (
            <code className="block select-text break-all text-xs">
              npm run tauri:dev
            </code>
          )}
          <p className="text-xs text-[var(--color-textSecondary)]">
            Restarting with the correct binary is required. Reloading this page
            or retrying NAS credentials cannot add compiled capabilities.
            Explicit reduced builds must include both ops and platform.
          </p>
        </div>
        {onClose && (
          <div className="flex justify-end">
            <button className="sor-btn sor-btn-secondary" onClick={onClose}>
              <X size={14} />
              Close session
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function BoundSynologySession({
  session,
  saved,
  connections,
  onClose,
}: {
  session: ConnectionSession;
  saved: Connection;
  connections: Connection[];
  onClose?: () => void;
}) {
  const { dispatch, databaseAvailability } = useConnections();
  const [revoked, setRevoked] = useState(false);
  const revokedRef = useRef(false);
  const latest = useRef({ saved, connections, databaseAvailability });
  latest.current = { saved, connections, databaseAvailability };
  const access = useMemo(() => {
    try {
      const check = captureSessionDatabaseAccess(session);
      const original = saved;
      const generation = databaseAvailability?.generation;
      return () => {
        check();
        if (
          revokedRef.current ||
          latest.current.saved !== original ||
          latest.current.databaseAvailability?.status !== "ready" ||
          latest.current.databaseAvailability?.generation !== generation
        )
          throw new Error(unavailable);
        // Fail closed on the saved target and every ancestor's explicit route/trust.
        let candidate: Connection | undefined = original;
        const visited = new Set<string>();
        while (candidate) {
          if (visited.has(candidate.id))
            throw new Error("Invalid connection ancestry.");
          visited.add(candidate.id);
          assertSynologyNativeRoute(candidate);
          const parent: string | undefined = candidate.parentId;
          candidate = parent
            ? latest.current.connections.find((entry) => entry.id === parent)
            : undefined;
          if (parent && !candidate)
            throw new Error("The connection's parent is unavailable.");
        }
      };
    } catch {
      return null;
    }
    // A mounted session never adopts a different saved connection or access lease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  let issue: string | null = null;
  try {
    if (!access || revoked) throw new Error(unavailable);
    access();
  } catch (error) {
    issue = error instanceof Error ? error.message : unavailable;
  }
  const settings = normalizeSynologySettings(saved.synologySettings);
  const vault = saved.credentialSource?.kind === "vault";
  const resolveVault = useRuntimeCredentialVault(session, saved);
  const vaultTotp = useRuntimeVaultTotp(session, saved);
  const latestTotp = useRef(vaultTotp);
  latestTotp.current = vaultTotp;
  const totpId =
    saved.credentialSource?.kind === "vault"
      ? saved.credentialSource.totpId
      : undefined;
  const resolveCredentials = useCallback(
    async (assertAttempt: () => void) => {
      const value = await resolveVault(assertAttempt);
      if (!value)
        throw new Error("The selected vault credential is unavailable.");
      try {
        value.assertCurrent();
        return {
          username: value.facets.username ?? "",
          password: value.facets.password ?? "",
          assertCurrent: value.assertCurrent,
        };
      } finally {
        value.facets = {};
      }
    },
    [resolveVault],
  );
  const resolveOtp = useCallback(
    async (assertAttempt: () => void, { replayKey }: { replayKey: string }) => {
      assertAttempt();
      if (!totpId)
        throw new Error(
          "Select a vault authenticator before automatic NAS verification.",
        );
      // Metadata only: the period decides whether to wait for a fresh window.
      const entries = await latestTotp.current.load();
      assertAttempt();
      const matches = entries.filter((entry) => entry.id === totpId);
      if (matches.length !== 1)
        throw new Error("The chosen vault authenticator is unavailable.");
      await waitForSynologyTotpWindow(
        { period: matches[0].period, replayKey },
        assertAttempt,
      );
      const value = await latestTotp.current.generate(totpId);
      assertAttempt();
      value.assertCurrent();
      return value;
    },
    [totpId],
  );
  // A local reference only counts for local credentials; the vault keeps `totpId`.
  const localAuthenticator = resolveLocalSynologyAuthenticator(saved).kind;
  const resolveLocalOtp = useCallback(
    async (assertAttempt: () => void, { replayKey }: { replayKey: string }) => {
      assertAttempt();
      const authenticator = resolveLocalSynologyAuthenticator(saved);
      if (authenticator.kind !== "ready")
        throw new Error(SYNOLOGY_AUTOMATIC_CODE_UNAVAILABLE_MESSAGE);
      const { secret, algorithm, digits, period } = authenticator.config;
      return generateSynologyTotpCode(
        { secret, algorithm, digits: digits as 6 | 8, period, replayKey },
        assertAttempt,
      );
    },
    [saved],
  );
  // A fresh vault controller per call: each one is bound to the vault revision
  // it opened, and a store or forget advances that revision.
  const deviceTrust = useMemo<SynologyDeviceTrustAdapter | undefined>(() => {
    if (!vault) return undefined;
    const open = async (assertAttempt: () => void) => {
      const value = await resolveVault(assertAttempt, false, "deviceTrust");
      if (!value?.deviceTrust)
        throw new Error("The selected vault credential is unavailable.");
      return value.deviceTrust;
    };
    return {
      resolve: async (assertAttempt, account) =>
        (await open(assertAttempt)).resolve(account),
      store: async (assertAttempt, account, device) => {
        try {
          return await (await open(assertAttempt)).store(account, device);
        } catch {
          return {
            status: "not-saved",
            message: DEVICE_TRUST_NOT_REMEMBERED_MESSAGE,
          };
        }
      },
      forget: async (assertAttempt, account) => {
        try {
          return await (await open(assertAttempt)).forget(account);
        } catch {
          return {
            status: "not-saved",
            message: DEVICE_TRUST_NOT_FORGOTTEN_MESSAGE,
          };
        }
      },
    };
  }, [vault, resolveVault]);
  const credentials = vault
    ? null
    : resolveHttpBasicCredentials({
        ...saved,
        authType: "basic",
      });
  const connection = useSynologyFileConnection(!issue, {
    instanceId: session.id,
    initialConfig: {
      host: saved.hostname,
      port: saved.port,
      username: credentials?.username ?? "",
      password: credentials?.password ?? "",
      useHttps:
        saved.protocol === "synology"
          ? settings.useHttps
          : saved.protocol === "https",
    },
    assertCurrent: access ?? undefined,
    resolveCredentials: vault ? resolveCredentials : undefined,
    // An unusable local reference still answers, so the code dialog explains it.
    resolveOtp: vault
      ? totpId
        ? resolveOtp
        : undefined
      : localAuthenticator !== "none"
        ? resolveLocalOtp
        : undefined,
    deviceTrust,
    trustDevice: settings.trustDevice === true,
    deviceTrustUnavailable: vault
      ? undefined
      : DEVICE_TRUST_VAULT_REQUIRED_MESSAGE,
  });
  const runtime = useRef(connection);
  runtime.current = connection;
  useEffect(
    () =>
      registerSynologySession(session.id, () => runtime.current.disconnect()),
    [session.id],
  );
  useEffect(() => {
    let disposed = false;
    let offNative: (() => void) | undefined;
    const revoke = () => {
      if (disposed) return;
      revokedRef.current = true;
      setRevoked(true);
      void runtime.current.disconnect().catch(() => undefined);
    };
    const offAccess = onDatabaseAccessChange((event) => {
      if (
        event.databaseId === session.ownerDatabaseId &&
        event.status === "suspended"
      )
        revoke();
    });
    const offCurrent = DatabaseManager.getInstance().onCurrentDatabaseChange(
      () => {
        try {
          if (!access) throw new Error();
          access();
        } catch {
          revoke();
        }
      },
    );
    void getInvoke()
      .then(async (invoke) => {
        if (!invoke || disposed) return;
        const off = await listen(ENCRYPTION_EVENT_LOCKED, revoke);
        if (disposed) off();
        else offNative = off;
      })
      .catch(revoke);
    return () => {
      disposed = true;
      offAccess();
      offCurrent();
      offNative?.();
    };
  }, [access, session.ownerDatabaseId]);
  useEffect(() => {
    dispatch({
      type: "UPDATE_SESSION",
      payload: {
        id: session.id,
        status: issue ? "disconnected" : connection.connectionStatus,
        errorMessage: issue ?? connection.connectionError ?? undefined,
      },
    });
  }, [
    dispatch,
    session.id,
    connection.connectionStatus,
    connection.connectionError,
    issue,
  ]);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [capabilityReady, setCapabilityReady] = useState(false);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(
    null,
  );
  const initialAttemptStarted = useRef(false);
  useEffect(() => {
    let disposed = false;
    void loadRuntimeCapabilities().then((caps) => {
      if (disposed) return;
      const error = getRuntimeProtocolUnavailableMessage("synology", caps);
      setCapabilities(caps);
      setCapabilityError(error);
    });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!capabilities || initialAttemptStarted.current) return;
    initialAttemptStarted.current = true;
    // Connect only from the render following capability validation. Strict Mode
    // replays mount cleanup, which revokes the connection hook's old handlers;
    // calling one directly from the initial promise would silently do nothing.
    // This remains a single initial attempt, never an automatic auth retry.
    if (!capabilityError && !issue) void runtime.current.connect();
    setCapabilityReady(true);
  }, [capabilities, capabilityError, issue]);
  if (issue)
    return (
      <div
        role="alert"
        className="p-4 text-sm text-[var(--color-textSecondary)]"
      >
        {issue}
      </div>
    );
  if (capabilityError && capabilities)
    return <RuntimeUnavailable capabilities={capabilities} onClose={onClose} />;
  if (!capabilityReady)
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center overflow-auto p-6">
        <SynologyInitializationStatus phase="capabilities" />
      </div>
    );
  const trust = connection.deviceTrust;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {connection.connectionStatus === "connected" &&
        (trust.remembered || trust.notice) && (
          <TrustedDeviceBar trust={trust} />
        )}
      <SynologySessionContent connection={connection} runtimeVerified />
    </div>
  );
}

/** Signed-in trusted-device status. The sign-in view shows its own controls. */
function TrustedDeviceBar({
  trust,
}: {
  trust: ReturnType<typeof useSynologyFileConnection>["deviceTrust"];
}) {
  return (
    <div
      role="status"
      data-testid="synology-trusted-device"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-4 py-1.5 text-xs text-[var(--color-textSecondary)]"
    >
      <ShieldCheck size={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">
        {trust.notice ??
          "This computer is a trusted device for this NAS account."}
      </span>
      {trust.remembered && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary sor-btn-xs"
          disabled={trust.forgetting}
          onClick={() => void trust.forget()}
        >
          <ShieldOff size={12} aria-hidden="true" />
          {trust.forgetting ? "Forgetting…" : "Forget this device"}
        </button>
      )}
      {trust.notice && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary sor-btn-xs"
          onClick={trust.dismissNotice}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export default function SynologySessionPanel({
  session,
  onClose,
}: {
  session: ConnectionSession;
  onClose?: () => void;
}) {
  const { state, databaseAvailability: availability } = useConnections();
  const saved = state.connections.find(
    (entry) =>
      entry.id === session.connectionId &&
      !entry.isGroup &&
      isSynologyFileConnection(entry),
  );
  if (
    !session.ownerDatabaseId ||
    availability?.status !== "ready" ||
    availability.databaseId !== session.ownerDatabaseId ||
    !saved
  )
    return (
      <div
        role="alert"
        className="p-4 text-sm text-[var(--color-textSecondary)]"
      >
        {unavailable}
      </div>
    );
  return (
    <BoundSynologySession
      key={`${session.id}:${session.ownerDatabaseId}:${availability.generation}`}
      session={session}
      saved={saved}
      connections={state.connections}
      onClose={onClose}
    />
  );
}
