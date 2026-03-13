import React, { useState } from "react";
import {
  Search,
  Download,
  Upload,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Select } from "../../ui/forms";
import type { Mgr } from "./types";

const KeyserverTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sendKeyId, setSendKeyId] = useState("");

  return (
    <div className="sor-gpg-keyserver space-y-4">
      {/* Search */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Search className="w-4 h-4" />
          {t("gpgAgent.keyserver.search", "Search Keyserver")}
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("gpgAgent.keyserver.searchPlaceholder", "Name, email, or key ID\u2026")}
            className="sor-form-input-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && query) mgr.searchKeyserver(query);
            }}
          />
          <button
            onClick={() => mgr.searchKeyserver(query)}
            disabled={!query || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            {t("gpgAgent.keyserver.searchBtn", "Search")}
          </button>
        </div>

        {mgr.keyserverResults.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {mgr.keyserverResults.map((r) => (
              <div
                key={r.key_id}
                className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs"
              >
                <div className="min-w-0">
                  <div className="font-mono truncate">{r.key_id}</div>
                  <div className="text-muted-foreground truncate">
                    {r.uid ?? "\u2014"}
                  </div>
                  <div className="text-muted-foreground">
                    {r.algorithm} \u00b7 {r.creation_date ? new Date(r.creation_date).toLocaleDateString() : "\u2014"}
                  </div>
                </div>
                <button
                  onClick={() => mgr.fetchFromKeyserver(r.key_id)}
                  className="flex items-center gap-1 px-2 py-1 bg-success/10 text-success rounded hover:bg-success/20 flex-shrink-0 ml-2"
                >
                  <Download className="w-3 h-3" />
                  {t("gpgAgent.keyserver.fetch", "Fetch")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send key */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Upload className="w-4 h-4" />
          {t("gpgAgent.keyserver.send", "Send Key to Keyserver")}
        </h3>
        <div className="flex gap-2">
          <Select
            value={sendKeyId}
            onChange={(v) => setSendKeyId(v)}
            variant="form-sm"
            className="flex-1"
            options={[
              { value: "", label: t("gpgAgent.keyserver.selectKey", "\u2014 Select key \u2014") },
              ...mgr.keys.map((k) => ({
                value: k.fingerprint,
                label: k.uid_list?.[0]?.name ?? k.fingerprint?.slice(-16),
              })),
            ]}
          />
          <button
            onClick={() => {
              if (sendKeyId) mgr.sendToKeyserver(sendKeyId);
            }}
            disabled={!sendKeyId || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {t("gpgAgent.keyserver.sendBtn", "Send")}
          </button>
        </div>
      </div>

      {/* Refresh all */}
      <button
        onClick={mgr.refreshKeys}
        disabled={mgr.loading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded hover:bg-muted/80 disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`} />
        {t("gpgAgent.keyserver.refreshAll", "Refresh All Keys from Keyserver")}
      </button>
    </div>
  );
};

export default KeyserverTab;
