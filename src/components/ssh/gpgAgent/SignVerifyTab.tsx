import React, { useState } from "react";
import {
  FileKey,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "../../ui/display";
import { Select } from "../../ui/forms";
import type { Mgr } from "./types";

const SignVerifyTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [signKeyId, setSignKeyId] = useState("");
  const [signText, setSignText] = useState("");
  const [detached, setDetached] = useState(false);
  const [armor, setArmor] = useState(true);
  const [clearsign, setClearsign] = useState(false);
  const [signResult, setSignResult] = useState<string | null>(null);

  const [verifyData, setVerifyData] = useState("");
  const [detachedSig, setDetachedSig] = useState("");
  const [verifyResult, setVerifyResult] = useState<{
    status: string;
    signer?: string;
    timestamp?: string;
  } | null>(null);

  const secretKeys = mgr.keys.filter((k) => k.is_secret);

  const handleSign = async () => {
    if (!signKeyId || !signText) return;
    const data = Array.from(new TextEncoder().encode(signText));
    const result = await mgr.signData(signKeyId, data, detached, armor);
    if (result) {
      setSignResult(result.signature_armor || new TextDecoder().decode(new Uint8Array(result.signature_data)));
    }
  };

  const handleVerify = async () => {
    if (!verifyData) return;
    const data = Array.from(new TextEncoder().encode(verifyData));
    const sig = detachedSig
      ? Array.from(new TextEncoder().encode(detachedSig))
      : null;
    const result = await mgr.verifySignature(data, sig);
    if (result) {
      setVerifyResult({
        status: result.valid ? "Good" : "Bad",
        signer: result.signer_uid,
        timestamp: result.creation_date,
      });
    }
  };

  return (
    <div className="sor-gpg-sign-verify space-y-6">
      {/* Sign section */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <FileKey className="w-4 h-4" />
          {t("gpgAgent.sign.title", "Sign Data")}
        </h3>
        <Select
          value={signKeyId}
          onChange={(v) => setSignKeyId(v)}
          variant="form-sm"
          className="w-full"
          options={[
            { value: "", label: t("gpgAgent.sign.selectKey", "\u2014 Select signing key \u2014") },
            ...secretKeys.map((k) => ({
              value: k.fingerprint,
              label: `${k.uid_list?.[0]?.name ?? k.fingerprint?.slice(-16)} (${k.algorithm})`,
            })),
          ]}
        />
        <textarea
          value={signText}
          onChange={(e) => setSignText(e.target.value)}
          placeholder={t("gpgAgent.sign.dataPlaceholder", "Enter data to sign\u2026")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <div className="flex gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={detached} onChange={(e) => setDetached(e.target.checked)} className="rounded" />
            {t("gpgAgent.sign.detached", "Detached")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={armor} onChange={(e) => setArmor(e.target.checked)} className="rounded" />
            {t("gpgAgent.sign.armor", "Armor")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={clearsign} onChange={(e) => setClearsign(e.target.checked)} className="rounded" />
            {t("gpgAgent.sign.clearsign", "Clearsign")}
          </label>
        </div>
        <button
          onClick={handleSign}
          disabled={!signKeyId || !signText || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <FileKey className="w-4 h-4" />
          {t("gpgAgent.sign.signBtn", "Sign")}
        </button>
        {signResult && (
          <div className="relative">
            <textarea
              readOnly
              value={signResult}
              rows={5}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded text-xs font-mono"
            />
            <button
              onClick={() => navigator.clipboard.writeText(signResult)}
              className="absolute top-2 right-2 p-1 bg-muted rounded hover:bg-muted/80"
              title={t("common.copy", "Copy")}
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Verify section */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          {t("gpgAgent.verify.title", "Verify Signature")}
        </h3>
        <textarea
          value={verifyData}
          onChange={(e) => setVerifyData(e.target.value)}
          placeholder={t("gpgAgent.verify.dataPlaceholder", "Paste signed data\u2026")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <textarea
          value={detachedSig}
          onChange={(e) => setDetachedSig(e.target.value)}
          placeholder={t("gpgAgent.verify.detachedPlaceholder", "Detached signature (optional)\u2026")}
          rows={2}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <button
          onClick={handleVerify}
          disabled={!verifyData || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-success text-[var(--color-text)] rounded hover:bg-success/90 disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          {t("gpgAgent.verify.verifyBtn", "Verify")}
        </button>
        {verifyResult && (
          <div className="flex items-center gap-3 p-2 rounded bg-muted/50 text-sm">
            <StatusBadge status={verifyResult.status === "Good" ? "success" : "error"} label={verifyResult.status} />
            {verifyResult.signer && (
              <span className="text-xs text-muted-foreground">
                {t("gpgAgent.verify.signer", "Signer")}: {verifyResult.signer}
              </span>
            )}
            {verifyResult.timestamp && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {verifyResult.timestamp}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SignVerifyTab;
