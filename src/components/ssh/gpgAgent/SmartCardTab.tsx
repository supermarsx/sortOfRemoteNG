import React from "react";
import {
  CreditCard,
  RefreshCw,
  Download,
  Lock,
  ShieldAlert,
  Trash2,
  Plus,
  Hash,
  Fingerprint,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../ui/display";
import type { Mgr } from "./types";

const SmartCardTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const c = mgr.cardInfo;

  return (
    <div className="sor-gpg-smartcard space-y-4">
      <div className="flex gap-2">
        <button
          onClick={mgr.getCardStatus}
          disabled={mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded hover:bg-muted/80"
        >
          <RefreshCw className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`} />
          {t("gpgAgent.card.refresh", "Refresh Card")}
        </button>
        <button
          onClick={mgr.cardFetchKey}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded hover:bg-primary/20"
        >
          <Download className="w-4 h-4" />
          {t("gpgAgent.card.fetchKey", "Fetch Key from Card")}
        </button>
      </div>

      {!c ? (
        <EmptyState
          icon={CreditCard}
          message={t("gpgAgent.card.noCard", "No Smart Card Detected")}
          hint={t("gpgAgent.card.noCardDesc", "Insert a smart card and click Refresh.")}
        />
      ) : (
        <>
          {/* Card info */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              {t("gpgAgent.card.info", "Card Information")}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: t("gpgAgent.card.reader", "Reader"), value: c.reader },
                { label: t("gpgAgent.card.serial", "Serial"), value: c.serial },
                { label: t("gpgAgent.card.manufacturer", "Manufacturer"), value: c.manufacturer },
                { label: t("gpgAgent.card.version", "Version"), value: c.application_version },
                { label: t("gpgAgent.card.holder", "Cardholder"), value: c.card_holder },
                { label: t("gpgAgent.card.language", "Language"), value: c.language },
              ].map((item) => (
                <div key={item.label}>
                  <span className="text-muted-foreground">{item.label}: </span>
                  <span className="font-mono">{item.value ?? "\u2014"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* PIN retry counts */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-medium flex items-center gap-2">
              <Hash className="w-3 h-3" />
              {t("gpgAgent.card.pinRetries", "PIN Retry Counts")}
            </h3>
            <div className="flex gap-4 text-xs">
              {[
                { label: "PIN", value: c.pin_retry_count[0] },
                { label: "Reset", value: c.pin_retry_count[1] },
                { label: "Admin", value: c.pin_retry_count[2] },
              ].map((p) => (
                <div key={p.label} className="flex items-center gap-1">
                  <span className="text-muted-foreground">{p.label}:</span>
                  <span
                    className={`font-semibold ${
                      (p.value ?? 0) <= 1 ? "text-error" : ""
                    }`}
                  >
                    {p.value ?? "\u2014"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Key fingerprints on card */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-medium flex items-center gap-2">
              <Fingerprint className="w-3 h-3" />
              {t("gpgAgent.card.keyFingerprints", "Key Fingerprints")}
            </h3>
            <div className="grid grid-cols-1 gap-1 text-xs font-mono">
              {[
                { label: "Signature", value: c.signature_key_fingerprint },
                { label: "Encryption", value: c.encryption_key_fingerprint },
                { label: "Authentication", value: c.authentication_key_fingerprint },
              ].map((kf) => (
                <div key={kf.label} className="flex gap-2">
                  <span className="text-muted-foreground w-24">{kf.label}:</span>
                  <span className="truncate">{kf.value || "\u2014"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key attributes */}
          {c.key_attributes.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4 space-y-2">
              <h3 className="text-xs font-medium">
                {t("gpgAgent.card.keyAttrs", "Key Attributes")}
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-1">Slot</th>
                    <th className="text-left py-1">Algorithm</th>
                    <th className="text-left py-1">Bits</th>
                  </tr>
                </thead>
                <tbody>
                  {c.key_attributes.map((attr, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1">{attr.slot}</td>
                      <td className="py-1 font-mono">{attr.algorithm}</td>
                      <td className="py-1">{attr.bits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => mgr.cardChangePin("user")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-warning text-[var(--color-text)] rounded hover:bg-warning/90"
            >
              <Lock className="w-3 h-3" />
              {t("gpgAgent.card.changePin", "Change PIN")}
            </button>
            <button
              onClick={() => mgr.cardChangePin("admin")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-warning text-[var(--color-text)] rounded hover:bg-warning/90"
            >
              <ShieldAlert className="w-3 h-3" />
              {t("gpgAgent.card.changeAdminPin", "Change Admin PIN")}
            </button>
            <button
              onClick={mgr.cardFactoryReset}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-error text-[var(--color-text)] rounded hover:bg-error/90"
            >
              <Trash2 className="w-3 h-3" />
              {t("gpgAgent.card.factoryReset", "Factory Reset")}
            </button>
            <button
              onClick={() => mgr.cardGenKey("sig", "rsa2048")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:bg-primary/90"
            >
              <Plus className="w-3 h-3" />
              {t("gpgAgent.card.genKey", "Generate Key on Card")}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default SmartCardTab;
