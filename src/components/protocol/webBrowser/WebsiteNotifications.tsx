import { useEffect, useId, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import type { SectionProps } from "./types";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import ApplicationSignInNotice from "./ApplicationSignInNotice";
import WebNetworkNotice from "./WebNetworkNotice";
import WebAutomationNotice from "./WebAutomationNotice";

/** Local disclosure only. Closing it never clears reports or changes authority. */
export default function WebsiteNotifications({
  mgr,
}: {
  mgr: Pick<
    SectionProps["mgr"],
    | "webProxyOrigin"
    | "currentUrl"
    | "webNetworkReports"
    | "webNetworkRouting"
    | "webNetworkGuard"
    | "handleRefresh"
    | "applicationExternalTarget"
    | "openingApplicationExternal"
    | "handleOpenApplicationExternal"
  > & {
    session: Pick<SectionProps["mgr"]["session"], "id" | "ownerDatabaseId">;
    automation: Pick<
      SectionProps["mgr"]["automation"],
      "error" | "busy" | "reload" | "recordingScopeKey"
    >;
  };
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const source = JSON.stringify([
    mgr.session.id,
    mgr.session.ownerDatabaseId,
    mgr.webProxyOrigin,
    mgr.currentUrl,
    mgr.automation.recordingScopeKey,
  ]);
  const [selection, setSelection] = useState<string | null>(null);
  const open = selection === source;
  useEffect(() => {
    setSelection(null);
  }, [source]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      closeButton.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const close = () => {
    setSelection(null);
    anchor.current?.focus({ preventScroll: true });
  };
  const reports = mgr.webNetworkReports ?? [];
  const issues =
    reports.length +
    (mgr.webNetworkRouting && mgr.webNetworkRouting.status !== "current"
      ? 1
      : 0) +
    (mgr.webNetworkGuard?.frameNavigation === "failed" ? 1 : 0) +
    (mgr.automation.error ? 1 : 0);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label="Website notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={
          issues
            ? `Website notifications: ${issues} issue${issues === 1 ? "" : "s"}`
            : "Website notifications: routing and sign-in help"
        }
        className={`sor-icon-btn-sm relative ${issues ? "text-warning" : ""}`}
        onClick={() => (open ? close() : setSelection(source))}
      >
        <Bell size={16} aria-hidden="true" />
        {issues > 0 && (
          <span
            aria-label={`${issues} website issue${issues === 1 ? "" : "s"}`}
            className="absolute -right-1 -top-1 min-w-3 rounded-full bg-warning px-0.5 text-center text-[9px] font-semibold text-black"
          >
            {issues > 99 ? "99+" : issues}
          </span>
        )}
      </button>
      {open && (
        <PopoverSurface
          isOpen
          anchorRef={anchor}
          onClose={close}
          align="end"
          className="w-[28rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg shadow-xl"
        >
          <div
            id={id}
            role="dialog"
            aria-label="Website notifications"
            className="max-h-[min(70vh,32rem)] overflow-y-auto text-[var(--color-text)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <h2 className="text-sm font-semibold">Website notifications</h2>
              <button
                ref={closeButton}
                type="button"
                className="sor-icon-btn-sm"
                aria-label="Close website notifications"
                onClick={close}
              >
                <X size={16} />
              </button>
            </div>
            <p className="px-3 py-2 text-xs text-[var(--color-textMuted)]">
              {issues
                ? `${issues} issue${issues === 1 ? "" : "s"} reported. Closing this panel does not dismiss them.`
                : "No website issues reported. Routing limitations and sign-in help are available below."}
            </p>
            <WebAutomationNotice automation={mgr.automation} />
            <WebNetworkNotice
              reports={reports}
              guard={mgr.webNetworkGuard ?? null}
              routing={mgr.webNetworkRouting}
              proxyOrigin={mgr.webProxyOrigin}
              onReload={mgr.handleRefresh}
            />
            <ApplicationSignInNotice mgr={mgr} />
          </div>
        </PopoverSurface>
      )}
    </>
  );
}
