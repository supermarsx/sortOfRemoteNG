import React, { useState } from "react";
import {
  Search,
  RefreshCw,
  Upload,
  Key,
  Fingerprint,
  KeyRound,
  CreditCard,
  Calendar,
  Clock,
  Users,
  Mail,
  Layers,
  Download,
  Trash2,
  Award,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../ui/display";
import { ValidityBadge, TrustBadge } from "./helpers";
import type { Mgr } from "./types";

const KeyringTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [secretOnly, setSecretOnly] = useState(false);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);

  const filtered = mgr.keys.filter((k) => {
    const q = filter.toLowerCase();
    if (!q) return true;
    const uid = k.uid_list?.[0];
    const name = uid?.name?.toLowerCase() ?? "";
    const email = uid?.email?.toLowerCase() ?? "";
    return (
      k.fingerprint?.toLowerCase().includes(q) ||
      name.includes(q) ||
      email.includes(q)
    );
  });

  return (
    <div className="sor-gpg-keyring space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("gpgAgent.keyring.search", "Search keys\u2026")}
            className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={secretOnly}
            onChange={(e) => {
              setSecretOnly(e.target.checked);
              mgr.fetchKeys(e.target.checked);
            }}
            className="rounded"
          />
          {t("gpgAgent.keyring.secretOnly", "Secret keys only")}
        </label>
        <button
          onClick={() => mgr.fetchKeys(secretOnly)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
        >
          <RefreshCw className="w-3 h-3" />
          {t("common.refresh", "Refresh")}
        </button>
        <button
          onClick={() => setShowImport(!showImport)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20"
        >
          <Upload className="w-3 h-3" />
          {t("gpgAgent.keyring.import", "Import")}
        </button>
      </div>

      {/* Import panel */}
      {showImport && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t("gpgAgent.keyring.pasteKey", "Paste armored key\u2026")}
            rows={4}
            className="w-full px-3 py-2 bg-muted border border-border rounded text-xs font-mono resize-y"
          />
          <button
            onClick={async () => {
              if (!importText.trim()) return;
              const data = Array.from(new TextEncoder().encode(importText));
              await mgr.importKey(data, true);
              setImportText("");
              setShowImport(false);
              mgr.fetchKeys(secretOnly);
            }}
            disabled={!importText.trim()}
            className="px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {t("gpgAgent.keyring.importBtn", "Import Key")}
          </button>
        </div>
      )}

      {/* Key list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Key}
          message={t("gpgAgent.keyring.empty", "No Keys Found")}
          hint={t("gpgAgent.keyring.emptyDesc", "Import or generate keys to get started.")}
        />
      ) : (
        <div className="space-y-1 max-h-[360px] overflow-y-auto">
          {filtered.map((key) => {
            const uid = key.uid_list?.[0];
            const isSelected = mgr.selectedKey?.fingerprint === key.fingerprint;
            return (
              <div key={key.fingerprint}>
                <button
                  onClick={() => mgr.getKey(key.fingerprint)}
                  className={`w-full text-left p-2 rounded border transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Fingerprint className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-mono truncate">
                        {key.fingerprint?.slice(-16)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {key.is_secret && <KeyRound className="w-3 h-3 text-warning" />}
                      {key.card_serial && <CreditCard className="w-3 h-3 text-primary" />}
                      <ValidityBadge validity={key.validity ?? "unknown"} />
                      <TrustBadge trust={key.owner_trust ?? "unknown"} />
                    </div>
                  </div>
                  <div className="mt-1 text-sm truncate">
                    {uid ? (
                      <>
                        <span className="font-medium">{uid.name}</span>
                        {uid.email && (
                          <span className="text-muted-foreground">
                            {" "}&lt;{uid.email}&gt;
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">
                        {t("gpgAgent.keyring.noUid", "No UID")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                    <span>{key.algorithm} {key.bits > 0 && `${key.bits}b`}</span>
                    {key.creation_date && (
                      <span className="flex items-center gap-0.5">
                        <Calendar className="w-3 h-3" />
                        {new Date(key.creation_date).toLocaleDateString()}
                      </span>
                    )}
                    {key.expiration_date && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {new Date(key.expiration_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </button>

                {/* Detail panel */}
                {isSelected && mgr.selectedKey && (
                  <div className="mt-1 ml-4 p-3 bg-card border border-border rounded-lg space-y-3 text-xs">
                    {/* UIDs */}
                    <div>
                      <h4 className="font-medium mb-1 flex items-center gap-1">
                        <Users className="w-3 h-3" /> {t("gpgAgent.keyring.uids", "User IDs")}
                      </h4>
                      {mgr.selectedKey.uid_list?.map((u: { name: string; email: string; comment: string; is_revoked: boolean }, i: number) => (
                        <div key={i} className="flex items-center gap-2 py-0.5">
                          <Mail className="w-3 h-3 text-muted-foreground" />
                          <span>{u.name}</span>
                          {u.email && <span className="text-muted-foreground">&lt;{u.email}&gt;</span>}
                          {u.comment && <span className="text-muted-foreground">({u.comment})</span>}
                          {u.is_revoked && <span className="text-error text-[10px]">REVOKED</span>}
                        </div>
                      ))}
                    </div>
                    {/* Subkeys */}
                    <div>
                      <h4 className="font-medium mb-1 flex items-center gap-1">
                        <Layers className="w-3 h-3" /> {t("gpgAgent.keyring.subkeys", "Subkeys")}
                      </h4>
                      {mgr.selectedKey.subkeys?.map((sk, i) => (
                        <div key={i} className="flex items-center gap-3 py-0.5 font-mono">
                          <span className="truncate w-24">{sk.fingerprint?.slice(-8)}</span>
                          <span>{sk.algorithm}</span>
                          <span className="text-muted-foreground">{sk.capabilities?.join(",")}</span>
                          {sk.is_revoked && <span className="text-error">rev</span>}
                        </div>
                      ))}
                    </div>
                    {/* Actions */}
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
                      <button
                        onClick={() => mgr.exportKey(key.fingerprint, { armor: true, include_secret: false, include_attributes: true, include_local_sigs: false, minimal: false, clean: false })}
                        className="flex items-center gap-1 px-2 py-1 bg-muted rounded hover:bg-muted/80"
                      >
                        <Download className="w-3 h-3" /> {t("gpgAgent.keyring.export", "Export")}
                      </button>
                      <button
                        onClick={() => mgr.deleteKey(key.fingerprint, false)}
                        className="flex items-center gap-1 px-2 py-1 bg-error/10 text-error rounded hover:bg-error/20"
                      >
                        <Trash2 className="w-3 h-3" /> {t("gpgAgent.keyring.delete", "Delete")}
                      </button>
                      <button
                        onClick={() => mgr.signKey(key.fingerprint, key.fingerprint, [], false)}
                        className="flex items-center gap-1 px-2 py-1 bg-muted rounded hover:bg-muted/80"
                      >
                        <Award className="w-3 h-3" /> {t("gpgAgent.keyring.signKey", "Sign Key")}
                      </button>
                      <button
                        onClick={() => mgr.setExpiration(key.fingerprint, null)}
                        className="flex items-center gap-1 px-2 py-1 bg-muted rounded hover:bg-muted/80"
                      >
                        <Calendar className="w-3 h-3" /> {t("gpgAgent.keyring.setExpiry", "Expiration")}
                      </button>
                      <button
                        onClick={() => mgr.genRevocation(key.fingerprint, "0", "No reason")}
                        className="flex items-center gap-1 px-2 py-1 bg-warning/10 text-warning rounded hover:bg-warning/20"
                      >
                        <ShieldAlert className="w-3 h-3" /> {t("gpgAgent.keyring.revoke", "Revocation")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KeyringTab;
