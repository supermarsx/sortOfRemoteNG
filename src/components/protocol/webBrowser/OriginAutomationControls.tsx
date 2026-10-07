"use client";

import React from "react";
import type { useOriginWebsiteAutomation } from "../../../hooks/protocol/useOriginWebsiteAutomation";
import { WebAutomationControls } from "./WebAutomationControls";

export interface OriginAutomationControlsProps {
  automation: ReturnType<typeof useOriginWebsiteAutomation>;
  showFavorites?: boolean;
}

/** Native child visibility is owned by the shell's modal/menu observer. */
export function OriginAutomationControls({
  automation,
  showFavorites = true,
}: OriginAutomationControlsProps) {
  return (
    <div className="min-w-0" data-testid="origin-automation-controls">
      <WebAutomationControls
        automation={automation}
        showFavorites={showFavorites}
      />
      {automation.recording && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          Native recording collects value-free steps on Stop; there is no live
          step count.
        </p>
      )}
      {automation.documentUnavailable && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary text-xs"
          disabled={
            automation.busy ||
            automation.recordingPending ||
            automation.recording
          }
          onClick={automation.refreshDocument}
        >
          Refresh automation document
        </button>
      )}
      {automation.error && (
        <p role="alert" className="text-xs text-error">
          {automation.error}
        </p>
      )}
      {automation.executionOutcome === "dispatched" && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          Script dispatched to the current website; completion is unverified.
          Stopping cannot undo JavaScript already dispatched.
        </p>
      )}
    </div>
  );
}

export default OriginAutomationControls;
