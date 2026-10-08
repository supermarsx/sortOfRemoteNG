"use client";

import React from "react";
import { X } from "lucide-react";
import type { OriginBrowserPopups } from "../../../hooks/protocol/useOriginBrowserPopups";

/** Only adopted native child handles appear here. Main renders the selected
 * child's native viewport; this strip never creates a browser or app session. */
export default function OriginPopupTabs({
  popups,
  parentTitle = "Website",
}: {
  popups: OriginBrowserPopups;
  parentTitle?: string;
}) {
  if (!popups.tabs.length && !popups.error) return null;
  return (
    <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div
        role="tablist"
        aria-label="Website popup tabs"
        className="flex items-center gap-1 overflow-x-auto px-2 py-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={popups.activeViewId === null}
          className="sor-btn sor-btn-sm shrink-0"
          onClick={() => popups.select(null)}
        >
          {parentTitle}
        </button>
        {popups.tabs.map((tab, index) => {
          const title = tab.title || `Popup ${index + 1}`;
          return (
            <div key={tab.viewId} className="flex shrink-0 items-center">
              <button
                type="button"
                role="tab"
                aria-selected={popups.activeViewId === tab.viewId}
                disabled={tab.phase !== "adopted" || tab.closing}
                className="sor-btn sor-btn-sm max-w-56 truncate"
                onClick={() => popups.select(tab.viewId)}
              >
                {title}
                {tab.closing
                  ? " · Closing"
                  : tab.phase === "available"
                    ? " · Opening"
                    : ""}
              </button>
              <button
                type="button"
                aria-label={`Close ${title}`}
                disabled={tab.closing}
                className="sor-btn sor-icon-btn-sm"
                onClick={() => void popups.close(tab.viewId)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {popups.error && (
        <p role="alert" className="px-3 py-1 text-xs text-error">
          {popups.error}
        </p>
      )}
    </div>
  );
}
