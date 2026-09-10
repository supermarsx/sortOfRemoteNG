import { lazy, Suspense, useContext, useEffect, useRef, useState } from "react";
import SettingsContext from "../../../contexts/SettingsContext";
import {
  normalizeNasFileViewers,
  type NasExternalApplication,
} from "../../../types/settings/nasFileViewers";
import {
  closeNasPreview,
  nasViewerKind,
  openNasFileExternally,
  previewNasFile,
  type NasPreview,
  type NasPreviewCloseScope,
} from "../../../utils/synology/fileViewers";
import { toSafeManagementError } from "../../../utils/security/managementInvoke";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import type { SubProps } from "./types";

const FileViewerSettings = lazy(() => import("./FileViewerSettings"));
type OpenPreview = {
  key: string;
  value: NasPreview;
  close: NasPreviewCloseScope;
};
const disposePreview = (preview: OpenPreview) =>
  closeNasPreview(preview.close).catch(() => {
    console.warn(
      "A NAS viewer could not acknowledge closing; close its window directly if it remains open.",
    );
  });
const displaySize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export default function FileViewerActions({
  mgr,
  listingPending,
}: SubProps & { listingPending: boolean }) {
  const context = useContext(SettingsContext);
  const settings = normalizeNasFileViewers(context?.settings.nasFileViewers);
  const fs = mgr.fileStation;
  const item =
    fs.selected.length === 1
      ? fs.fileList?.files.find(
          (file) => file.path === fs.selected[0] && !file.isdir,
        )
      : undefined;
  const kind = item ? nasViewerKind(item.name) : null;
  const available =
    !!context &&
    context.settingsReady !== false &&
    mgr.connectionStatus === "connected" &&
    !!mgr.sessionId &&
    !listingPending &&
    !fs.busy;
  const scope = JSON.stringify([
    mgr.instanceId,
    mgr.sessionId,
    mgr.connectionStatus,
    fs.currentPath,
    item?.path,
    item?.additional?.size,
    item?.additional?.time?.mtime,
    settings,
    available,
  ]);
  const current = useRef(scope),
    epoch = useRef(0),
    alive = useRef(true),
    running = useRef(false);
  if (current.current !== scope) {
    current.current = scope;
    epoch.current++;
  }
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const previewRef = useRef<OpenPreview | null>(null),
    closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    key: string;
    epoch: number;
    application: NasExternalApplication;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    const generation = epoch;
    const retainedPreview = previewRef;
    return () => {
      alive.current = false;
      generation.current++;
      const retained = retainedPreview.current;
      retainedPreview.current = null;
      if (retained) void disposePreview(retained);
    };
  }, []);
  useEffect(() => {
    const retained = previewRef.current;
    if (retained && retained.key !== scope) {
      previewRef.current = null;
      void disposePreview(retained);
    }
    setPreview(null);
    setConfirmation(null);
    setMessage(null);
    setError(null);
  }, [scope]);
  const assertCurrent = (key: string, generation: number) => {
    if (
      !alive.current ||
      current.current !== key ||
      epoch.current !== generation ||
      !available ||
      !item ||
      !kind
    )
      throw new Error(
        "The NAS file or viewer access changed. Select the file and review it again.",
      );
    mgr.assertSessionAccess();
  };
  const run = async (
    application?: NasExternalApplication,
    reviewedEpoch = epoch.current,
  ) => {
    if (
      running.current ||
      closingRef.current ||
      (!application && previewRef.current) ||
      !item ||
      !kind ||
      !mgr.sessionId
    )
      return;
    const key = scope,
      generation = reviewedEpoch;
    try {
      assertCurrent(key, generation);
      if (application ? !settings.external[kind] : !settings.preview[kind])
        return;
      running.current = true;
      setBusy(true);
      setError(null);
      setMessage(null);
      setConfirmation(null);
      const args = {
        instanceId: mgr.instanceId,
        expectedSessionId: mgr.sessionId,
        path: item.path,
        kind,
        maxBytes:
          (application ? settings.externalMaxMiB : settings.previewMaxMiB) *
          1024 *
          1024,
      };
      const check = () => assertCurrent(key, generation);
      if (application) {
        const result = await openNasFileExternally(
          args,
          application,
          settings.retentionMinutes,
          check,
        );
        if (!result.cancelled)
          setMessage(
            "Opened a temporary local copy. Changes in the external application are not saved to the NAS.",
          );
      } else {
        const value = await previewNasFile(
          args,
          {
            textWrap: settings.textWrap,
            textFontSize: settings.textFontSize,
            imageFit: settings.imageFit,
          },
          check,
        );
        const entry: OpenPreview = {
          key,
          value,
          close: {
            instanceId: args.instanceId,
            expectedSessionId: args.expectedSessionId,
            viewerId: value.viewerId,
          },
        };
        try {
          check();
        } catch (failure) {
          await disposePreview(entry);
          throw failure;
        }
        previewRef.current = entry;
        setPreview(entry);
      }
    } catch (failure) {
      if (
        alive.current &&
        current.current === key &&
        epoch.current === generation
      ) {
        const safe = toSafeManagementError(failure);
        if (safe.startsWith("SYNOLOGY_SESSION_EXPIRED: "))
          mgr.notifySessionExpired(mgr.sessionId, safe);
        setError(safe);
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const closePreview = async (entry: OpenPreview) => {
    if (closingRef.current || previewRef.current !== entry) return;
    closingRef.current = true;
    setClosing(true);
    setError(null);
    try {
      await closeNasPreview(entry.close);
      if (previewRef.current === entry) {
        previewRef.current = null;
        if (alive.current) setPreview(null);
      }
    } catch (failure) {
      if (alive.current && current.current === entry.key)
        setError(toSafeManagementError(failure));
    } finally {
      closingRef.current = false;
      if (alive.current) setClosing(false);
    }
  };
  const external = (application: NasExternalApplication) => {
    if (!available || !kind || !settings.external[kind] || busy) return;
    try {
      assertCurrent(scope, epoch.current);
    } catch {
      setError(
        "NAS access is no longer available. Reconnect before opening this file.",
      );
      return;
    }
    if (settings.confirmExternal)
      setConfirmation({ key: scope, epoch: epoch.current, application });
    else void run(application);
  };
  return (
    <>
      <button
        className="sor-btn-secondary-sm"
        disabled={
          !available ||
          busy ||
          closing ||
          !!preview ||
          !kind ||
          !settings.preview[kind]
        }
        onClick={() => void run()}
        title={
          kind
            ? "Open a separate restricted viewer (Windows currently supported; unavailable platforms fail closed)"
            : "Select one supported text, PDF or image file"
        }
      >
        Preview file
      </button>
      <button
        className="sor-btn-secondary-sm"
        disabled={!available || busy || !kind || !settings.external[kind]}
        onClick={() => kind && external(settings.application[kind])}
        title="Enable external opening in Viewer settings first"
      >
        Open externally
      </button>
      <button
        className="sor-btn-secondary-sm"
        disabled={!available || busy || !kind || !settings.external[kind]}
        onClick={() => external("choose")}
        title="Choose an application using the native file picker"
      >
        Open with…
      </button>
      <button
        className="sor-btn-secondary-sm"
        disabled={!context || context.settingsReady === false || busy}
        onClick={() => setShowSettings(true)}
      >
        Viewer settings
      </button>
      {busy && <span role="status">Preparing selected file…</span>}
      {error && (
        <span role="alert" className="text-error text-sm">
          {error}
        </span>
      )}
      {message && (
        <span role="status" className="text-sm">
          {message}
        </span>
      )}
      {preview?.key === scope && (
        <span className="flex items-center gap-2 text-sm">
          <span role="status">
            Opened {preview.value.name} in a separate restricted viewer ·{" "}
            <span title={`${preview.value.bytes.toLocaleString()} bytes`}>
              {displaySize(preview.value.bytes)}
            </span>
            . File content is not loaded in this window.
          </span>
          <button
            className="sor-btn-secondary-sm"
            disabled={closing}
            onClick={() => void closePreview(preview)}
          >
            {closing ? "Closing preview…" : "Close preview"}
          </button>
        </span>
      )}
      {confirmation?.key === scope && (
        <ConfirmDialog
          isOpen
          title="Open NAS file externally?"
          confirmText="Open local copy"
          confirmOnEnter={false}
          variant="warning"
          message={`Download ${item?.name} as a plaintext local copy (up to ${settings.externalMaxMiB} MiB) and open it ${confirmation.application === "choose" ? "with an application you choose" : "in the system default application"}? External applications are not sandboxed by this app and may activate PDF actions or other file features. Cleanup is attempted after ${settings.retentionMinutes} minutes or session close; the application may retain a copy or keep the file open. Changes are not saved to the NAS.`}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (
              current.current === confirmation.key &&
              epoch.current === confirmation.epoch
            )
              void run(confirmation.application, confirmation.epoch);
          }}
        />
      )}
      {showSettings && context && (
        <Suspense
          fallback={<span role="status">Loading viewer settings…</span>}
        >
          <FileViewerSettings
            settings={settings}
            onClose={() => setShowSettings(false)}
            onSave={async (value) => {
              if (context.settingsReady === false)
                throw new Error("Settings unavailable");
              await context.updateSettings({ nasFileViewers: value });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
