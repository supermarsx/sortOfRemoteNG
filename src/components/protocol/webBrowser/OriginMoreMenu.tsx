import React, { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  ExternalLink,
  Eraser,
  MoreHorizontal,
  KeyRound,
  Printer,
  History,
  Video,
  Search,
  SquarePlus,
} from "lucide-react";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import { normalizeTerminalLink } from "../../../utils/ssh/terminalLinks";
import { MenuSurface } from "../../ui/overlays/MenuSurface";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../../ui/overlays/Modal";
import OriginCredentialCopyPanel from "./OriginCredentialCopyPanel";
import NativeBrowserRecordingControls from "./NativeBrowserRecordingControls";
import OriginHistoryList from "./OriginHistoryList";
import type { NativeBrowserRecordingController } from "../../../hooks/protocol/useNativeBrowserRecording";
import type { OriginPageMenuController } from "../../../hooks/protocol/useOriginPageMenu";

type Review =
  | { kind: "external"; url: string }
  | { kind: "clear" | "credentials" | "history" | "recording" };

/** Mounted per native attempt. Full addresses stay volatile and leave only on
 * an explicit copy/open click; diagnostic URLs and address drafts are not used. */
export default function OriginMoreMenu({
  currentUrl,
  eligible,
  canOpen,
  assertOwner,
  hideNative,
  onOverlayChange,
  onRestart,
  session,
  connection,
  pageMenu,
  recording,
}: {
  currentUrl?: string;
  eligible: boolean;
  canOpen: boolean;
  assertOwner: () => void;
  hideNative: () => void;
  onOverlayChange: (open: boolean) => void;
  onRestart: () => Promise<void>;
  session: ConnectionSession;
  connection?: Connection;
  pageMenu: OriginPageMenuController;
  recording: NativeBrowserRecordingController;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [review, setReview] = useState<Review | null>(null);
  const surface = useRef<"menu" | Review | null>(null);
  const opening = useRef(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const alive = useRef(false);
  const latest = useRef({ currentUrl, eligible, assertOwner });
  useLayoutEffect(() => {
    latest.current = { currentUrl, eligible, assertOwner };
  });
  useLayoutEffect(() => {
    const lifetimeOpening = opening;
    alive.current = true;
    return () => {
      alive.current = false;
      lifetimeOpening.current++;
      surface.current = null;
      onOverlayChange(false);
    };
  }, [onOverlayChange]);
  const dismiss = () => {
    opening.current++;
    surface.current = null;
    setPosition(null);
    setReview(null);
    setMessage("");
    onOverlayChange(false);
  };
  useLayoutEffect(() => {
    if (
      !eligible ||
      (review?.kind === "external" && review.url !== currentUrl)
    ) {
      opening.current++;
      surface.current = null;
      setPosition(null);
      setReview(null);
      setMessage("");
      onOverlayChange(false);
    }
  }, [eligible, currentUrl, review, onOverlayChange]);
  const check = (url?: string) => {
    if (
      !alive.current ||
      !latest.current.eligible ||
      document.hidden ||
      (url !== undefined && latest.current.currentUrl !== url)
    )
      throw new Error();
    latest.current.assertOwner();
  };
  const url = currentUrl ? normalizeTerminalLink(currentUrl) : null;
  // Native snapshots are canonical; never silently substitute a rewritten URL.
  const validUrl = url === currentUrl ? url : null;
  const openReview = (next: Review) => {
    if (surface.current !== "menu") return;
    try {
      check(next.kind === "external" ? next.url : undefined);
    } catch {
      dismiss();
      return;
    }
    hideNative();
    opening.current++;
    surface.current = next;
    onOverlayChange(true);
    setReview(next);
    setPosition(null);
    setMessage("");
  };
  const copyAddress = async () => {
    if (!validUrl || pending.current || surface.current !== "menu") return;
    const epoch = opening.current;
    const currentOpening = () =>
      alive.current &&
      opening.current === epoch &&
      surface.current === "menu" &&
      latest.current.eligible &&
      latest.current.currentUrl === validUrl;
    try {
      check(validUrl);
      pending.current = true;
      setBusy(true);
      await navigator.clipboard.writeText(validUrl);
      if (!currentOpening()) return;
      check(validUrl);
      setMessage(
        "Address copied. It may contain sensitive query or fragment values.",
      );
    } catch {
      if (currentOpening()) setMessage("Could not copy the current address.");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const confirm = async () => {
    if (
      !review ||
      (review.kind !== "external" && review.kind !== "clear") ||
      pending.current ||
      surface.current !== review
    )
      return;
    const captured = review;
    try {
      check(captured.kind === "external" ? captured.url : undefined);
      pending.current = true;
      setBusy(true);
      setMessage("");
      if (captured.kind === "external") {
        if (normalizeTerminalLink(captured.url) !== captured.url)
          throw new Error();
        // Shared app opener; no window.open or rejected-command fallback.
        await invoke("open_url_external", { url: captured.url });
      } else await onRestart();
      if (alive.current && surface.current === captured) dismiss();
    } catch {
      if (
        alive.current &&
        latest.current.eligible &&
        surface.current === captured
      )
        setMessage(
          "The action could not be completed. Check database access and try again.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const title =
    review?.kind === "external"
      ? "Open in system browser?"
      : review?.kind === "clear"
        ? "Clear this browser session?"
        : review?.kind === "history"
          ? "Browsing history"
          : review?.kind === "recording"
            ? "Recording"
            : "Copy connection credentials";
  const runAfterClose = (action: () => void) => {
    try {
      check();
    } catch {
      dismiss();
      return;
    }
    dismiss();
    action();
  };
  const recordingActive =
    recording.har.phase === "recording" ||
    ["recording", "paused"].includes(recording.video.phase);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="sor-btn sor-icon-btn-sm shrink-0"
        aria-label="More browser actions"
        aria-description={
          recordingActive
            ? "A recording is active. Open Recording to stop or save it."
            : undefined
        }
        data-tooltip="More browser actions"
        aria-haspopup="menu"
        aria-expanded={!!position}
        disabled={!canOpen && !position}
        onClick={() => {
          if (position) {
            dismiss();
            return;
          }
          try {
            check();
          } catch {
            return;
          }
          const bounds = trigger.current?.getBoundingClientRect();
          if (!bounds) return;
          hideNative();
          opening.current++;
          surface.current = "menu";
          onOverlayChange(true);
          setPosition({ x: bounds.right - 288, y: bounds.bottom + 4 });
        }}
      >
        <MoreHorizontal
          size={16}
          aria-hidden="true"
          className={recordingActive ? "text-error" : undefined}
        />
      </button>
      <MenuSurface
        isOpen={!!position && eligible}
        position={position}
        onClose={busy ? undefined : dismiss}
        ignoreRefs={[trigger]}
        ariaLabel="More browser actions"
        className="w-72 max-w-[calc(100vw-1rem)]"
      >
        <button
          type="button"
          className="sor-menu-item gap-2"
          role="menuitem"
          disabled={!validUrl || busy}
          onClick={() => void copyAddress()}
        >
          <Copy size={16} aria-hidden="true" />
          Copy current address
        </button>
        <button
          type="button"
          className="sor-menu-item gap-2"
          role="menuitem"
          disabled={!validUrl || busy}
          onClick={() =>
            validUrl && openReview({ kind: "external", url: validUrl })
          }
        >
          <ExternalLink size={16} aria-hidden="true" />
          Open in system browser…
        </button>
        {!validUrl && (
          <p className="px-3 py-1 text-xs text-[var(--color-textSecondary)]">
            A full validated native address is required; a redacted address
            cannot be copied or opened.
          </p>
        )}
        {validUrl && (
          <p className="px-3 py-1 text-xs text-[var(--color-textSecondary)]">
            Copying includes sensitive query and fragment values on the system
            clipboard.
          </p>
        )}
        <button
          type="button"
          className="sor-menu-item gap-2"
          role="menuitem"
          disabled={busy}
          onClick={() => openReview({ kind: "clear" })}
        >
          <Eraser size={16} aria-hidden="true" />
          Clear session…
        </button>
        <button
          type="button"
          className="sor-menu-item gap-2"
          role="menuitem"
          disabled={!connection || busy}
          onClick={() => openReview({ kind: "credentials" })}
        >
          <KeyRound size={16} aria-hidden="true" />
          Copy credentials…
        </button>
        <div
          role="separator"
          className="my-1 border-t border-[var(--color-border)]"
        />
        {[
          {
            label: "Open in new tab",
            Icon: SquarePlus,
            action: () => runAfterClose(pageMenu.openTab),
          },
          {
            label: "Print / Save as PDF…",
            Icon: Printer,
            action: () => runAfterClose(pageMenu.print),
          },
          {
            label: "Find in page",
            Icon: Search,
            action: () => runAfterClose(pageMenu.find),
          },
          {
            label: "History menu",
            Icon: History,
            action: () => {
              openReview({ kind: "history" });
              void pageMenu.refreshHistory();
            },
          },
          {
            label: recordingActive ? "Recording · active" : "Recording",
            Icon: Video,
            action: () => openReview({ kind: "recording" }),
          },
        ].map(({ label, Icon, action }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            disabled={busy || pageMenu.busy}
            onClick={action}
            aria-label={label}
            className="sor-menu-item items-start gap-2 whitespace-normal disabled:opacity-60"
          >
            <Icon size={16} aria-hidden="true" className="shrink-0 mt-0.5" />
            <span className="text-left">{label}</span>
          </button>
        ))}
        {message && (
          <p
            role="status"
            className="px-3 py-2 text-xs text-[var(--color-textSecondary)]"
          >
            {message}
          </p>
        )}
      </MenuSurface>
      {review && eligible && (
        <Modal
          isOpen
          ariaLabel={title}
          panelClassName="max-w-xl mx-4"
          initialFocusRef={cancel}
          onClose={busy ? undefined : dismiss}
        >
          <ModalHeader title={title} onClose={busy ? undefined : dismiss} />
          <ModalBody className="space-y-4 p-5">
            {review.kind === "external" ? (
              <>
                <p className="text-sm text-[var(--color-textSecondary)]">
                  This opens a separate system browser outside this app's
                  private proxy route. It uses its own network, proxy, cookies
                  and sign-in state. Native browser cookies and saved
                  credentials are not transferred.
                </p>
                <p className="sor-alert-warning text-sm text-[var(--color-text)]">
                  The full address may contain sensitive query or fragment
                  values. Only continue if you want to send this address to your
                  system browser.
                </p>
                <p
                  dir="ltr"
                  className="max-h-40 overflow-auto break-all rounded border border-[var(--color-border)] p-3 font-mono text-xs"
                  style={{ unicodeBidi: "plaintext" }}
                >
                  {review.url}
                </p>
              </>
            ) : review.kind === "clear" ? (
              <p className="text-sm text-[var(--color-textSecondary)]">
                Close this attempt and start the saved connection in a new
                ephemeral browser context. This ends this context's cookies and
                sign-in state. It does not delete persistent browser profiles,
                saved credentials, other tabs, or system-browser sessions.
                Auto-login will require fresh native consent.
              </p>
            ) : review.kind === "history" ? (
              <OriginHistoryList
                controller={pageMenu}
                onJump={(index) => runAfterClose(() => pageMenu.jump(index))}
              />
            ) : review.kind === "recording" ? (
              <NativeBrowserRecordingControls controller={recording} />
            ) : (
              connection && (
                <OriginCredentialCopyPanel
                  session={session}
                  connection={connection}
                  assertOwner={check}
                />
              )
            )}
            {message && (
              <p
                role="alert"
                className="sor-alert-error text-sm text-[var(--color-text)]"
              >
                {message}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <button
              ref={cancel}
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={busy}
              onClick={dismiss}
            >
              {review.kind === "external" || review.kind === "clear"
                ? "Cancel"
                : "Done"}
            </button>
            {(review.kind === "external" || review.kind === "clear") && (
              <button
                type="button"
                className="sor-btn sor-btn-primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy
                  ? "Working…"
                  : review.kind === "external"
                    ? "Open in system browser"
                    : "Clear and restart"}
              </button>
            )}
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
