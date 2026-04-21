import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { SubProps } from "./types";
import { Select } from "../../ui/forms";

const ConnectionForm: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const isConnecting = mgr.connectionState === "connecting";

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6 bg-[var(--color-surfaceHover)] rounded-xl p-6 border border-[var(--color-border)]">
        <div className="flex items-center gap-3 mb-4">
          <Server className="w-8 h-8 text-warning" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              {t("idrac.connect_title", "Connect to Dell iDRAC")}
            </h2>
            <p className="text-[10px] text-[var(--color-textSecondary)]">
              {t(
                "idrac.connect_desc",
                "Supports iDRAC 6/7/8/9 via Redfish, WS-Management, and IPMI"
              )}
            </p>
          </div>
        </div>

        {mgr.connectionError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{mgr.connectionError}</span>
          </div>
        )}

        <div className="space-y-3">
          {/* Host */}
          <div>
            <label className="block text-[10px] font-medium text-[var(--color-textSecondary)] mb-1">
              {t("idrac.host", "iDRAC Host / IP")}
            </label>
            <input
              className="sor-form-input-xs w-full"
              value={mgr.host}
              onChange={(e) => mgr.setHost(e.target.value)}
              placeholder="192.168.1.100"
              disabled={isConnecting}
            />
          </div>

          {/* Port */}
          <div>
            <label className="block text-[10px] font-medium text-[var(--color-textSecondary)] mb-1">
              {t("idrac.port", "Port")}
            </label>
            <input
              className="sor-form-input-xs w-full"
              type="number"
              value={mgr.port}
              onChange={(e) => mgr.setPort(Number(e.target.value))}
              disabled={isConnecting}
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-[10px] font-medium text-[var(--color-textSecondary)] mb-1">
              {t("idrac.username", "Username")}
            </label>
            <input
              className="sor-form-input-xs w-full"
              value={mgr.username}
              onChange={(e) => mgr.setUsername(e.target.value)}
              placeholder="root"
              disabled={isConnecting}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-[10px] font-medium text-[var(--color-textSecondary)] mb-1">
              {t("idrac.password", "Password")}
            </label>
            <div className="relative">
              <input
                className="sor-form-input-xs w-full pr-10"
                type={showPassword ? "text" : "password"}
                value={mgr.password}
                onChange={(e) => mgr.setPassword(e.target.value)}
                disabled={isConnecting}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                {showPassword ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Protocol */}
          <div>
            <label className="block text-[10px] font-medium text-[var(--color-textSecondary)] mb-1">
              {t("idrac.protocol", "Protocol (auto-detect if blank)")}
            </label>
            <Select
              value={mgr.forceProtocol}
              onChange={(v) => mgr.setForceProtocol(v)}
              disabled={isConnecting}
              variant="form-sm"
              className="w-full"
              options={[
                { value: '', label: 'Auto-detect' },
                { value: 'redfish', label: 'Redfish (iDRAC 7/8/9)' },
                { value: 'wsman', label: 'WS-Management (iDRAC 6/7 Legacy)' },
                { value: 'ipmi', label: 'IPMI (Very Old BMC)' },
              ]}
            />
          </div>

          {/* Insecure */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mgr.insecure}
              onChange={(e) => mgr.setInsecure(e.target.checked)}
              className="rounded border-[var(--color-border)] text-warning focus:ring-primary/50"
              disabled={isConnecting}
            />
            <span className="text-[10px] text-[var(--color-textSecondary)]">
              {t("idrac.insecure", "Accept self-signed certificates")}
            </span>
          </label>
        </div>

        <button
          onClick={() => mgr.connect()}
          disabled={isConnecting || !mgr.host || !mgr.username}
          className="w-full py-2.5 rounded-lg bg-warning hover:bg-warning/90 text-[var(--color-text)] text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isConnecting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("idrac.connecting_btn", "Connecting…")}
            </>
          ) : (
            t("idrac.connect_btn", "Connect")
          )}
        </button>
      </div>
    </div>
  );
};

export default ConnectionForm;
