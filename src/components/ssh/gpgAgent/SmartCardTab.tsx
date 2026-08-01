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
import type {
  CardFactoryResetChallenge,
  CardSlot,
  SmartCardInfo,
} from "../../../types/security/gpgAgent";

function slotLabel(slot: CardSlot): string {
  return `${slot.charAt(0).toUpperCase()}${slot.slice(1)}`;
}

function slotFingerprint(card: SmartCardInfo, slot: CardSlot): string | null {
  if (slot === "signature") return card.signature_key_fingerprint;
  if (slot === "encryption") return card.encryption_key_fingerprint;
  return card.authentication_key_fingerprint;
}

const SmartCardTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const c = mgr.cardInfo;
  const [resetChallenge, setResetChallenge] =
    React.useState<CardFactoryResetChallenge | null>(null);
  const [resetConfirmation, setResetConfirmation] = React.useState("");
  const [resetting, setResetting] = React.useState(false);

  React.useEffect(() => {
    setResetChallenge(null);
    setResetConfirmation("");
  }, [c?.serial]);

  const beginFactoryReset = async () => {
    const challenge = await mgr.prepareCardFactoryReset();
    if (challenge) {
      setResetChallenge(challenge);
      setResetConfirmation("");
    }
  };

  const confirmFactoryReset = async () => {
    if (!resetChallenge) return;
    setResetting(true);
    const reset = await mgr.cardFactoryReset(resetChallenge, resetConfirmation);
    setResetting(false);
    if (reset) {
      setResetChallenge(null);
      setResetConfirmation("");
    }
  };

  return (
    <div className="sor-gpg-smartcard space-y-4">
      <div className="flex gap-2">
        <button
          onClick={mgr.getCardStatus}
          disabled={mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded hover:bg-muted/80"
        >
          <RefreshCw
            className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`}
          />
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
          hint={t(
            "gpgAgent.card.noCardDesc",
            "Insert a smart card and click Refresh.",
          )}
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
                {
                  label: t("gpgAgent.card.manufacturer", "Manufacturer"),
                  value: c.manufacturer,
                },
                {
                  label: t("gpgAgent.card.version", "Version"),
                  value: c.application_version,
                },
                {
                  label: t("gpgAgent.card.holder", "Cardholder"),
                  value: c.card_holder,
                },
                {
                  label: t("gpgAgent.card.language", "Language"),
                  value: c.language,
                },
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
                {
                  label: "Authentication",
                  value: c.authentication_key_fingerprint,
                },
              ].map((kf) => (
                <div key={kf.label} className="flex gap-2">
                  <span className="text-muted-foreground w-24">
                    {kf.label}:
                  </span>
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
                      <td className="py-1">{slotLabel(attr.slot)}</td>
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
              onClick={mgr.cardUnblockPin}
              disabled={
                mgr.loading ||
                c.pin_retry_count[0] > 0 ||
                c.pin_retry_count[1] === 0
              }
              title={
                c.pin_retry_count[0] > 0
                  ? t(
                      "gpgAgent.card.pinNotBlocked",
                      "The user PIN is not blocked",
                    )
                  : undefined
              }
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-warning text-[var(--color-text)] rounded hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldAlert className="w-3 h-3" />
              {t("gpgAgent.card.unblockPin", "Unblock PIN")}
            </button>
            <button
              onClick={beginFactoryReset}
              disabled={mgr.loading || resetting}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-error text-[var(--color-text)] rounded hover:bg-error/90"
            >
              <Trash2 className="w-3 h-3" />
              {t("gpgAgent.card.factoryReset", "Factory Reset")}
            </button>
            {c.key_attributes
              .filter((attr) => !slotFingerprint(c, attr.slot))
              .map((attr) => (
                <button
                  key={attr.slot}
                  onClick={() => mgr.cardGenKey(attr.slot, attr.algorithm)}
                  disabled={mgr.loading}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  {t("gpgAgent.card.genKey", "Generate Key")}:{" "}
                  {slotLabel(attr.slot)} ({attr.algorithm})
                </button>
              ))}
          </div>

          {resetChallenge && (
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="gpg-card-reset-title"
              className="space-y-3 rounded-lg border-2 border-error bg-error/10 p-4"
            >
              <h3
                id="gpg-card-reset-title"
                className="font-semibold text-error"
              >
                {t(
                  "gpgAgent.card.resetConfirmTitle",
                  "Permanently erase this smart card?",
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t(
                  "gpgAgent.card.resetConfirmWarning",
                  "Factory reset permanently destroys every private key and PIN on the inserted card. This cannot be undone.",
                )}
              </p>
              <p className="text-xs">
                {t("gpgAgent.card.resetSerial", "Card serial")}:{" "}
                <code className="font-mono font-semibold">
                  {resetChallenge.serial}
                </code>
              </p>
              <label className="block space-y-1 text-xs">
                <span>
                  {t(
                    "gpgAgent.card.resetTypePhrase",
                    "Type this exact one-time phrase",
                  )}
                  :{" "}
                  <code className="select-all font-mono font-semibold">
                    {resetChallenge.confirmationPhrase}
                  </code>
                </span>
                <input
                  value={resetConfirmation}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded border border-error/50 bg-background px-2 py-1.5 font-mono"
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={confirmFactoryReset}
                  disabled={
                    resetting ||
                    resetConfirmation !== resetChallenge.confirmationPhrase
                  }
                  className="rounded bg-error px-3 py-1.5 text-xs text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resetting
                    ? t("gpgAgent.card.resetting", "Resetting…")
                    : t(
                        "gpgAgent.card.resetPermanently",
                        "Reset card permanently",
                      )}
                </button>
                <button
                  onClick={() => {
                    setResetChallenge(null);
                    setResetConfirmation("");
                  }}
                  disabled={resetting}
                  className="rounded bg-muted px-3 py-1.5 text-xs hover:bg-muted/80"
                >
                  {t("common.cancel", "Cancel")}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t(
                  "gpgAgent.card.resetExpiry",
                  "This one-time confirmation expires in {{seconds}} seconds and is consumed after one attempt.",
                  { seconds: resetChallenge.expiresInSeconds },
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SmartCardTab;
