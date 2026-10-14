import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  House,
  Code2,
  LoaderCircle,
  RotateCcw,
  RotateCw,
  Save,
  Settings2,
  ShieldCheck,
  Square,
  Video,
  X,
} from "lucide-react";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import { useConnections } from "../../../contexts/useConnections";
import { useSettings } from "../../../contexts/SettingsContext";
import { useToastContext } from "../../../contexts/ToastContext";
import { useSessionRenderActivity } from "../../../contexts/SessionRenderActivityContext";
import {
  useOriginBrowser,
  type OriginBrowserRestartReason,
} from "../../../hooks/protocol/useOriginBrowser";
import {
  originBrowserLoadError,
  originBrowserSessionError,
} from "../../../hooks/protocol/originBrowserSessionError";
import { useOriginBrowserOwner } from "../../../hooks/protocol/useOriginBrowserOwner";
import { useOriginQuickConnection } from "../../../hooks/protocol/useOriginQuickConnection";
import { useOriginBrowserOverlays } from "../../../hooks/protocol/useOriginBrowserOverlays";
import {
  originBrowserConnectionTarget,
  originBrowserSavedSource,
} from "../../../hooks/protocol/originBrowserConnectionTarget";
import { nativeBrowserAuthoritySignature } from "../../../utils/connection/nativeBrowserAuthoritySignature";
import { normalizeWebBrowserSettings } from "../../../utils/settings/webBrowserSettings";
import { resolveConnectionBrowserSettings } from "../../../utils/settings/browserSessionSettings";
import { captureSessionDatabaseAccess } from "../../../utils/session/sessionDatabaseOwnership";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import { SettingsCard } from "../../ui/settings/SettingsPrimitives";
import { OriginConnectionPermissions } from "../../SettingsDialog/sections/webBrowser/OriginBrowserPreferences";
import WebsiteDomainPermissionsEditor from "../../SettingsDialog/sections/webBrowser/WebsiteDomainPermissionsEditor";
import type { WebBrowserSettingsConfig } from "../../../types/settings/webBrowser";
import type { WebsiteDomainPermissionsSettings } from "../../../types/settings/websiteDomainPermissions";
import type { SettingsTabId } from "../../SettingsDialog/settingsConstants";
import OriginBrowserViewport from "./OriginBrowserViewport";
import { TextInput } from "../../ui/forms/TextInput";
import OriginBrowserCapabilityNotice from "./OriginBrowserCapabilityNotice";
import OriginBookmarkBar from "./OriginBookmarkBar";
import OriginBookmarkButton from "./OriginBookmarkButton";
import OriginPageTools from "./OriginPageTools";
import OriginMoreMenu from "./OriginMoreMenu";
import OriginHistoryMenu from "./OriginHistoryMenu";
import { useOriginPageMenu } from "../../../hooks/protocol/useOriginPageMenu";
import { useOriginFindResults } from "../../../hooks/protocol/useOriginFindResults";
import { useNativeBrowserRecording } from "../../../hooks/protocol/useNativeBrowserRecording";
import { useOriginWebsiteAutomation } from "../../../hooks/protocol/useOriginWebsiteAutomation";
import OriginAutomationControls from "./OriginAutomationControls";
import { useOriginBrowserNotices } from "../../../hooks/protocol/useOriginBrowserNotices";
import OriginBrowserNotices from "./OriginBrowserNotices";
import NativeBrowserDownloads from "./NativeBrowserDownloads";
import { useOriginSelectedDownloads } from "../../../hooks/protocol/useOriginSelectedDownloads";
import { useNativeOriginPopupBridge } from "../../../hooks/protocol/useNativeOriginPopupBridge";
import { useOriginBrowserPopups } from "../../../hooks/protocol/useOriginBrowserPopups";
import { samePopupSource } from "../../../types/protocols/originBrowserPopups";
import OriginPopupTabs from "./OriginPopupTabs";
import { useNativeBrowserExtensions } from "../../../hooks/protocol/useNativeBrowserExtensions";
import { useNativeBrowserAppearance } from "../../../hooks/protocol/useNativeBrowserAppearance";
import { useNativeBrowserExtensionReceipt } from "../../../hooks/protocol/useNativeBrowserExtensionReceipt";
import NativeBrowserExtensionControls from "./NativeBrowserExtensionControls";
import progressStyles from "./NavigationProgress.module.css";
import OriginMfaOriginRepair from "./OriginMfaOriginRepair";
import OriginCredentialControls, {
  OriginToolbarPopover,
} from "./OriginCredentialControls";
import NativeBrowserRecordingControls from "./NativeBrowserRecordingControls";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { OriginBrowserFailureDiagnostics } from "./OriginBrowserFailureDiagnostics";
import {
  getOriginBrowserFailureDetails,
  type BrowserRecoveryAction,
} from "../../../hooks/protocol/originBrowserFailureDetails";
import { requestOriginBrowserRecovery } from "../../../utils/session/originBrowserRecovery";
import { getQuickConnectConnection } from "../../../utils/session/runtimeConnectionRegistry";
import OriginBrowserRecoveryActions from "./OriginBrowserRecoveryActions";

/** Native answers a create within its 20 s engine wait plus the saved initial
 * load timeout and 5 s. The rest is the slack the hook's own default leaves. */
const NATIVE_START_MARGIN_SECONDS = 60;

/** The save failed after the open page was already closed for it. */
class SaveAfterCloseError extends Error {}

type RestartStage = "running" | "done" | "failed";
/** One notice per in-place restart, in the user's terms. Proxy recovery is
 * "done" only after its replacement loads a real page successfully. */
const RESTART_NOTICES: Record<
  OriginBrowserRestartReason,
  Record<RestartStage, string>
> = {
  "source-changed": {
    running:
      "This connection's saved settings changed. Reconnecting this tab to apply them…",
    done: "This connection's saved settings changed, so this tab reconnected to apply them.",
    failed:
      "This connection's saved settings changed, so this tab tried to reconnect. It could not; the error below explains why.",
  },
  "settings-saved": {
    running: "Saving browser settings and reconnecting this tab…",
    done: "Browser settings saved. This tab reconnected to apply them.",
    failed:
      "Browser settings were saved, but this tab could not reconnect. The error below explains why.",
  },
  "session-cleared": {
    running: "Clearing this browser session and reconnecting…",
    done: "Browser session cleared. This tab reconnected with a new one.",
    failed:
      "The browser session was cleared, but this tab could not reconnect. The error below explains why.",
  },
  "relay-ended": {
    running:
      "The app's private proxy for this tab stopped. Reconnecting this tab with a new one…",
    done: "The app's private proxy for this tab stopped, so this tab reconnected with a new one.",
    failed:
      "The app's private proxy for this tab stopped, so this tab tried to reconnect. It could not; the error below explains why.",
  },
  "proxy-unreachable": {
    running:
      "The browser could not reach its private proxy. Reconnecting with a fresh proxy…",
    done: "This tab reconnected with a fresh private proxy.",
    failed:
      "The fresh private proxy could not load the website. Review the diagnostics and retry.",
  },
  requested: {
    running: "Reconnecting this tab…",
    done: "This tab reconnected.",
    failed: "This tab could not reconnect. The error below explains why.",
  },
};

