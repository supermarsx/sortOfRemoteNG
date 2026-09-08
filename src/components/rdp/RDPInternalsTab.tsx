import { useTranslation } from "react-i18next";
import type { ConnectionSession } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { useRdpInternalsSnapshot } from "../../utils/rdp/rdpInternalsStore";
import { RDPInternalsPanel } from "./RDPInternalsPanel";
import { RDPSettingsPanel } from "./RDPSettingsPanel";
import { RDP_INTERNALS_WINDOW_MESSAGE } from "../app/toolSession";

/** A read-only view of a live client; never owns an RDP actor or frame channel. */
export function RDPInternalsTab({
  session,
  onClose,
}: {
  session: ConnectionSession;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { state, dispatch } = useConnections();
  const { isActive } = useSessionRenderActivity();
  const targetId = session.rdpInternals?.sessionId ?? "";
  const snapshot = useRdpInternalsSnapshot(targetId, isActive);
  const target = state.sessions.find(
    (candidate) => candidate.id === targetId && candidate.protocol === "rdp",
  );
  const section = session.rdpInternals?.section ?? "diagnostics";

  return (
    <div
      className="h-full min-h-0 overflow-auto bg-[var(--color-background)]"
      data-testid="rdp-internals-tab"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] p-4">
        <div>
          <h2 className="text-sm font-semibold">{session.name}</h2>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {RDP_INTERNALS_WINDOW_MESSAGE}
          </p>
          {snapshot && (
            <p className="text-xs text-[var(--color-textSecondary)] capitalize">
              {snapshot.connectionStatus}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="sor-btn-secondary"
          aria-label={t("rdpInternals.closeTab", "Close RDP Internals tab")}
        >
          {t("common.close", "Close")}
        </button>
      </div>
      {!target && !snapshot ? (
        <p
          role="status"
          className="p-6 text-sm text-[var(--color-textSecondary)]"
        >
          {t(
            "rdpInternals.sessionClosed",
            "This RDP session has closed. Closing this tab does not affect other sessions.",
          )}
        </p>
      ) : !snapshot ? (
        <p
          role="status"
          className="p-6 text-sm text-[var(--color-textSecondary)]"
        >
          {t(
            "rdpInternals.viewerUnavailable",
            "Live details are unavailable in this window. Open Internals from the window containing the RDP desktop.",
          )}
        </p>
      ) : (
        <>
          {(snapshot.connectionStatus === "disconnected" ||
            snapshot.connectionStatus === "error") && (
            <p
              role="status"
              className="px-4 py-3 text-xs text-[var(--color-textSecondary)]"
            >
              {t(
                "rdpInternals.sessionEnded",
                "The RDP connection is not active. Details below are its last reported values.",
              )}
            </p>
          )}
          {!snapshot.renderActive && (
            <p
              role="status"
              className="px-4 py-3 text-xs text-[var(--color-textSecondary)]"
            >
              {t(
                "rdpInternals.presentationPaused",
                "Desktop presentation is paused while its tab is hidden. Diagnostics remain subscribed; frame rates below are the last reported values.",
              )}
            </p>
          )}
          <nav
            aria-label={t("rdpInternals.sections", "RDP Internals sections")}
            className="flex gap-2 border-b border-[var(--color-border)] p-3"
          >
            {(["diagnostics", "settings"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={section === key}
                className={
                  section === key ? "sor-btn-primary" : "sor-btn-secondary"
                }
                onClick={() =>
                  dispatch({
                    type: "UPDATE_SESSION",
                    payload: {
                      id: session.id,
                      rdpInternals: { sessionId: targetId, section: key },
                    },
                  })
                }
              >
                {key === "diagnostics"
                  ? t("rdpInternals.diagnostics", "Diagnostics")
                  : t("rdpInternals.settings", "Session settings")}
              </button>
            ))}
          </nav>
          {section === "settings" ? (
            <RDPSettingsPanel
              rdpSettings={snapshot.rdpSettings}
              desktopSize={snapshot.desktopSize}
              colorDepth={snapshot.colorDepth}
              audioEnabled={snapshot.audioEnabled}
              clipboardEnabled={snapshot.clipboardEnabled}
              perfLabel={snapshot.perfLabel}
              certFingerprint={snapshot.certFingerprint}
            />
          ) : (
            <RDPInternalsPanel
              stats={snapshot.stats}
              lifecycle={snapshot.lifecycle}
              connectTiming={snapshot.connectTiming}
              rdpSettings={snapshot.rdpSettings}
              activeRenderBackend={snapshot.activeRenderBackend}
              activeFrontendRenderer={snapshot.activeFrontendRenderer}
              framePressureState={snapshot.framePressureState}
              frameBackpressureTelemetry={snapshot.frameBackpressureTelemetry}
              onClose={onClose}
            />
          )}
        </>
      )}
    </div>
  );
}
