import React from "react";
import { Settings, Play, Square, RotateCcw } from "lucide-react";
import type { Mgr } from "./types";

export const ServerControlsSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="sor-settings-card">
    <div className="flex items-center justify-between mb-3">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-2">
        <Settings className="w-4 h-4 text-primary" />
        {mgr.t("settings.api.serverControls", "Server Controls")}
      </h4>
      <div
        className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
          mgr.serverStatus === "running"
            ? "bg-success/20 text-success"
            : mgr.serverStatus === "starting" || mgr.serverStatus === "stopping"
              ? "bg-warning/20 text-warning"
              : "bg-[var(--color-surfaceHover)]/50 text-[var(--color-textSecondary)]"
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full ${
            mgr.serverStatus === "running"
              ? "bg-success"
              : mgr.serverStatus === "starting" || mgr.serverStatus === "stopping"
                ? "bg-warning animate-pulse"
                : "bg-[var(--color-secondary)]"
          }`}
        />
        {mgr.serverStatus === "running"
          ? "Running"
          : mgr.serverStatus === "starting"
            ? "Starting..."
            : mgr.serverStatus === "stopping"
              ? "Stopping..."
              : "Stopped"}
        {mgr.actualPort && mgr.serverStatus === "running" && (
          <span className="text-[var(--color-textSecondary)]">:{mgr.actualPort}</span>
        )}
      </div>
    </div>

    <div className="flex gap-2">
      <button
        type="button"
        onClick={mgr.handleStartServer}
        disabled={mgr.serverStatus === "running" || mgr.serverStatus === "starting" || mgr.serverStatus === "stopping"}
        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-success hover:bg-success/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
      >
        <Play className="w-4 h-4" />
        {mgr.t("settings.api.start", "Start")}
      </button>
      <button
        type="button"
        onClick={mgr.handleStopServer}
        disabled={mgr.serverStatus === "stopped" || mgr.serverStatus === "starting" || mgr.serverStatus === "stopping"}
        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-error hover:bg-error/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
      >
        <Square className="w-4 h-4" />
        {mgr.t("settings.api.stop", "Stop")}
      </button>
      <button
        type="button"
        onClick={mgr.handleRestartServer}
        disabled={mgr.serverStatus === "stopped" || mgr.serverStatus === "starting" || mgr.serverStatus === "stopping"}
        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-warning hover:bg-warning/90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-md transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        {mgr.t("settings.api.restart", "Restart")}
      </button>
    </div>
  </div>
);

export default ServerControlsSection;
