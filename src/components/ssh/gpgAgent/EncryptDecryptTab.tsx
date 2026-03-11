import React, { useState } from "react";
import {
  Lock,
  Unlock,
  ShieldCheck,
  Copy,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Mgr } from "./types";

const EncryptDecryptTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [plaintext, setPlaintext] = useState("");
  const [encArmor, setEncArmor] = useState(true);
  const [encSign, setEncSign] = useState(false);
  const [symmetricOnly, setSymmetricOnly] = useState(false);
  const [encResult, setEncResult] = useState<string | null>(null);

  const [ciphertext, setCiphertext] = useState("");
  const [decResult, setDecResult] = useState<{ plaintext: string; sigInfo?: string } | null>(null);

  const handleEncrypt = async () => {
    if (!plaintext || (recipients.length === 0 && !symmetricOnly)) return;
    const data = Array.from(new TextEncoder().encode(plaintext));
    const result = await mgr.encryptData(recipients, data, encArmor, encSign, null);
    if (result) {
      setEncResult(result.armor || new TextDecoder().decode(new Uint8Array(result.ciphertext)));
    }
  };

  const handleDecrypt = async () => {
    if (!ciphertext) return;
    const data = Array.from(new TextEncoder().encode(ciphertext));
    const result = await mgr.decryptData(data);
    if (result) {
      setDecResult({
        plaintext: new TextDecoder().decode(new Uint8Array(result.plaintext)),
        sigInfo: result.signature_info?.signer_uid ?? undefined,
      });
    }
  };

  const toggleRecipient = (fp: string) => {
    setRecipients((r) =>
      r.includes(fp) ? r.filter((x) => x !== fp) : [...r, fp],
    );
  };

  return (
    <div className="sor-gpg-enc-dec space-y-6">
      {/* Encrypt */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Lock className="w-4 h-4" />
          {t("gpgAgent.encrypt.title", "Encrypt")}
        </h3>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("gpgAgent.encrypt.recipients", "Recipients")}
          </label>
          <div className="max-h-28 overflow-y-auto border border-border rounded p-1 space-y-0.5">
            {mgr.keys.map((k) => {
              const uid = k.uid_list?.[0];
              return (
                <label
                  key={k.fingerprint}
                  className="flex items-center gap-2 px-2 py-0.5 hover:bg-muted/50 rounded text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={recipients.includes(k.fingerprint)}
                    onChange={() => toggleRecipient(k.fingerprint)}
                    className="rounded"
                  />
                  <span className="truncate">
                    {uid?.name ?? k.fingerprint?.slice(-16)}
                    {uid?.email && <span className="text-muted-foreground"> &lt;{uid.email}&gt;</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <textarea
          value={plaintext}
          onChange={(e) => setPlaintext(e.target.value)}
          placeholder={t("gpgAgent.encrypt.dataPlaceholder", "Enter data to encrypt\u2026")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <div className="flex gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={encArmor} onChange={(e) => setEncArmor(e.target.checked)} className="rounded" />
            {t("gpgAgent.encrypt.armor", "Armor")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={encSign} onChange={(e) => setEncSign(e.target.checked)} className="rounded" />
            {t("gpgAgent.encrypt.sign", "Sign")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={symmetricOnly} onChange={(e) => setSymmetricOnly(e.target.checked)} className="rounded" />
            {t("gpgAgent.encrypt.symmetric", "Symmetric only")}
          </label>
        </div>
        <button
          onClick={handleEncrypt}
          disabled={(!recipients.length && !symmetricOnly) || !plaintext || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <Lock className="w-4 h-4" />
          {t("gpgAgent.encrypt.encryptBtn", "Encrypt")}
        </button>
        {encResult && (
          <div className="relative">
            <textarea
              readOnly
              value={encResult}
              rows={5}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded text-xs font-mono"
            />
            <button
              onClick={() => navigator.clipboard.writeText(encResult)}
              className="absolute top-2 right-2 p-1 bg-muted rounded hover:bg-muted/80"
              title={t("common.copy", "Copy")}
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Decrypt */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Unlock className="w-4 h-4" />
          {t("gpgAgent.decrypt.title", "Decrypt")}
        </h3>
        <textarea
          value={ciphertext}
          onChange={(e) => setCiphertext(e.target.value)}
          placeholder={t("gpgAgent.decrypt.dataPlaceholder", "Paste encrypted data\u2026")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <button
          onClick={handleDecrypt}
          disabled={!ciphertext || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-success text-[var(--color-text)] rounded hover:bg-success/90 disabled:opacity-50"
        >
          <Unlock className="w-4 h-4" />
          {t("gpgAgent.decrypt.decryptBtn", "Decrypt")}
        </button>
        {decResult && (
          <div className="space-y-2">
            <textarea
              readOnly
              value={decResult.plaintext}
              rows={4}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded text-xs font-mono"
            />
            {decResult.sigInfo && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-3 h-3 text-success" />
                {t("gpgAgent.decrypt.signedBy", "Signed by")}: {decResult.sigInfo}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EncryptDecryptTab;
