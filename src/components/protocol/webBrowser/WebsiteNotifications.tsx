import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import type { SectionProps } from "./types";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import ApplicationSignInNotice from "./ApplicationSignInNotice";
import WebNetworkNotice from "./WebNetworkNotice";
import WebAutomationNotice from "./WebAutomationNotice";
import { synologyRedirectDefaultsForConnection } from "../../../utils/protocol/synologyRedirectDefaults";

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
    connection?: SectionProps["mgr"]["connection"];
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
  const [popupTop, setPopupTop] = useState(60);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (anchor.current)
        setPopupTop(
          Math.max(
            8,
            Math.min(
              anchor.current.getBoundingClientRect().bottom + 4,
              window.innerHeight - 240,
            ),
          ),
        );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);
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
  const quickConnectRelevant = (() => {
    const routing = mgr.webNetworkRouting;
    if (
      routing &&
      [
        routing.quickConnectNavigation,
        routing.quickConnectDiscovery,
        routing.quickConnectDiscovered,
        routing.quickConnectDirectNavigation,
        routing.quickConnectRegionalNavigation,
      ].some((value) => value === true)
    )
      return true;
    if (
      reports.some((report) =>
        ["quickconnect-control-method", "quickconnect-probe-method"].includes(
          report.reason,
        ),
      )
    )
      return true;
    try {
      if (
        mgr.connection &&
        synologyRedirectDefaultsForConnection(mgr.connection)
      )
        return true;
      const current = new URL(mgr.currentUrl);
      return (
        ["http:", "https:"].includes(current.protocol) &&
        !current.username &&
        !current.password &&
        (current.hostname === "quickconnect.to" ||
          current.hostname.endsWith(".quickconnect.to"))
      );
    } catch {
      return false;
    }
  })();
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
          offset={4}
          className="sor-popover-panel sor-popover-panel-strong w-96 max-w-[calc(100vw-2rem)] overflow-y-auto"
          style={{
            top: popupTop,
            maxHeight: `calc(100dvh - ${popupTop + 8}px)`,
          }}
          dataTestId="website-notifications-popover"
        >
          <div
            id={id}
            role="dialog"
            aria-label="Website notifications"
            className="text-[var(--color-text)]"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell
                  size={16}
                  className={
                    issues
                      ? "text-warning"
                      : "text-[var(--color-textSecondary)]"
                  }
                  aria-hidden="true"
                />
                <h2 className="text-sm font-medium">Website notifications</h2>
              </div>
              <button
                ref={closeButton}
                type="button"
                className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                aria-label="Close website notifications"
                onClick={close}
              >
                <X size={14} />
              </button>
            </div>
            <div
              className="p-4 space-y-3 text-xs text-[var(--color-textSecondary)]"
              data-testid="website-notifications-content"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--color-textMuted)]">
                  Current website
                </span>
                <span
                  className={`font-medium ${issues ? "text-warning" : "text-[var(--color-textSecondary)]"}`}
                >
                  {issues
                    ? `${issues} issue${issues === 1 ? "" : "s"} reported`
                    : "No issues reported"}
                </span>
              </div>
              <WebAutomationNotice automation={mgr.automation} />
              <WebNetworkNotice
                reports={reports}
                guard={mgr.webNetworkGuard ?? null}
                routing={mgr.webNetworkRouting}
                proxyOrigin={mgr.webProxyOrigin}
                quickConnectRelevant={quickConnectRelevant}
                onReload={mgr.handleRefresh}
              />
              <ApplicationSignInNotice mgr={mgr} />
            </div>
            <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-textMuted)]">
              Closing this panel does not dismiss issues or change website
              permissions.
            </div>
          </div>
        </PopoverSurface>
      )}
    </>
  );
}
