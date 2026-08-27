import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { ToastContext } from "../../contexts/ToastContext";
import { useConnections } from "../../contexts/useConnections";
import { useVoipPhone } from "../../hooks/voipPhone/useVoipPhone";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { generateId } from "../../utils/core/id";
import { toSafeManagementError } from "../../utils/security/managementInvoke";
import type { BuiltInManagementSessionPanelProps } from "../../utils/session/builtInManagementRuntimeRegistry";
import {
  registerRuntimeConnection,
  resolveRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";
import {
  buildVoipPhoneWebUiConnection,
  voipPhoneRuntimeAdapter,
  type VoipPhoneRuntimeAdapter,
} from "../../utils/session/voipPhoneRuntimeAdapter";

export interface VoipPhoneSessionPanelProps extends BuiltInManagementSessionPanelProps {
  /**
   * Opens a (runtime) connection as a new tab — `SessionViewer` wires the
   * app's `handleConnect` here. When absent the panel falls back to
   * dispatching an `http`/`https` session itself.
   */
  onOpenConnection?: (
    connection: Connection,
  ) => Promise<string | undefined> | string | undefined | void;
  adapter?: VoipPhoneRuntimeAdapter;
}

function validateConnection(connection: Connection | undefined): string | null {
  if (!connection) return "Saved VoIP phone connection is unavailable.";
  if (connection.protocol !== "voip-phone") {
    return "Saved connection protocol does not match VoIP Phone.";
  }
  if (!connection.hostname?.trim()) return "VoIP Phone requires a host.";
  if (!connection.username?.trim()) return "VoIP Phone requires a username.";
  return null;
}

const buttonClass =
  "rounded border border-slate-600 px-3 py-2 text-sm hover:border-cyan-400 disabled:opacity-50";

export function VoipPhoneSessionPanel({
  session,
  onClose,
  onOpenConnection,
  adapter = voipPhoneRuntimeAdapter,
}: VoipPhoneSessionPanelProps) {
  const { t } = useTranslation();
  const { state, dispatch } = useConnections();
  const toastContext = useContext(ToastContext);
  const phone = useVoipPhone(session.id, adapter);
  const connection = useMemo(
    () => resolveRuntimeConnection(state.connections, session.connectionId),
    [session.connectionId, state.connections],
  );
  const validationError = useMemo(
    () => validateConnection(connection),
    [connection],
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingReboot, setConfirmingReboot] = useState(false);
  const [openingWebUi, setOpeningWebUi] = useState(false);
  const closingRef = useRef(false);
  // `t` identity is not guaranteed stable across renders; keep the connect
  // effect keyed on the session/connection only.
  const tRef = useRef(t);
  tRef.current = t;

  const updateSession = useCallback(
    (status: ConnectionSession["status"], errorMessage?: string) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { id: session.id, status, errorMessage },
      });
    },
    [dispatch, session.id],
  );

  const { connect, disconnect, refreshStatus } = phone;

  useEffect(() => {
    if (validationError || !connection) {
      if (validationError) updateSession("error", validationError);
      return;
    }
    let cancelled = false;
    updateSession("connecting");
    void connect(connection).then(
      () => {
        if (cancelled) return;
        updateSession("connected");
        void refreshStatus();
      },
      (cause) => {
        if (cancelled) return;
        updateSession(
          "error",
          toSafeManagementError(
            cause,
            tRef.current(
              "voipPhone.errors.connect",
              "Could not log in to the phone.",
            ),
          ),
        );
      },
    );
    return () => {
      cancelled = true;
      void disconnect().catch(() => undefined);
    };
    // The adapter/session pair is stable for the lifetime of a tab.
  }, [
    connect,
    connection,
    disconnect,
    refreshStatus,
    updateSession,
    validationError,
  ]);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    void disconnect().then(
      () => {
        updateSession("disconnected");
        onClose?.();
      },
      (cause) => {
        closingRef.current = false;
        const message = toSafeManagementError(
          cause,
          t(
            "voipPhone.errors.disconnect",
            "Could not close the phone session.",
          ),
        );
        setActionError(message);
        updateSession("error", message);
      },
    );
  }, [disconnect, onClose, t, updateSession]);

  const handleOpenWebUi = useCallback(async () => {
    if (!connection) return;
    setOpeningWebUi(true);
    setActionError(null);
    try {
      const hint = await phone.getWebLoginHint();
      const webConnection = buildVoipPhoneWebUiConnection(connection, hint);
      // Credentials live only in the renderer-side runtime registry; the
      // session object that gets persisted/restored never carries them.
      registerRuntimeConnection(webConnection);
      if (onOpenConnection) {
        await onOpenConnection(webConnection);
      } else {
        const webSession: ConnectionSession = {
          id: generateId(),
          connectionId: webConnection.id,
          name: webConnection.name,
          status: "connecting",
          startTime: new Date(),
          protocol: webConnection.protocol,
          hostname: webConnection.hostname,
          reconnectAttempts: 0,
        };
        dispatch({ type: "ADD_SESSION", payload: webSession });
      }
      if (hint.note) toastContext?.toast.info(hint.note);
    } catch (cause) {
      setActionError(
        toSafeManagementError(
          cause,
          t("voipPhone.errors.openWebUi", "Could not open the phone web UI."),
        ),
      );
    } finally {
      setOpeningWebUi(false);
    }
  }, [connection, dispatch, onOpenConnection, phone, t, toastContext]);

  const handleRebootConfirmed = useCallback(async () => {
    setConfirmingReboot(false);
    setActionError(null);
    try {
      const result = await phone.reboot();
      const methodLabel =
        result.method === "action-uri"
          ? t("voipPhone.rebootMethods.actionUri", "Action URI")
          : t("voipPhone.rebootMethods.webForm", "web form");
      const message = result.accepted
        ? t("voipPhone.rebootDone", "Reboot requested via {{method}}.", {
            method: methodLabel,
          })
        : t(
            "voipPhone.rebootRejected",
            "The phone did not accept the reboot request ({{method}}).",
            { method: methodLabel },
          );
      if (result.accepted) toastContext?.toast.success(message);
      else {
        toastContext?.toast.warning(message);
        setActionError(message);
      }
    } catch (cause) {
      const message = toSafeManagementError(
        cause,
        t("voipPhone.errors.reboot", "The reboot request failed."),
      );
      setActionError(message);
      toastContext?.toast.error(message);
    }
  }, [phone, t, toastContext]);

  const visibleError = validationError ?? phone.error ?? actionError;
  const connected = phone.phase === "connected";
  const status = phone.status;

  const fields: Array<{ key: string; label: string; value?: string }> = [
    {
      key: "model",
      label: t("voipPhone.model", "Model"),
      value: status?.model,
    },
    {
      key: "firmware",
      label: t("voipPhone.firmware", "Firmware"),
      value: status?.firmware,
    },
    {
      key: "mac",
      label: t("voipPhone.mac", "MAC address"),
      value: status?.mac,
    },
    { key: "ip", label: t("voipPhone.ip", "IP address"), value: status?.ip },
    {
      key: "uptime",
      label: t("voipPhone.uptime", "Uptime"),
      value: status?.uptime,
    },
  ];
  const generation = status?.generation ?? phone.summary?.generation;
  const authShape = status?.authShape ?? phone.summary?.authShape;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100"
      data-testid="voip-phone-panel"
    >
      <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            {t("voipPhone.title", "VoIP Phone")}
            {" · "}
            {t("voipPhone.vendors.yealink", "Yealink")}
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {connection?.name ?? session.name}
          </h2>
          <p className="text-sm text-slate-400">
            {connection?.hostname ??
              t("voipPhone.connectionUnavailable", "Connection unavailable")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            data-testid="voip-phone-refresh"
            disabled={!connected || phone.statusLoading}
            onClick={() => void phone.refreshStatus()}
          >
            {phone.statusLoading
              ? t("voipPhone.refreshing", "Refreshing...")
              : t("voipPhone.refresh", "Refresh")}
          </button>
          <button
            type="button"
            className={buttonClass}
            data-testid="voip-phone-open-web"
            disabled={!connected || openingWebUi}
            onClick={() => void handleOpenWebUi()}
          >
            {t("voipPhone.openWebUi", "Open Web UI")}
          </button>
          <button
            type="button"
            className={`${buttonClass} border-amber-500/60 hover:border-amber-400`}
            data-testid="voip-phone-reboot"
            disabled={!connected || phone.rebooting || confirmingReboot}
            onClick={() => setConfirmingReboot(true)}
          >
            {phone.rebooting
              ? t("voipPhone.rebooting", "Rebooting...")
              : t("voipPhone.reboot", "Reboot")}
          </button>
          <button
            type="button"
            className={buttonClass}
            data-testid="voip-phone-close"
            disabled={phone.phase === "disconnecting"}
            onClick={handleClose}
          >
            {t("voipPhone.close", "Close")}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {confirmingReboot && (
            <div
              className="rounded-xl border border-amber-500/60 bg-amber-950/40 p-5"
              role="alertdialog"
              aria-labelledby="voip-phone-reboot-title"
              data-testid="voip-phone-reboot-dialog"
            >
              <h3
                id="voip-phone-reboot-title"
                className="text-sm font-semibold text-amber-100"
              >
                {t("voipPhone.rebootConfirmTitle", "Reboot this phone?")}
              </h3>
              <p className="mt-2 text-sm text-amber-100/80">
                {t(
                  "voipPhone.rebootConfirm",
                  "The phone will drop any active call and be unreachable for about a minute. Continue?",
                )}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className={`${buttonClass} border-amber-400 bg-amber-500/20`}
                  data-testid="voip-phone-reboot-confirm"
                  onClick={() => void handleRebootConfirmed()}
                >
                  {t("voipPhone.rebootConfirmAction", "Reboot now")}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  data-testid="voip-phone-reboot-cancel"
                  onClick={() => setConfirmingReboot(false)}
                >
                  {t("voipPhone.cancel", "Cancel")}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-400">
                {t("voipPhone.runtimeStatus", "Runtime status")}
              </span>
              <span
                className="rounded-full bg-slate-800 px-3 py-1 text-sm font-medium capitalize text-cyan-200"
                data-testid="voip-phone-phase"
              >
                {phone.phase}
              </span>
            </div>
            {visibleError ? (
              <div
                className="mt-5 rounded-lg border border-red-500/60 bg-red-950/50 p-4 text-sm text-red-100"
                role="alert"
                data-testid="voip-phone-error"
              >
                {visibleError}
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-slate-300">
                {t(
                  "voipPhone.credentialsNote",
                  "Credentials are sent only to the phone at the configured host. Open Web UI logs the embedded browser in through the same proxy-mediated session.",
                )}
              </p>
            )}
          </div>

          {phone.statusError && (
            <div
              className="rounded-lg border border-red-500/60 bg-red-950/50 p-4 text-sm text-red-100"
              role="alert"
            >
              {t("voipPhone.errors.status", "Status refresh failed:")}{" "}
              {phone.statusError}
            </div>
          )}

          {connected && (
            <article
              className="rounded-xl border border-slate-700 bg-slate-900/80 p-4"
              data-testid="voip-phone-status"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  {t("voipPhone.status", "Phone status")}
                </h3>
                <div className="flex items-center gap-2 text-xs">
                  {generation && (
                    <span
                      className="rounded-full bg-slate-800 px-2 py-1 text-cyan-200"
                      data-testid="voip-phone-generation"
                    >
                      {t("voipPhone.generation", "Firmware generation")}:{" "}
                      {generation}
                    </span>
                  )}
                  {authShape && (
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
                      {authShape}
                    </span>
                  )}
                </div>
              </div>
              {status ? (
                <dl className="mt-3 space-y-2">
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      className="flex items-start justify-between gap-4 text-sm"
                      data-testid={`voip-phone-field-${field.key}`}
                    >
                      <dt className="text-slate-400">{field.label}</dt>
                      <dd className="min-w-0 break-words text-right text-slate-100">
                        {field.value ?? t("voipPhone.unknown", "Unknown")}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  {phone.statusLoading
                    ? t("voipPhone.loadingStatus", "Loading phone status...")
                    : t("voipPhone.noStatus", "No status loaded yet.")}
                </p>
              )}
            </article>
          )}

          {connected && status && (
            <article
              className="rounded-xl border border-slate-700 bg-slate-900/80 p-4"
              data-testid="voip-phone-accounts"
            >
              <h3 className="text-sm font-semibold text-slate-100">
                {t("voipPhone.accounts", "SIP accounts")}
              </h3>
              {status.accounts.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  {t("voipPhone.noAccounts", "No SIP accounts reported.")}
                </p>
              ) : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1 pr-3">
                        {t("voipPhone.account", "Account")}
                      </th>
                      <th className="py-1 pr-3">
                        {t("voipPhone.accountUser", "User")}
                      </th>
                      <th className="py-1 pr-3">
                        {t("voipPhone.accountServer", "Server")}
                      </th>
                      <th className="py-1">
                        {t("voipPhone.registration", "Registration")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.accounts.map((account) => (
                      <tr
                        key={account.index}
                        className="border-t border-slate-800"
                        data-testid={`voip-phone-account-${account.index}`}
                      >
                        <td className="py-2 pr-3">
                          {account.label ??
                            `${t("voipPhone.account", "Account")} ${account.index}`}
                        </td>
                        <td className="py-2 pr-3 text-slate-300">
                          {account.user ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-slate-300">
                          {account.server ?? "—"}
                        </td>
                        <td className="py-2">
                          <span
                            className={
                              account.registered
                                ? "rounded-full bg-emerald-900/60 px-2 py-1 text-xs text-emerald-200"
                                : "rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300"
                            }
                            data-registered={
                              account.registered ? "true" : "false"
                            }
                          >
                            {account.registered
                              ? t("voipPhone.registered", "Registered")
                              : t("voipPhone.unregistered", "Not registered")}
                            {account.rawState ? ` (${account.rawState})` : ""}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

export default VoipPhoneSessionPanel;