export default function OriginConnectionBrowser({
  session,
  sharedPopupId,
  onOpenSettings,
}: {
  session: ConnectionSession;
  sharedPopupId?: string;
  onOpenSettings?: (tab?: SettingsTabId) => void;
}) {
  const context = useConnections();
  const { settings, settingsReady, updateSettings } = useSettings();
  const { toast } = useToastContext();
  // These fallback values are display-only. Invalid shared settings never
  // reach native creation or the permissions dialog's save path.
  let globalBrowserConfig = normalizeWebBrowserSettings(undefined);
  let globalBrowserConfigInvalid = false;
  try {
    globalBrowserConfig = normalizeWebBrowserSettings(settings.webBrowser);
  } catch {
    globalBrowserConfigInvalid = true;
  }
  const { isActive } = useSessionRenderActivity();
  const closeRef = useRef<(() => Promise<void>) | null>(null);
  const lifetime = useRef(false);
  const currentSettings = useRef(settings.webBrowser);
  useLayoutEffect(() => {
    currentSettings.current = settings.webBrowser;
  }, [settings.webBrowser]);
  useLayoutEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
    };
  }, []);
  const overlays = useOriginBrowserOverlays(isActive);
  const hide = overlays.refresh;
  const overlayOpen = overlays.blocked;
  const temporary = useOriginQuickConnection(
    session,
    context.state.connections,
    closeRef,
  );
  const isTemporary = !!temporary;
  // The saved-owner hook revokes on every database selection event. A
  // temporary tab must neither acquire its proof nor use its close callback.
  const inactiveCloseRef = useRef<(() => Promise<void>) | null>(null);
  const savedProof = useOriginBrowserOwner(
    isTemporary ? { ...session, ownerDatabaseId: undefined } : session,
    isTemporary ? undefined : context.databaseAvailability,
    isTemporary ? inactiveCloseRef : closeRef,
  );
  const proof = temporary?.proof ?? savedProof;
  const matches = context.state.connections.filter(
    (row) => row.id === session.connectionId,
  );
  const connection = matches.length === 1 ? matches[0] : temporary?.connection;
  // Only a saved row has a database write to wait for and a host to follow.
  const savedRow = matches.length === 1 ? matches[0] : undefined;
  const ownerDatabaseId =
    proof?.ownerDatabaseId ?? session.ownerDatabaseId ?? "";
  // Display preferences only. Native independently authenticates its policies.
  let browserConfig = globalBrowserConfig;
  let browserConfigInvalid = globalBrowserConfigInvalid;
  try {
    browserConfig = resolveConnectionBrowserSettings(
      settings.webBrowser,
      connection?.browserSession,
    );
  } catch {
    browserConfigInvalid = true;
  }
  const [editing, setEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  // Native builds a saved tab's source from the saved row alone, so the
  // target follows a saved host or scheme edit that the session row predates.
  const savedSource = savedRow ? originBrowserSavedSource(savedRow) : undefined;
  let targetUrl = "";
  try {
    if (connection && savedSource !== null)
      targetUrl = originBrowserConnectionTarget(
        connection,
        savedSource ? { ...session, ...savedSource } : session,
      );
  } catch {
    /* Native navigation remains disabled. */
  }
  const authoritySignature = useMemo(
    () => (savedRow ? nativeBrowserAuthoritySignature(savedRow) : undefined),
    [savedRow],
  );
  // What the current attempt was started from. An edit reaches the row in
  // memory before the database write that native reads, so a saved tab moves
  // to it only once that write has finished (see the effect further down).
  const [applied, setApplied] = useState({
    initialUrl: targetUrl,
    authoritySignature,
  });
  const source =
    authoritySignature !== undefined && applied.authoritySignature !== undefined
      ? applied
      : { initialUrl: targetUrl, authoritySignature };
  const { initialUrl } = source;
  const ownerAvailable =
    !!proof && !!connection && !sharedPopupId && !session.reattachOnly;
  const canEdit =
    !globalBrowserConfigInvalid &&
    !isTemporary &&
    context.databaseAvailability?.status === "ready" &&
    context.databaseAvailability.databaseId === session.ownerDatabaseId &&
    !!connection;
  const permissionsOpen = editing && canEdit && ownerAvailable && isActive;
  // "Save for next connection" closes the page before it saves. The tab ends
  // only once the outcome of that save has been shown in its dialog.
  const [finishing, setFinishing] = useState(false);
  const holdFinalStatus = finishing && permissionsOpen;
  const dialogOpen =
    editing ||
    moreOpen ||
    bookmarksOpen ||
    credentialsOpen ||
    recordingOpen ||
    overlayOpen;
  const popupBridge = useNativeOriginPopupBridge();
  const browser = useOriginBrowser({
    transport: popupBridge.browserTransport,
    owner: {
      ownerDatabaseId,
      connectionId: session.connectionId,
      sessionId: session.id,
    },
    expectedSecurityRevision: proof?.expectedSecurityRevision ?? "",
    sourceSessionId: proof?.sourceSessionId ?? "",
    initialUrl,
    enabled: settingsReady !== false && !globalBrowserConfigInvalid,
    ownerAvailable,
    active: isActive,
    dialogOpen,
    preserveRenderingUnderOverlays: true,
    occlusions: overlays.rectangles,
    consent: { kind: "required" },
    assertOwner: proof?.assertCurrent,
    quickConnect: temporary?.quickConnect,
    authoritySignature: source.authoritySignature,
    startTimeoutMs: browserConfigInvalid
      ? undefined
      : (browserConfig.initialLoadTimeoutSeconds +
          NATIVE_START_MARGIN_SECONDS) *
        1000,
  });
  const { close, navigate: nativeNavigate } = browser;
  useLayoutEffect(() => {
    closeRef.current = close;
    return () => {
      closeRef.current = null;
    };
  }, [close]);
  const { snapshot: rootSnapshot, phase, startupFailure } = browser.state;
  const { connectionStatus } = browser;
  const liveSession = context.state.sessions.find(
    (row) => row.id === session.id,
  );
  const sessionError =
    connectionStatus === "error"
      ? (browser.state.error ??
        getOriginBrowserFailureDetails(browser.state)
          .map(
            (detail) => `${detail.problem} ${detail.nextStep} [${detail.code}]`,
          )
          .join(" "))
      : undefined;
  const dispatchSession = context.dispatch;
  // The commit in which an owner appears still shows the state the hook held
  // without one. The hook replaces it before the next render, so that state
  // is never published as this session's error.
  const ownerlessState =
    browser.state.unavailableReason === "owner-unavailable";
  const ownerStateSeen = useRef(false);
  useEffect(() => {
    if (
      !lifetime.current ||
      !ownerAvailable ||
      !proof ||
      !connectionStatus ||
      (ownerlessState && !ownerStateSeen.current) ||
      (connectionStatus === "disconnected" && holdFinalStatus) ||
      !liveSession ||
      liveSession.connectionId !== session.connectionId ||
      liveSession.ownerDatabaseId !== session.ownerDatabaseId ||
      (liveSession.status === connectionStatus &&
        liveSession.errorMessage === sessionError)
    )
      return;
    try {
      proof.assertCurrent();
    } catch {
      return;
    }
    // A local display patch only: preserve native identity, lifecycle ownership,
    // and session metadata. Background tabs report attachment too. Root browser
    // state owns the app session; child selection and pending login do not.
    dispatchSession({
      type: "UPDATE_SESSION",
      payload: {
        id: session.id,
        status: connectionStatus,
        errorMessage: sessionError,
      },
    });
  }, [
    dispatchSession,
    liveSession,
    session.id,
    session.connectionId,
    session.ownerDatabaseId,
    ownerAvailable,
    proof,
    connectionStatus,
    sessionError,
    ownerlessState,
    holdFinalStatus,
  ]);
  useEffect(() => {
    ownerStateSeen.current =
      ownerAvailable && (ownerStateSeen.current || !ownerlessState);
  }, [ownerAvailable, ownerlessState]);
  // A document load error retains its native attempt for back/address/inspection.
  const nativeAttached =
    phase === "attached" ||
    (phase === "error" &&
      rootSnapshot?.phase === "attached" &&
      !!rootSnapshot.loadFailure);
  const { restart, lastRestart } = browser;
  // Older embedded and test contexts carry no persistence state.
  const saveFlushed =
    !context.persistence?.dirty && !context.persistence?.saving;
  const liveAttempt = phase === "starting" || nativeAttached;
  useEffect(() => {
    if (
      applied.initialUrl === targetUrl &&
      applied.authoritySignature === authoritySignature
    )
      return;
    const next = { initialUrl: targetUrl, authoritySignature };
    // No saved row was started from, or none is left to wait for.
    if (
      authoritySignature === undefined ||
      applied.authoritySignature === undefined
    ) {
      setApplied(next);
      return;
    }
    if (!saveFlushed) return;
    setApplied(next);
    // The attempt has to be replaced by one that reads the row just written.
    // A failed or finally closed tab keeps its explicit Retry instead. A
    // restart the hook made by itself in the meantime does not stand in for
    // this one: the shell cannot know which row that replacement read (an
    // earlier edit's, or the old one if a route record changed). While that
    // restart has not created yet, the hook serves both with one replacement.
    // (The tab's own Save and reconnect marks its write as applied; see onSave.)
    if (
      targetUrl &&
      liveAttempt &&
      applied.authoritySignature !== authoritySignature
    )
      void restart("source-changed");
  }, [
    applied,
    targetUrl,
    authoritySignature,
    saveFlushed,
    liveAttempt,
    restart,
  ]);
  // The session row copied the saved host and scheme when its tab opened. It
  // follows them once the tab runs from the edited row, for the tab strip and
  // for every later start.
  const savedHost = savedSource?.hostname;
  const savedScheme = savedSource?.protocol;
  useEffect(() => {
    if (
      !lifetime.current ||
      !ownerAvailable ||
      !proof ||
      savedHost === undefined ||
      savedScheme === undefined ||
      applied.initialUrl !== targetUrl ||
      applied.authoritySignature !== authoritySignature ||
      !liveSession ||
      liveSession.connectionId !== session.connectionId ||
      liveSession.ownerDatabaseId !== session.ownerDatabaseId ||
      (liveSession.hostname === savedHost &&
        liveSession.protocol === savedScheme)
    )
      return;
    try {
      proof.assertCurrent();
    } catch {
      return;
    }
    dispatchSession({
      type: "UPDATE_SESSION",
      payload: { id: session.id, hostname: savedHost, protocol: savedScheme },
    });
  }, [
    dispatchSession,
    liveSession,
    session.id,
    session.connectionId,
    session.ownerDatabaseId,
    ownerAvailable,
    proof,
    savedHost,
    savedScheme,
    applied,
    targetUrl,
    authoritySignature,
  ]);
  // The hook keeps proxy recovery pending through attachment until the real
  // page settles. A later Retry clears a failed restart.
  const restarting = !!browser.state.restart;
  const [restartProgress, setRestartProgress] = useState<{
    serial: number;
    stage: RestartStage;
  } | null>(null);
  const [dismissedRestart, setDismissedRestart] = useState(0);
  const [settingsSave, setSettingsSave] = useState<
    "pending" | "saved" | "failed"
  >("pending");
  useEffect(() => {
    if (!lastRestart) return;
    const stage =
      restartProgress?.serial === lastRestart.serial
        ? restartProgress.stage
        : null;
    const failed = phase === "error" || phase === "unavailable";
    const next = restarting
      ? "running"
      : stage === "running"
        ? phase === "attached"
          ? "done"
          : failed
            ? "failed"
            : phase === "starting"
              ? "running"
              : null
        : stage === "failed" && !failed
          ? null
          : stage;
    if (next !== stage)
      setRestartProgress(next && { serial: lastRestart.serial, stage: next });
  }, [lastRestart, restarting, phase, restartProgress]);
  const restartStage =
    lastRestart &&
    restartProgress?.serial === lastRestart.serial &&
    dismissedRestart !== lastRestart.serial
      ? restartProgress.stage
      : null;
  // A restart for a save says "saved" only once that save has succeeded. The
  // table is complete for the hook's reasons as compiled; one it gains later
  // still gets the general line here, never a blank or a broken shell.
  const restartNotice =
    lastRestart && restartStage
      ? (RESTART_NOTICES[
          lastRestart.reason !== "settings-saved" ||
          settingsSave === "saved" ||
          (settingsSave === "pending" && restartStage === "running")
            ? lastRestart.reason
            : "requested"
        ] ?? RESTART_NOTICES.requested)[restartStage]
      : null;
  const toastedProxyRecovery = useRef<number | null>(null);
  useEffect(() => {
    if (
      lastRestart?.reason !== "proxy-unreachable" ||
      restartStage !== "done" ||
      restarting ||
      phase !== "attached" ||
      rootSnapshot?.phase !== "attached" ||
      rootSnapshot.documentLoaded !== true ||
      rootSnapshot.loading ||
      rootSnapshot.loadFailure ||
      !/^https?:\/\//i.test(rootSnapshot.displayUrl) ||
      toastedProxyRecovery.current === lastRestart.serial
    )
      return;
    toastedProxyRecovery.current = lastRestart.serial;
    toast.success(RESTART_NOTICES["proxy-unreachable"].done);
  }, [lastRestart, restartStage, restarting, phase, rootSnapshot, toast]);
  const [repairedMfaFailure, setRepairedMfaFailure] =
    useState<typeof startupFailure>(null);
  const [devtoolsError, setDevtoolsError] = useState(false);
  const bindPopupSource = popupBridge.bind;
  const popupSourceIdentity = rootSnapshot?.identity;
  useLayoutEffect(() => {
    bindPopupSource(popupSourceIdentity ?? null);
  }, [bindPopupSource, popupSourceIdentity]);
  const shellScope = useRef({ proof, connection, isActive, session });
  useLayoutEffect(() => {
    shellScope.current = { proof, connection, isActive, session };
  });
  const assertShellOwner = () => {
    const current = shellScope.current;
    if (
      !lifetime.current ||
      !ownerAvailable ||
      !proof ||
      current.proof !== proof ||
      current.connection !== connection ||
      current.session !== session ||
      !current.isActive
    )
      throw new Error("Browser owner changed.");
    proof.assertCurrent();
  };
  const restartEphemeralContext = async () => {
    assertShellOwner();
    // Close, then create, inside the hook: the tab never reads as ended, and
    // the hook checks the owner again before it creates.
    if (!(await browser.restart("session-cleared")))
      throw new Error("Browser restart was not confirmed.");
  };
  const appearanceStatus = useNativeBrowserAppearance(
    rootSnapshot?.identity ?? null,
    // Native prepaint darkness remains active while loading. Request the
    // extension receipt for the settled document, not its retiring predecessor.
    ownerAvailable && phase === "attached" && !rootSnapshot?.loading,
    () => {
      // Theme updates may reach inactive views, but confer no input authority.
      const current = shellScope.current;
      if (
        !lifetime.current ||
        !ownerAvailable ||
        !proof ||
        current.proof !== proof ||
        current.connection !== connection ||
        current.session !== session
      )
        throw new Error("Browser owner changed.");
      proof.assertCurrent();
    },
  );
  const popups = useOriginBrowserPopups({
    sourceIdentity: rootSnapshot?.identity ?? null,
    enabled: ownerAvailable && nativeAttached,
    assertOwner: () => {
      if (!lifetime.current || !ownerAvailable || !proof)
        throw new Error("Browser owner changed.");
      proof.assertCurrent();
    },
    transport: popupBridge.popupTransport,
    onActivate: (reference) =>
      rootSnapshot
        ? popupBridge.activate(rootSnapshot.identity, reference)
        : undefined,
  });
  const selectedPopupId = samePopupSource(
    popupBridge.selection?.sourceIdentity,
    rootSnapshot?.identity,
  )
    ? popupBridge.selection!.viewId
    : null;
  const selectedPopup = popups.tabs.find(
    (tab) => tab.viewId === selectedPopupId,
  );
  useEffect(() => {
    if (
      !rootSnapshot ||
      !selectedPopupId ||
      popupBridge.pending ||
      (selectedPopup &&
        selectedPopup.phase === "adopted" &&
        !selectedPopup.closing)
    )
      return;
    // A native window.close/removal can win while its selection ACK is queued.
    // Repair the bridge target even when the tab hook never committed that ACK.
    void popupBridge.activate(rootSnapshot.identity, null).catch(() => {});
  }, [rootSnapshot, selectedPopupId, selectedPopup, popupBridge]);
  // Never present the hidden root's address or history as child state.
  const snapshot = selectedPopupId ? selectedPopup?.snapshot : rootSnapshot;
  // A selected child owns its failure screen; the hidden root's load error is
  // not a child failure. Commands still use the bridge's selected-view authority.
  const viewportState: typeof browser.state =
    selectedPopupId && nativeAttached
      ? {
          ...browser.state,
          snapshot: snapshot ?? null,
          phase:
            snapshot?.loadFailure || snapshot?.phase === "failed"
              ? "error"
              : (snapshot?.phase ?? "starting"),
          error: snapshot?.loadFailure
            ? originBrowserLoadError(snapshot.loadFailure)
            : snapshot?.phase === "failed"
              ? originBrowserSessionError(snapshot.failureReason)
              : null,
          startupFailure: null,
        }
      : browser.state;
  const loading =
    ownerAvailable &&
    (phase === "starting" ||
      (phase === "attached" &&
        snapshot?.phase === "attached" &&
        snapshot.loading));
  const downloads = useOriginSelectedDownloads(
    rootSnapshot?.identity ?? null,
    selectedPopupId,
    ownerAvailable && isActive && nativeAttached && !popupBridge.pending,
    assertShellOwner,
  );
  const extensionReceipt = useNativeBrowserExtensionReceipt(
    snapshot?.identity ?? null,
    ownerAvailable && !isTemporary && isActive && phase === "attached",
    assertShellOwner,
  );
  const extensions = useNativeBrowserExtensions({
    connection: isTemporary ? undefined : connection,
    ownerDatabaseId: isTemporary ? undefined : session.ownerDatabaseId,
    identity: snapshot?.identity ?? null,
    receipt: extensionReceipt,
    webBrowserSettings: settings.webBrowser,
    websiteDarkModeSettings: settings.websiteDarkMode,
    settingsReady: settingsReady !== false,
    blocked: !ownerAvailable || !isActive || phase !== "attached",
    updateConnection: async (replacement) => {
      assertShellOwner();
      const scope = context.databaseAvailability;
      if (
        isTemporary ||
        !connection ||
        replacement.id !== connection.id ||
        scope?.status !== "ready" ||
        context
          .getCurrentConnections?.({
            databaseId: session.ownerDatabaseId!,
            generation: scope.generation,
          })
          ?.find((row) => row.id === connection.id) !== connection
      ) {
        throw new Error(
          "The saved website changed. Review its settings before saving.",
        );
      }
      await context.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: replacement,
      });
    },
  });
  // Only native knows the current address after redirects. The older-native
  // diagnostic fallback is display-only; never reconstruct from initialUrl.
  const reportedAddress = ownerAvailable
    ? (snapshot?.currentUrl ?? snapshot?.displayUrl ?? "")
    : "";
  const [address, setAddress] = useState<{
    identity: string;
    value: string;
  } | null>(null);
  const identity = `${rootSnapshot?.identity.attemptId ?? ""}:${selectedPopupId ?? "root"}`;
  const addressValue =
    ownerAvailable && address?.identity === identity
      ? address.value
      : reportedAddress;
  const attached =
    nativeAttached &&
    ownerAvailable &&
    isActive &&
    !dialogOpen &&
    !popupBridge.pending &&
    (!selectedPopupId || selectedPopup?.phase === "adopted");
  const selectedViewAvailable =
    ownerAvailable &&
    isActive &&
    settingsReady !== false &&
    nativeAttached &&
    !popupBridge.pending &&
    (!selectedPopupId ||
      (selectedPopup?.phase === "adopted" && !selectedPopup.closing));
  const pageMenu = useOriginPageMenu({
    identity: rootSnapshot?.identity ?? null,
    viewId: selectedPopupId,
    enabled: selectedViewAvailable,
    interactive: attached,
    assertOwner: assertShellOwner,
    runInteractive: popupBridge.runInteractive,
  });
  const findFeedback = useOriginFindResults({
    identity: rootSnapshot?.identity ?? null,
    viewId: selectedPopupId,
    enabled: selectedViewAvailable,
    documentKey: JSON.stringify([
      snapshot?.currentUrl ?? snapshot?.displayUrl,
      snapshot?.loading,
    ]),
    assertOwner: assertShellOwner,
  });
  // Opening/closing transient menus must not stop an active recording.
  const recording = useNativeBrowserRecording({
    identity: rootSnapshot?.identity ?? null,
    viewId: selectedPopupId,
    enabled: selectedViewAvailable,
    assertOwner: assertShellOwner,
  });
  const notices = useOriginBrowserNotices({
    identity: snapshot?.identity ?? null,
    enabled:
      ownerAvailable &&
      isActive &&
      settingsReady !== false &&
      phase === "attached",
    canReload: attached,
    assertOwner: assertShellOwner,
    reload: browser.reload,
  });
  const automation = useOriginWebsiteAutomation({
    connection: isTemporary ? undefined : connection,
    ownerDatabaseId: isTemporary ? undefined : session.ownerDatabaseId,
    settings,
    settingsReady: settingsReady !== false,
    scopeKey: proof
      ? JSON.stringify([
          session.ownerDatabaseId,
          session.id,
          proof.sourceSessionId,
          proof.expectedSecurityRevision,
        ])
      : "",
    // Our own confirmation/value dialogs hide the native child but must not
    // invalidate their reviewed document. Other browser tools suspend work.
    blocked:
      !!selectedPopupId ||
      popupBridge.pending ||
      isTemporary ||
      !ownerAvailable ||
      !isActive ||
      phase !== "attached" ||
      !!snapshot?.loading ||
      editing ||
      moreOpen ||
      bookmarksOpen ||
      credentialsOpen ||
      recordingOpen,
    identity: snapshot?.identity ?? null,
    navigationKey: JSON.stringify([
      snapshot?.loading,
      snapshot?.currentUrl ?? snapshot?.displayUrl,
    ]),
    assertOwner: assertShellOwner,
    updateConnection: async (replacement) => {
      assertShellOwner();
      if (isTemporary)
        throw new Error(
          "Save a connection before changing website automation settings.",
        );
      const scope = context.databaseAvailability;
      if (
        !scope ||
        scope.status !== "ready" ||
        !connection ||
        replacement.id !== connection.id
      )
        throw new Error("The saved website owner changed.");
      const saved = context
        .getCurrentConnections?.({
          databaseId: session.ownerDatabaseId!,
          generation: scope.generation,
        })
        ?.find((row) => row.id === connection.id);
      // Preserve concurrent bookmark/editor changes rather than saving a stale
      // whole connection merely to change an automation favorite or permission.
      if (saved !== connection)
        throw new Error(
          "The saved website changed. Review its current settings before saving.",
        );
      try {
        await context.dispatchAndFlush({
          type: "UPDATE_CONNECTION",
          payload: replacement,
        });
        proof!.assertCurrent();
      } catch {
        throw new Error(
          "Website automation settings could not be confirmed saved.",
        );
      }
    },
  });
  // Older native payloads only have a redacted display URL. It is not a safe
  // navigation target until edited; never resubmit a stripped login URL.
  const canNavigateAddress =
    attached &&
    !!addressValue.trim() &&
    (address?.identity === identity || snapshot?.currentUrl !== undefined);
  const [navigationError, setNavigationError] = useState(false);
  const nativeNavigationError =
    "navigationError" in browser.state &&
    typeof browser.state.navigationError === "string"
      ? browser.state.navigationError
      : null;
  const [recoveryError, setRecoveryError] = useState(false);
  const recoveryAllowed = isActive && !dialogOpen && settingsReady !== false;
  const recoveryScope = useRef({
    session,
    connection,
    proof,
    viewportState,
    recoveryAllowed,
  });
  useLayoutEffect(() => {
    recoveryScope.current = {
      session,
      connection,
      proof,
      viewportState,
      recoveryAllowed,
    };
  });
  const temporarySource =
    !session.ownerDatabaseId &&
    !!getQuickConnectConnection(session.connectionId);
  const recover = (action: BrowserRecoveryAction) => {
    const assertCurrent = () => {
      const current = recoveryScope.current;
      if (
        !lifetime.current ||
        !recoveryAllowed ||
        !current.recoveryAllowed ||
        current.session !== session ||
        current.connection !== connection ||
        current.proof !== proof ||
        current.viewportState !== viewportState
      )
        throw new Error("Browser recovery request expired.");
    };
    try {
      assertCurrent();
      setRecoveryError(false);
      if (action === "browser-settings") {
        if (!onOpenSettings)
          throw new Error("Settings navigation unavailable.");
        hide();
        onOpenSettings("webBrowser");
        return;
      }
      if (action === "database" || !ownerAvailable) {
        const accepted = requestOriginBrowserRecovery(
          {
            action: temporarySource ? "quick-connect" : "database",
            sessionId: session.id,
            connectionId: session.connectionId,
            ownerDatabaseId: session.ownerDatabaseId,
          },
          assertCurrent,
        );
        if (!accepted) throw new Error("Recovery navigation unavailable.");
        return;
      }
      assertShellOwner();
      if (isTemporary) {
        if (action === "connection" && attached) {
          addressRef.current?.focus();
          addressRef.current?.select();
          return;
        }
        if (
          [
            "permissions",
            "browser-session",
            "legacy-proxy",
            "network",
          ].includes(action)
        ) {
          if (!onOpenSettings)
            throw new Error("Settings navigation unavailable.");
          hide();
          onOpenSettings(action === "network" ? "proxy" : "webBrowser");
          return;
        }
      } else {
        const scope = context.databaseAvailability;
        captureSessionDatabaseAccess(session)();
        const rows =
          scope?.status === "ready" &&
          scope.databaseId === session.ownerDatabaseId
            ? context
                .getCurrentConnections?.({
                  databaseId: session.ownerDatabaseId!,
                  generation: scope.generation,
                })
                .filter((row) => row.id === session.connectionId)
            : undefined;
        if (!canEdit || rows?.length !== 1 || rows[0] !== connection)
          throw new Error("The saved connection changed.");
        if (action === "permissions") {
          hide();
          setEditing(true);
          return;
        }
      }
      if (action === "permissions") return;
      const accepted = requestOriginBrowserRecovery(
        {
          action: isTemporary ? "quick-connect" : action,
          sessionId: session.id,
          connectionId: session.connectionId,
          ownerDatabaseId: session.ownerDatabaseId,
        },
        () => {
          assertCurrent();
          assertShellOwner();
        },
      );
      if (!accepted) throw new Error("Recovery navigation unavailable.");
    } catch {
      if (lifetime.current) setRecoveryError(true);
    }
  };
  const recoveryActions = (actions: readonly BrowserRecoveryAction[]) => (
    <OriginBrowserRecoveryActions
      actions={actions}
      onRecover={recover}
      allowed={recoveryAllowed}
      temporary={isTemporary || temporarySource}
    />
  );
  const failureActions = getOriginBrowserFailureDetails(viewportState).map(
    (detail) => detail.action,
  );
  // A native permission rejection may involve shared and per-connection rules.
  if (
    failureActions.includes("permissions") &&
    !failureActions.includes("browser-settings")
  )
    failureActions.push("browser-settings");
  if (viewportState.startupFailure?.code === "permissions-invalid")
    failureActions.push("legacy-proxy");
  if (!failureActions.length) failureActions.push("browser-settings");
  const navigateTo = useCallback(
    (value: string) => {
      if (!attached) return;
      const attempt = identity;
      // A typed URL is passed only to native navigation, never a legacy mediator.
      void nativeNavigate(value).then((accepted) => {
        if (latestAttempt.current !== attempt) return;
        setNavigationError(!accepted);
        if (accepted) setAddress(null);
      });
    },
    [attached, identity, nativeNavigate],
  );
  const navigate = (event: React.FormEvent) => {
    event.preventDefault();
    if (canNavigateAddress) navigateTo(addressValue.trim());
  };
  const latestAttempt = useRef(identity);
  const [bookmarkNavigation, setBookmarkNavigation] = useState<{
    attempt: string;
    url: string;
    assertCurrent: () => void;
  } | null>(null);
  useEffect(() => {
    if (!bookmarkNavigation) return;
    if (
      !ownerAvailable ||
      !isActive ||
      bookmarkNavigation.attempt !== identity
    ) {
      setBookmarkNavigation(null);
      return;
    }
    if (!attached) return;
    setBookmarkNavigation(null);
    try {
      bookmarkNavigation.assertCurrent();
      navigateTo(bookmarkNavigation.url);
    } catch {
      setNavigationError(true);
    }
  }, [
    bookmarkNavigation,
    ownerAvailable,
    isActive,
    identity,
    attached,
    navigateTo,
  ]);
  useLayoutEffect(() => {
    latestAttempt.current = identity;
    setAddress(null);
    setNavigationError(false);
    setDevtoolsError(false);
  }, [identity, reportedAddress]);

  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-w-0 bg-[var(--color-background)] text-[var(--color-text)]"
      data-browser-engine="real-origin"
      onKeyDown={(event) => {
        if (
          attached &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "l"
        ) {
          event.preventDefault();
          event.stopPropagation();
          addressRef.current?.focus();
          addressRef.current?.select();
        }
      }}
    >
      <form
        onSubmit={navigate}
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-2"
        aria-label="Native browser navigation"
      >
        <button
          type="button"
          aria-label="Back"
          data-tooltip="Back"
          className="sor-btn sor-icon-btn-sm shrink-0"
          disabled={!attached || !snapshot?.canGoBack}
          onClick={() => void browser.back()}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <OriginHistoryMenu
          key={`back-history:${identity}:${ownerAvailable}`}
          direction="back"
          controller={pageMenu}
          canOpen={attached && !!snapshot?.canGoBack}
          eligible={selectedViewAvailable}
          assertOwner={assertShellOwner}
          onOverlayChange={setMoreOpen}
        />
        <button
          type="button"
          aria-label="Forward"
          data-tooltip="Forward"
          className="sor-btn sor-icon-btn-sm shrink-0"
          disabled={!attached || !snapshot?.canGoForward}
          onClick={() => void browser.forward()}
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <OriginHistoryMenu
          key={`forward-history:${identity}:${ownerAvailable}`}
          direction="forward"
          controller={pageMenu}
          canOpen={attached && !!snapshot?.canGoForward}
          eligible={selectedViewAvailable}
          assertOwner={assertShellOwner}
          onOverlayChange={setMoreOpen}
        />
        <button
          type="button"
          aria-label={snapshot?.loading ? "Stop" : "Reload"}
          data-tooltip={snapshot?.loading ? "Stop" : "Reload"}
          className="sor-btn sor-icon-btn-sm shrink-0"
          disabled={!attached}
          onClick={() =>
            void (snapshot?.loading ? browser.stop() : browser.reload())
          }
        >
          {snapshot?.loading ? (
            <Square size={16} aria-hidden="true" />
          ) : (
            <RotateCcw size={16} aria-hidden="true" />
          )}
        </button>
        <TextInput
          ref={addressRef}
          variant="form-sm"
          className="min-w-0 flex-[1_1_12rem] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Website address"
          aria-description={
            snapshot?.currentUrl !== undefined
              ? "Current website address reported by the native browser. URLs may contain sensitive query or fragment values."
              : "This native version reports a redacted address. Edit this field to navigate to a new URL."
          }
          placeholder="Waiting for native website address"
          value={addressValue}
          onChange={(value) => setAddress({ identity, value })}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setAddress(null);
            }
          }}
          disabled={!attached}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={!canNavigateAddress}
          aria-label="Go"
          data-tooltip="Go"
          className="sor-btn sor-icon-btn-sm shrink-0"
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Connection start page"
          data-tooltip="Connection start page"
          className="sor-btn sor-icon-btn-sm shrink-0"
          disabled={!attached || !initialUrl}
          onClick={() => navigateTo(initialUrl)}
        >
          <House size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Reconnect"
          data-tooltip="Reconnect"
          className="sor-btn sor-icon-btn-sm shrink-0"
          disabled={
            !ownerAvailable || phase === "starting" || phase === "closing"
          }
          onClick={browser.reconnect}
        >
          <RotateCw size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Browser settings"
          data-tooltip={
            isTemporary
              ? "Save a connection to change its browser settings."
              : "Browser settings"
          }
          className="sor-btn sor-icon-btn-sm shrink-0"
          disabled={!canEdit || !ownerAvailable || !recoveryAllowed}
          onClick={() => recover("permissions")}
        >
          <Settings2 size={16} aria-hidden="true" />
        </button>
        <NativeBrowserDownloads
          controller={downloads}
          allowed={browserConfig.allowDownloads}
          onOpenSettings={() => onOpenSettings?.("webBrowser")}
        />
        {!isTemporary && connection && (
          <OriginCredentialControls
            key={`credentials:${identity}:${session.id}:${session.ownerDatabaseId}`}
            session={session}
            connection={connection}
            eligible={selectedViewAvailable}
            canOpen={attached}
            assertOwner={assertShellOwner}
            onOverlayChange={setCredentialsOpen}
            typingOptions={{
              identity: rootSnapshot?.identity ?? null,
              viewId: selectedPopupId,
              enabled: selectedViewAvailable && !snapshot?.loading,
              interactive: attached,
              documentKey: JSON.stringify([
                identity,
                snapshot?.currentUrl ?? snapshot?.displayUrl,
                snapshot?.loading,
              ]),
              runInteractive: popupBridge.runInteractive,
            }}
          />
        )}
        <OriginToolbarPopover
          key={`recording:${identity}:${session.id}`}
          label="Recording"
          icon={
            <>
              <Video size={16} aria-hidden="true" />
              {(recording.video.phase === "recording" ||
                recording.har.phase === "recording") && (
                <span
                  className="absolute right-0 top-0 h-2 w-2 rounded-full bg-error"
                  aria-label="Recording active"
                />
              )}
            </>
          }
          eligible={selectedViewAvailable}
          canOpen={attached}
          scope={identity}
          assertOwner={assertShellOwner}
          onOverlayChange={setRecordingOpen}
        >
          {({ anchorRef, panelRef, onClose }) => (
            <PopoverSurface
              isOpen
              anchorRef={anchorRef}
              onClose={onClose}
              align="end"
              offset={4}
            >
              <section
                ref={panelRef}
                aria-label="Recording"
                className="sor-popover-panel w-96 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto text-[var(--color-text)]"
              >
                <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-3">
                  <h2 className="text-sm font-semibold">Recording</h2>
                  <button
                    type="button"
                    className="sor-icon-btn-sm"
                    aria-label="Close Recording"
                    onClick={onClose}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>
                <div className="p-3">
                  <NativeBrowserRecordingControls controller={recording} />
                </div>
              </section>
            </PopoverSurface>
          )}
        </OriginToolbarPopover>
        <button
          type="button"
          aria-label="Open page DevTools"
          data-tooltip="Open page DevTools"
          className="sor-btn sor-icon-btn-sm shrink-0"
          disabled={!attached}
          onClick={() => {
            const attempt = latestAttempt.current;
            setDevtoolsError(false);
            void browser.openDevTools().then((accepted) => {
              if (latestAttempt.current === attempt && lifetime.current)
                setDevtoolsError(!accepted);
            });
          }}
        >
          <Code2 size={16} aria-hidden="true" />
        </button>
        <OriginBookmarkButton
          key={`bookmark-page:${identity}:${ownerAvailable}`}
          session={session}
          bookmarks={connection?.httpBookmarks}
          initialUrl={initialUrl}
          currentUrl={snapshot?.currentUrl}
          currentTitle={snapshot?.title}
          temporary={isTemporary}
          eligible={
            ownerAvailable &&
            isActive &&
            phase === "attached" &&
            !popupBridge.pending &&
            settingsReady !== false
          }
          canOpen={attached}
          assertOwner={assertShellOwner}
          hideNative={hide}
          onOverlayChange={setBookmarksOpen}
        />
        <NativeBrowserExtensionControls
          controller={extensions}
          appearanceStatus={appearanceStatus}
        />
        <OriginPageTools
          key={`${identity}:${ownerAvailable}`}
          controller={browser}
          enabled={attached && !browserConfigInvalid}
          defaultZoom={browserConfig.defaultZoomPercent}
          activeViewKey={selectedPopupId ?? "root"}
          pageSnapshot={snapshot ?? null}
          findOpenRequest={pageMenu.findOpenRequest}
          findReady={findFeedback.ready}
          findResult={findFeedback.result}
        />
        <OriginMoreMenu
          key={`more:${identity}:${ownerAvailable}`}
          currentUrl={snapshot?.currentUrl}
          eligible={selectedViewAvailable}
          canOpen={attached}
          assertOwner={assertShellOwner}
          hideNative={hide}
          onOverlayChange={setMoreOpen}
          onRestart={restartEphemeralContext}
          session={session}
          connection={isTemporary ? undefined : connection}
          pageMenu={pageMenu}
          recording={recording}
        />
      </form>
      <OriginPopupTabs
        popups={popups}
        parentTitle={rootSnapshot?.title || "Website"}
      />
      {!isTemporary &&
        ownerAvailable &&
        browserConfig.showBookmarksBar &&
        connection && (
          <OriginBookmarkBar
            key={`bookmarks:${identity}:${session.id}:${session.ownerDatabaseId}:${isActive}`}
            session={session}
            bookmarks={connection.httpBookmarks}
            initialUrl={initialUrl}
            currentUrl={snapshot?.currentUrl}
            currentTitle={snapshot?.title}
            eligible={ownerAvailable && isActive && settingsReady !== false}
            canNavigate={
              phase === "attached" &&
              ownerAvailable &&
              isActive &&
              settingsReady !== false
            }
            assertOwner={assertShellOwner}
            hideNative={hide}
            onOverlayChange={setBookmarksOpen}
            onNavigate={(url, assertCurrent) =>
              setBookmarkNavigation({ attempt: identity, url, assertCurrent })
            }
            automationSlot={
              <OriginAutomationControls
                automation={automation}
                showFavorites={false}
              />
            }
            automation={automation}
          />
        )}
      {!isTemporary && ownerAvailable && !browserConfig.showBookmarksBar && (
        <div className="shrink-0 border-b border-[var(--color-border)] p-2">
          <OriginAutomationControls automation={automation} />
        </div>
      )}
      {browserConfigInvalid && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          {globalBrowserConfigInvalid
            ? "Shared Web Browser settings are invalid. Review and correct the shared configuration in Web Browser settings before connecting."
            : "Saved browser display preferences are invalid. Review this connection's browser session settings. Page tools are unavailable until these settings are corrected."}
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(
              globalBrowserConfigInvalid
                ? ["browser-settings"]
                : ["browser-session", "browser-settings"],
            )}
          </div>
        </div>
      )}
      {(nativeNavigationError || navigationError) && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          {nativeNavigationError ||
            "Navigation was not accepted. Enter an HTTP or HTTPS address and review the native browser status."}
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(["connection", "permissions"])}
          </div>
        </div>
      )}
      {pageMenu.error && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          {pageMenu.error}
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(["browser-settings"])}
          </div>
        </div>
      )}
      {devtoolsError && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          Page DevTools could not be opened for this browser view.
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(["browser-settings"])}
          </div>
        </div>
      )}
      {recoveryError && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          The recovery view could not be opened. Check that this tab is active
          in the main window and its owning database is open before reviewing
          the connection.
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(["database", "browser-settings"])}
          </div>
        </div>
      )}
      {!ownerAvailable && (
        <div className="shrink-0">
          <OriginBrowserCapabilityNotice
            owner={{
              ownerDatabaseId,
              connectionId: session.connectionId,
              sessionId: session.id,
            }}
          />
          <div className="mx-3 mb-2 flex flex-wrap gap-2">
            {recoveryActions([
              temporarySource ? "connection" : "database",
              "browser-settings",
            ])}
          </div>
        </div>
      )}
      {sharedPopupId && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          This legacy popup cannot attach to a real-origin browser. Open its
          saved connection in a new tab.
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(["database"])}
          </div>
        </div>
      )}
      {session.reattachOnly && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          Native browser reattachment is unavailable. Reopen the connection
          explicitly.
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(["database"])}
          </div>
        </div>
      )}
      {!connection && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          The saved connection is unavailable in this database.
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions([temporarySource ? "connection" : "database"])}
          </div>
        </div>
      )}
      {savedSource === null && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          This saved connection is no longer a website connection, so this tab
          cannot reconnect to it. Close this tab and open the connection again.
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(["connection"])}
          </div>
        </div>
      )}
      {!initialUrl && connection && savedSource !== null && (
        <div
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          The saved website address or application settings are invalid.
          <div className="mt-2 flex flex-wrap gap-2">
            {recoveryActions(
              isTemporary ? ["connection"] : ["connection", "application"],
            )}
          </div>
        </div>
      )}
      {restartNotice &&
        lastRestart &&
        !(
          lastRestart.reason === "proxy-unreachable" && restartStage === "done"
        ) && (
          // In the layout flow: a native child surface paints above DOM overlays.
          <div
            role="status"
            aria-label="Browser reconnection"
            className={`mx-3 mt-2 flex shrink-0 min-w-0 items-start gap-2 text-sm text-[var(--color-text)] ${
              restartStage === "failed"
                ? "sor-alert-warning"
                : "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            }`}
          >
            {restartStage === "running" ? (
              <LoaderCircle
                size={16}
                className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <RotateCw
                size={16}
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
            )}
            <p className="min-w-0 flex-1">{restartNotice}</p>
            <button
              type="button"
              className="sor-btn sor-icon-btn-sm shrink-0"
              aria-label="Dismiss reconnection notice"
              onClick={() => setDismissedRestart(lastRestart.serial)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      <OriginBrowserNotices notices={notices} />
      {browserConfig.showLoadingProgress && (
        // Native child surfaces paint above DOM overlays. Reserve shell space
        // outside the measured viewport, even between loads, to avoid jitter.
        <div
          className="relative h-[2px] shrink-0"
          data-testid="origin-navigation-progress-slot"
        >
          {isActive && loading && (
            <div
              className={progressStyles.track}
              role="progressbar"
              aria-label="Loading page"
              aria-valuetext="Waiting for the page to become ready"
            >
              <span className={progressStyles.segment} aria-hidden="true" />
            </div>
          )}
        </div>
      )}
      <OriginBrowserViewport
        preserveRenderingUnderOverlays
        controller={{ ...browser, state: viewportState }}
        active={isActive}
        ownerAvailable={ownerAvailable}
        dialogOpen={dialogOpen}
        title={snapshot?.title || session.name}
        showLoadingProgress={false}
        loading={loading}
        retryAllowed={
          settingsReady !== false && !browserConfigInvalid && !!initialUrl
        }
        onOpenSettings={onOpenSettings}
        errorDetails={
          <OriginBrowserFailureDiagnostics
            key={`diagnostics:${identity}`}
            state={viewportState}
            targetUrl={
              snapshot?.displayUrl || (selectedPopupId ? "" : initialUrl)
            }
            active={isActive && !dialogOpen}
            ownerAvailable={ownerAvailable}
            assertOwner={assertShellOwner}
            onOpenDevTools={() => browser.openDevTools()}
            onRestartProxy={() => browser.restart("requested")}
            onRecover={recover}
            recoveryAllowed={recoveryAllowed}
          />
        }
        errorActions={
          <>
            {recoveryActions(failureActions)}
            {phase === "error" &&
              startupFailure?.reason === "mfa-origin-mismatch" &&
              startupFailure !== repairedMfaFailure &&
              isActive &&
              ownerAvailable &&
              !isTemporary &&
              connection && (
                <OriginMfaOriginRepair
                  session={session}
                  connection={connection}
                  assertOwner={assertShellOwner}
                  onOverlayChange={hide}
                  // Keep the error and explicit Retry; saving never starts login.
                  onRepaired={() => setRepairedMfaFailure(startupFailure)}
                />
              )}
          </>
        }
      />
      <div
        className="flex shrink-0 min-w-0 items-center gap-1.5 border-t border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-textSecondary)]"
        role="status"
        aria-label="Browser status"
      >
        <span className="min-w-0 flex-1 truncate">
          {ownerAvailable && snapshot?.title ? snapshot.title : session.name}
          {isTemporary && (
            <span title="Bookmarks, favorites and connection settings require a saved connection.">
              {" · Temporary Quick Connect"}
            </span>
          )}
          {restarting
            ? " · reconnecting"
            : loading && browserConfig.showLoadingProgress
              ? " · Loading"
              : viewportState.phase !== "attached"
                ? ` · ${viewportState.phase}`
                : ""}
        </span>
        {browserConfig.showSecurityInfo && (
          <span
            tabIndex={0}
            aria-label="Browser policy"
            data-tooltip="Forced dark content. Auto-login requires fresh native consent for each attempt. Requests remain subject to native route and domain policy."
            className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ShieldCheck size={14} aria-hidden="true" />
          </span>
        )}
      </div>
      {permissionsOpen && connection && (
        <BrowserPermissionsDialog
          session={session}
          connection={connection}
          config={globalBrowserConfig}
          onClose={() => setEditing(false)}
          onSave={async (config, permissions, reconnect) => {
            assertShellOwner();
            const lease = captureSessionDatabaseAccess(session);
            const settingsAtStart = JSON.stringify(settings.webBrowser);
            const assertAccess = () => {
              lease();
              if (
                !lifetime.current ||
                JSON.stringify(currentSettings.current) !== settingsAtStart
              )
                throw new Error();
            };
            const scope = context.databaseAvailability!;
            const currentRow = () =>
              context
                .getCurrentConnections?.({
                  databaseId: session.ownerDatabaseId!,
                  generation: scope.generation,
                })
                ?.find((row) => row.id === connection.id);
            const saved = currentRow();
            if (
              !saved ||
              saved.websiteDomainPermissions !==
                connection.websiteDomainPermissions
            )
              throw new Error();
            // Runs only once the open page is confirmed closed.
            const persist = async () => {
              assertAccess();
              const savedAfterClose = currentRow();
              if (
                !savedAfterClose ||
                savedAfterClose.websiteDomainPermissions !==
                  saved.websiteDomainPermissions
              )
                throw new Error();
              await context.dispatchAndFlush({
                type: "UPDATE_CONNECTION",
                payload: {
                  ...savedAfterClose,
                  websiteDomainPermissions: permissions,
                },
              });
              // The attempt created next reads this row: it is not a change
              // that a second, automatic reconnect has to follow.
              const written = currentRow();
              if (written && lifetime.current)
                setApplied((current) => ({
                  ...current,
                  authoritySignature: nativeBrowserAuthoritySignature(written),
                }));
              assertAccess();
              await updateSettings({ webBrowser: config });
              lease();
            };
            if (!reconnect) {
              setFinishing(true);
              try {
                await browser.close(true);
              } catch (failure) {
                // The page is still open, so the tab does not end.
                if (lifetime.current) setFinishing(false);
                throw failure;
              }
              try {
                await persist();
              } catch {
                throw new SaveAfterCloseError();
              }
              if (!lifetime.current) return;
              setEditing(false);
              setFinishing(false);
              return;
            }
            let persisted = false;
            let replaced: boolean;
            setSettingsSave("pending");
            try {
              // Close, save, create: the tab never reads as ended in between.
              replaced = await browser.restart("settings-saved", {
                beforeCreate: async () => {
                  try {
                    await persist();
                  } catch (failure) {
                    if (lifetime.current) setSettingsSave("failed");
                    throw failure;
                  }
                  persisted = true;
                  if (lifetime.current) setSettingsSave("saved");
                },
              });
            } catch {
              // The hook replaces the tab even though the save then failed.
              throw new SaveAfterCloseError();
            }
            // Refused, or the open page could not be confirmed closed.
            if (!replaced && !persisted) throw new Error();
            if (!lifetime.current) return;
            setEditing(false);
            // Released only now: a page closed by an earlier, failed "Save for
            // next connection" must not end the tab while it is replaced.
            setFinishing(false);
          }}
        />
      )}
    </div>
  );
}

function BrowserPermissionsDialog({
  session,
  connection,
  config,
  onClose,
  onSave,
}: {
  session: ConnectionSession;
  connection: Connection;
  config: WebBrowserSettingsConfig;
  onClose: () => void;
  onSave: (
    config: WebBrowserSettingsConfig,
    permissions: WebsiteDomainPermissionsSettings | undefined,
    reconnect: boolean,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  const [permissions, setPermissions] = useState(
    connection.websiteDomainPermissions,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<
    false | "unsaved" | "restarted" | "closed"
  >(false);
  const alive = useRef(true);
  const original = useRef({
    config: JSON.stringify(config),
    permissions: JSON.stringify(connection.websiteDomainPermissions),
  });
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const save = async (reconnect: boolean) => {
    if (pending) return;
    setError(false);
    setPending(true);
    try {
      captureSessionDatabaseAccess(session)();
      const saved = JSON.stringify(connection.websiteDomainPermissions);
      if (
        original.current.config !== JSON.stringify(config) ||
        // Unchanged since this form opened, or already what an earlier save
        // of this same form wrote before it failed.
        (original.current.permissions !== saved &&
          saved !== JSON.stringify(permissions))
      )
        throw new Error();
      await onSave(draft, permissions, reconnect);
    } catch (failure) {
      if (alive.current)
        setError(
          !(failure instanceof SaveAfterCloseError)
            ? "unsaved"
            : reconnect
              ? "restarted"
              : "closed",
        );
    } finally {
      if (alive.current) setPending(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={pending ? undefined : onClose}
      ariaLabel="Browser request permissions"
      panelClassName="max-w-4xl w-full mx-3 max-h-[90dvh]"
      contentClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <ModalHeader
        className="shrink-0"
        title={
          <h3 className="flex items-center gap-2">
            <Settings2 size={18} className="text-primary" aria-hidden="true" />
            Browser settings
          </h3>
        }
        onClose={pending ? undefined : onClose}
      />
      <ModalBody className="min-h-0 overflow-y-auto p-4 space-y-4">
        <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
          Saved permissions never apply to a page that is already open. Save and
          reconnect closes this page, saves and opens it again in this tab. Save
          for next connection closes this page, saves and leaves this tab
          disconnected. Login consent and certificate trust remain separate.
        </p>
        <SettingsCard>
          <WebsiteDomainPermissionsEditor
            settings={draft.domainPermissions}
            onChange={(domainPermissions) =>
              setDraft((current) => ({ ...current, domainPermissions }))
            }
            disabled={pending}
          />
        </SettingsCard>
        <SettingsCard>
          <OriginConnectionPermissions
            settings={permissions}
            sharedSettings={draft.domainPermissions}
            onChange={setPermissions}
            disabled={pending}
          />
        </SettingsCard>
        {error && (
          <p
            role="alert"
            className="sor-alert-error text-sm text-[var(--color-text)]"
          >
            {error === "unsaved"
              ? "Nothing was saved. Check database access and the browser status behind this dialog, then try again. If these settings were changed elsewhere in the meantime, reopen this dialog first."
              : error === "restarted"
                ? "The settings could not be fully saved. This tab was restarted with what is saved now. Check database access, then save again."
                : "The settings could not be fully saved, and this tab's page is already closed. Check database access, then save again."}{" "}
            Your changes are still in this form.
          </p>
        )}
        {pending && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]"
          >
            <LoaderCircle
              size={16}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Saving permissions and closing this browser attempt…
          </p>
        )}
      </ModalBody>
      <ModalFooter className="shrink-0 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={pending}
          onClick={() => void save(false)}
        >
          <Save size={16} aria-hidden="true" />
          Save for next connection
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={pending}
          onClick={() => void save(true)}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Save and reconnect
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </button>
      </ModalFooter>
    </Modal>
  );
}
