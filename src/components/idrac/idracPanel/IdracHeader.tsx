import React from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
  Power,
  RefreshCw,
  X,
  Wifi,
  WifiOff,
  Loader2,
} from "lucide-react";
import type { SubPropsWithClose } from "./types";

const IdracHeader: React.FC<SubPropsWithClose> = ({ mgr, onClose }) => {
  const { t } = useTranslation();

  const isConnected = mgr.connectionState === "connected";
  const protocolLabel = mgr.config?.protocol
    ? mgr.config.protocol.toUpperCase()
    : "";

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <Server className="w-5 h-5 text-orange-400" />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-semibold text-[var(--color-text)] truncate">
          {t("idrac.title", "Dell iDRAC Manager")}
        </span>
        {isConnected && mgr.config && (
          <span className="text-[10px] text-[var(--color-text-secondary)] truncate">
            {mgr.config.host}:{mgr.config.port} — {mgr.config.username}{" "}
            {protocolLabel && `[${protocolLabel}]`}
            {mgr.config.idracVersion && ` v${mgr.config.idracVersion}`}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Connection indicator */}
        <div className="flex items-center gap-1.5 text-[10px]">
          {isConnected ? (
            <>
              <Wifi className="w-3 h-3 text-green-400" />
              <span className="text-green-400">
                {t("idrac.connected", "Connected")}
              </span>
            </>
          ) : mgr.connectionState === "connecting" ? (
            <>
              <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
              <span className="text-amber-400">
                {t("idrac.connecting", "Connecting…")}
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-[var(--color-text-secondary)]" />
              <span className="text-[var(--color-text-secondary)]">
                {t("idrac.disconnected", "Disconnected")}
              </span>
            </>
          )}
        </div>

        {/* Refresh */}
        {isConnected && (
          <button
            onClick={() => mgr.refresh()}
            disabled={mgr.refreshing}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
            title={t("idrac.refresh", "Refresh")}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${mgr.refreshing ? "animate-spin" : ""}`}
            />
          </button>
        )}

        {/* Disconnect */}
        {isConnected && (
          <button
            onClick={() => mgr.disconnect()}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-red-400 transition-colors"
            title={t("idrac.disconnect", "Disconnect")}
          >
            <Power className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default IdracHeader;
