import React from "react";
import { Settings2 } from "lucide-react";
import type { BrowserRecoveryAction } from "../../../hooks/protocol/originBrowserFailureDetails";

const labels: Record<BrowserRecoveryAction, string> = {
  connection: "Edit website address",
  application: "Review application settings",
  credentials: "Review website credentials",
  permissions: "Review website permissions",
  network: "Review proxy and tunnel settings",
  "browser-session": "Review browser session settings",
  trust: "Review certificate trust settings",
  database: "Open database manager",
  "browser-settings": "Open Web Browser settings",
  "legacy-proxy": "Review internal proxy controls",
};

export default function OriginBrowserRecoveryActions({
  actions,
  onRecover,
  allowed,
  temporary = false,
}: {
  actions: readonly BrowserRecoveryAction[];
  onRecover: (action: BrowserRecoveryAction) => void;
  allowed: boolean;
  temporary?: boolean;
}) {
  return (
    <>
      {[...new Set(actions)].map((action) => {
        const label =
          temporary &&
          ["connection", "application", "credentials", "trust"].includes(action)
            ? "Correct Quick Connect settings"
            : action === "browser-settings" && actions.includes("permissions")
              ? "Review global website permissions"
              : labels[action];
        return (
          <button
            key={action}
            type="button"
            className="sor-btn sor-btn-secondary text-xs"
            data-tooltip={label}
            disabled={!allowed}
            onClick={() => {
              if (allowed) onRecover(action);
            }}
          >
            <Settings2 size={16} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </>
  );
}
