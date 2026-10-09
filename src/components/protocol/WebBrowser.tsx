import React, { useRef } from "react";
import { useWebBrowser } from "../../hooks/protocol/useWebBrowser";
import type { ConnectionSession } from "../../types/connection/connection";
import { useSettings } from "../../contexts/SettingsContext";
import { normalizeWebBrowserSettings } from "../../utils/settings/webBrowserSettings";
import type { WebBrowserEngine } from "../../types/settings/webBrowser";
import type { SettingsTabId } from "../SettingsDialog/settingsConstants";
import OriginConnectionBrowser from "./webBrowser/OriginConnectionBrowser";
import { diagnoseWebBrowserSettings } from "../../utils/settings/webBrowserSettingsDiagnostics";

interface WebBrowserProps {
  session: ConnectionSession;
  onActivateSession?: (sessionId: string) => void;
  onOpenSettings?: (tab?: SettingsTabId) => void;
  sharedPopupId?: string;
}
import NavigationBar from "./webBrowser/NavigationBar";
import SecurityInfoBar from "./webBrowser/SecurityInfoBar";
import BookmarkBar from "./webBrowser/BookmarkBar";
import ContentArea from "./webBrowser/ContentArea";
import BrowserDialogs from "./webBrowser/BrowserDialogs";

export const WebBrowser: React.FC<WebBrowserProps> = (props) => {
  const { settings, settingsReady } = useSettings();
  const initialEngine = useRef<{
    sessionId: string;
    engine: WebBrowserEngine | undefined;
  } | null>(null);
  let config;
  try {
    config = normalizeWebBrowserSettings(settings.webBrowser);
  } catch {
    return (
      <section
        role="alert"
        className="m-4 space-y-4 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)]"
      >
        <h3 className="font-semibold">Browser settings are invalid</h3>
        <p className="text-sm">
          No browser was started. Correct the saved global settings before
          retrying.
        </p>
        <ul className="space-y-3 text-sm" aria-label="Invalid browser settings">
          {diagnoseWebBrowserSettings(settings.webBrowser).map((issue) => (
            <li key={issue.field}>
              <code>{issue.field}</code>
              <p className="text-[var(--color-textSecondary)]">{issue.fix}</p>
            </li>
          ))}
        </ul>
        {props.onOpenSettings && (
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={settingsReady === false}
            onClick={() => {
              if (settingsReady !== false) props.onOpenSettings?.("webBrowser");
            }}
          >
            Repair Web Browser settings
          </button>
        )}
      </section>
    );
  }
  if (
    settingsReady !== false &&
    initialEngine.current?.sessionId !== props.session.id
  )
    initialEngine.current = {
      sessionId: props.session.id,
      engine: config.engine,
    };
  const engine =
    initialEngine.current?.sessionId === props.session.id
      ? initialEngine.current.engine
      : config.engine;
  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-background)]">
      {engine === "real-origin" ? (
        <OriginConnectionBrowser
          key={`origin:${props.session.id}`}
          session={props.session}
          sharedPopupId={props.sharedPopupId}
          onOpenSettings={props.onOpenSettings}
        />
      ) : engine === "legacy" ? (
        <LegacyWebBrowser key={`legacy:${props.session.id}`} {...props} />
      ) : (
        <p role="status" className="p-3">
          Review the browser engine in Settings → Web Browser before connecting.
        </p>
      )}
    </div>
  );
};

const LegacyWebBrowser: React.FC<WebBrowserProps> = ({
  session,
  onActivateSession,
  sharedPopupId,
}) => {
  const mgr = useWebBrowser(session, onActivateSession, sharedPopupId);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--color-background)]">
      {/* Browser Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-3">
        <NavigationBar mgr={mgr} />
        <SecurityInfoBar mgr={mgr} />
      </div>

      {mgr.browserSettings?.showBookmarksBar !== false && (
        <BookmarkBar mgr={mgr} />
      )}
      <ContentArea mgr={mgr} />
      <BrowserDialogs mgr={mgr} />
    </div>
  );
};
