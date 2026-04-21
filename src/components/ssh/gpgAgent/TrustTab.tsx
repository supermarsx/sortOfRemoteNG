import React, { useState } from "react";
import { RefreshCw, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "../../ui/forms";
import type { Mgr } from "./types";

const TrustTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [trustKeyId, setTrustKeyId] = useState("");
  const [trustLevel, setTrustLevel] = useState<string>("unknown");
  const ts = mgr.trustStats;

  return (
    <div className="sor-gpg-trust space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t("gpgAgent.trust.total", "Total Keys"), value: ts?.total_keys ?? 0 },
          { label: t("gpgAgent.trust.trusted", "Fully Trusted"), value: ts?.full_trust ?? 0 },
          { label: t("gpgAgent.trust.marginal", "Marginal"), value: ts?.marginal_trust ?? 0 },
          { label: t("gpgAgent.trust.ultimate", "Ultimate"), value: ts?.ultimate_trust ?? 0 },
          { label: t("gpgAgent.trust.revoked", "Revoked"), value: ts?.revoked_keys ?? 0 },
          { label: t("gpgAgent.trust.expired", "Expired"), value: ts?.expired_keys ?? 0 },
          { label: t("gpgAgent.trust.unknown", "Unknown"), value: ts?.unknown_trust ?? 0 },
          { label: t("gpgAgent.trust.trusted", "Trusted"), value: ts?.trusted_keys ?? 0 },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-card border border-border rounded-lg p-3 text-center"
          >
            <div className="text-lg font-semibold">{item.value}</div>
            <div className="text-xs text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={mgr.updateTrustDb}
          disabled={mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          {t("gpgAgent.trust.rebuild", "Rebuild Trust DB")}
        </button>
        <button
          onClick={() => mgr.fetchTrustStats()}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded hover:bg-muted/80"
        >
          <RefreshCw className="w-4 h-4" />
          {t("common.refresh", "Refresh")}
        </button>
      </div>

      {/* Key trust editor */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <UserCheck className="w-4 h-4" />
          {t("gpgAgent.trust.setTrust", "Set Key Trust")}
        </h3>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.trust.keyId", "Key fingerprint or ID")}
            </label>
            <input
              type="text"
              value={trustKeyId}
              onChange={(e) => setTrustKeyId(e.target.value)}
              placeholder="0x..."
              className="sor-form-input-sm w-full font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.trust.level", "Trust level")}
            </label>
            <Select
              value={trustLevel}
              onChange={(v) => setTrustLevel(v)}
              variant="form-sm"
              options={[
                { value: "unknown", label: "Unknown" },
                { value: "never", label: "Never" },
                { value: "marginal", label: "Marginal" },
                { value: "full", label: "Full" },
                { value: "ultimate", label: "Ultimate" },
              ]}
            />
          </div>
          <button
            onClick={() => {
              if (trustKeyId) mgr.setTrust(trustKeyId, trustLevel as any);
            }}
            disabled={!trustKeyId}
            className="px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {t("gpgAgent.trust.apply", "Apply")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrustTab;
