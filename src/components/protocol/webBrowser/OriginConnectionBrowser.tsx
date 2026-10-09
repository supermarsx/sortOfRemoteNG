import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { useSessionRenderActivity } from "../../../contexts/SessionRenderActivityContext";
import { useOriginBrowser } from "../../../hooks/protocol/useOriginBrowser";
import {
  originBrowserLoadError,
  originBrowserSessionError,
} from "../../../hooks/protocol/originBrowserSessionError";
import { useOriginBrowserOwner } from "../../../hooks/protocol/useOriginBrowserOwner";
import { useOriginQuickConnection } from "../../../hooks/protocol/useOriginQuickConnection";
import { useOriginBrowserOverlays } from "../../../hooks/protocol/useOriginBrowserOverlays";
import { originBrowserConnectionTarget } from "../../../hooks/protocol/originBrowserConnectionTarget";
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
  let initialUrl = "";
  try {
    if (connection)
      initialUrl = originBrowserConnectionTarget(connection, session);
  } catch {
    /* Native navigation remains disabled. */
  }
  const ownerAvailable =
    !!proof && !!connection && !sharedPopupId && !session.reattachOnly;
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
  useEffect(() => {
    if (
      !lifetime.current ||
      !ownerAvailable ||
      !proof ||
      !connectionStatus ||
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
  ]);
  // A document load error retains its native attempt for back/address/inspection.
  const nativeAttached =
    phase === "attached" ||
    (phase === "error" &&
      rootSnapshot?.phase === "attached" &&
      !!rootSnapshot.loadFailure);
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
    await browser.close(true);
    assertShellOwner();
    browser.reconnect();
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
  const canEdit =
    !globalBrowserConfigInvalid &&
    !isTemporary &&
    context.databaseAvailability?.status === "ready" &&
    context.databaseAvailability.databaseId === session.ownerDatabaseId &&
    !!connection;
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
      {!initialUrl && connection && (
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
          {loading && browserConfig.showLoadingProgress
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
      {editing && canEdit && ownerAvailable && isActive && connection && (
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
            const current = context.getCurrentConnections?.({
              databaseId: session.ownerDatabaseId!,
              generation: scope.generation,
            });
            const saved = current?.find((row) => row.id === connection.id);
            if (
              !saved ||
              saved.websiteDomainPermissions !==
                connection.websiteDomainPermissions
            )
              throw new Error();
            await browser.close(true);
            assertAccess();
            const currentAfterClose = context.getCurrentConnections?.({
              databaseId: session.ownerDatabaseId!,
              generation: scope.generation,
            });
            const savedAfterClose = currentAfterClose?.find(
              (row) => row.id === connection.id,
            );
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
            assertAccess();
            await updateSettings({ webBrowser: config });
            lease();
            if (!lifetime.current) return;
            setEditing(false);
            if (reconnect) browser.reconnect();
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
  const [error, setError] = useState(false);
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
      if (
        original.current.config !== JSON.stringify(config) ||
        original.current.permissions !==
          JSON.stringify(connection.websiteDomainPermissions)
      )
        throw new Error();
      await onSave(draft, permissions, reconnect);
    } catch {
      if (alive.current) setError(true);
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
          Saving closes this browser attempt. Saved permissions apply to the
          next connection; Save and reconnect starts a new attempt. Login
          consent and certificate trust remain separate.
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
            Settings could not be fully saved. Check database access and current
            settings before retrying. The browser has not been restarted.
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
