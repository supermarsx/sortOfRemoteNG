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
  LoaderCircle,
  RotateCcw,
  RotateCw,
  Save,
  Settings2,
  ShieldCheck,
  Square,
} from "lucide-react";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import { useConnections } from "../../../contexts/useConnections";
import { useSettings } from "../../../contexts/SettingsContext";
import { useSessionRenderActivity } from "../../../contexts/SessionRenderActivityContext";
import { useOriginBrowser } from "../../../hooks/protocol/useOriginBrowser";
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
  const globalBrowserConfig = normalizeWebBrowserSettings(settings.webBrowser);
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
  let browserConfigInvalid = false;
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
  const dialogOpen = editing || moreOpen || bookmarksOpen || overlayOpen;
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
    enabled: settingsReady !== false,
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
  const { snapshot: rootSnapshot, phase } = browser.state;
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
    enabled: ownerAvailable && phase === "attached",
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
  const downloads = useOriginSelectedDownloads(
    rootSnapshot?.identity ?? null,
    selectedPopupId,
    ownerAvailable && isActive && phase === "attached" && !popupBridge.pending,
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
    phase === "attached" &&
    ownerAvailable &&
    isActive &&
    !dialogOpen &&
    !popupBridge.pending &&
    (!selectedPopupId || selectedPopup?.phase === "adopted");
  const selectedViewAvailable =
    ownerAvailable &&
    isActive &&
    settingsReady !== false &&
    phase === "attached" &&
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
      bookmarksOpen,
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
    !isTemporary &&
    context.databaseAvailability?.status === "ready" &&
    context.databaseAvailability.databaseId === session.ownerDatabaseId &&
    !!connection;
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
          disabled={!canEdit}
          onClick={() => {
            hide();
            setEditing(true);
          }}
        >
          <Settings2 size={16} aria-hidden="true" />
        </button>
        <NativeBrowserDownloads
          controller={downloads}
          allowed={browserConfig.allowDownloads}
          onOpenSettings={() => onOpenSettings?.("webBrowser")}
        />
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
      <div
        className="flex shrink-0 min-w-0 items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-textSecondary)]"
        role="status"
      >
        {browserConfig.showLoadingProgress &&
          (phase === "starting" || snapshot?.loading) && (
            <LoaderCircle
              size={14}
              aria-hidden="true"
              className="shrink-0 animate-spin motion-reduce:animate-none text-primary"
            />
          )}
        <span className="min-w-0 flex-1 truncate">
          {ownerAvailable && snapshot?.title ? snapshot.title : session.name}
          {isTemporary && (
            <span title="Bookmarks, favorites and connection settings require a saved connection.">
              {" · Temporary Quick Connect"}
            </span>
          )}
          {snapshot?.loading
            ? browserConfig.showLoadingProgress
              ? " · Loading"
              : ""
            : phase !== "attached"
              ? ` · ${phase}`
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
      {browserConfigInvalid && (
        <p
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          Saved browser display preferences are invalid. Review this
          connection's browser session settings. Page tools are unavailable
          until these settings are corrected.
        </p>
      )}
      {(nativeNavigationError || navigationError) && (
        <p
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          {nativeNavigationError ||
            "Navigation was not accepted. Enter an HTTP or HTTPS address and review the native browser status."}
        </p>
      )}
      {pageMenu.error && (
        <p
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          {pageMenu.error}
        </p>
      )}
      {!ownerAvailable && (
        <OriginBrowserCapabilityNotice
          owner={{
            ownerDatabaseId,
            connectionId: session.connectionId,
            sessionId: session.id,
          }}
        />
      )}
      {sharedPopupId && (
        <p
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          This legacy popup cannot attach to a real-origin browser. Open its
          saved connection in a new tab.
        </p>
      )}
      {session.reattachOnly && (
        <p
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          Native browser reattachment is unavailable. Reopen the connection
          explicitly.
        </p>
      )}
      {!connection && (
        <p
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          The saved connection is unavailable in this database.
        </p>
      )}
      {!initialUrl && connection && (
        <p
          role="alert"
          className="sor-alert-error mx-3 mt-2 text-sm text-[var(--color-text)]"
        >
          The saved website address or application settings are invalid.
        </p>
      )}
      <OriginBrowserNotices notices={notices} />
      <OriginBrowserViewport
        preserveRenderingUnderOverlays
        controller={browser}
        active={isActive}
        ownerAvailable={ownerAvailable}
        dialogOpen={dialogOpen}
        title={snapshot?.title || session.name}
        showLoadingProgress={browserConfig.showLoadingProgress}
        onOpenSettings={onOpenSettings}
      />
      {editing && canEdit && connection && (
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
