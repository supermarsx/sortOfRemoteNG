import { MsgType, WaMgr } from "./types";
import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";
import React from "react";
import { CheckCircle, Send } from "lucide-react";
import { Textarea } from "../../ui/forms";
import { useComposeTab } from "./useComposeTab";

// ── Compose Tab ──────────────────────────────────────────────────────

const ComposeTab: React.FC<{ wa: WaMgr }> = ({
  wa,
}) => {
  const c = useComposeTab(wa);

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Send size={16} />
        <span>Compose Message</span>
      </h3>

      <label className="block">
        <span className="text-xs text-[var(--color-textSecondary)]">Recipient (E.164)</span>
        <input
          value={c.to}
          onChange={(e) => c.setTo(e.target.value)}
          className="sor-input mt-1 w-full"
          placeholder="+1234567890"
        />
      </label>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(c.icons) as MsgType[]).map((t) => {
          const Icon = c.icons[t];
          return (
            <button
              key={t}
              onClick={() => c.setMsgType(t)}
              className={`px-3 py-1.5 rounded text-xs flex items-center space-x-1 transition-colors ${
                c.msgType === t
                  ? "bg-success text-[var(--color-text)]"
                  : "bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={12} />
              <span className="capitalize">{t}</span>
            </button>
          );
        })}
      </div>

      {/* Type-specific fields */}
      {c.msgType === "text" && (
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={c.textBody}
            onChange={(v) => c.setTextBody(v)}
            className="sor-input w-full"
            placeholder="Type your message..."
          />
          <label className="flex items-center space-x-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={c.previewUrl}
              onChange={(e) => c.setPreviewUrl(e.target.checked)}
            />
            <span>Enable URL preview</span>
          </label>
        </div>
      )}

      {(c.msgType === "image" || c.msgType === "video" || c.msgType === "audio" || c.msgType === "document") && (
        <div className="space-y-2">
          <input
            value={c.mediaId}
            onChange={(e) => c.setMediaId(e.target.value)}
            className="sor-input w-full"
            placeholder="Media ID (from upload)"
          />
          <input
            value={c.mediaLink}
            onChange={(e) => c.setMediaLink(e.target.value)}
            className="sor-input w-full"
            placeholder="Or public URL"
          />
          {(c.msgType === "image" || c.msgType === "video" || c.msgType === "document") && (
            <input
              value={c.caption}
              onChange={(e) => c.setCaption(e.target.value)}
              className="sor-input w-full"
              placeholder="Caption (optional)"
            />
          )}
          {c.msgType === "document" && (
            <input
              value={c.filename}
              onChange={(e) => c.setFilename(e.target.value)}
              className="sor-input w-full"
              placeholder="Filename (optional)"
            />
          )}
        </div>
      )}

      {c.msgType === "location" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={c.lat}
            onChange={(e) => c.setLat(e.target.value)}
            className="sor-input"
            placeholder="Latitude"
            type="number"
            step="any"
          />
          <input
            value={c.lng}
            onChange={(e) => c.setLng(e.target.value)}
            className="sor-input"
            placeholder="Longitude"
            type="number"
            step="any"
          />
          <input
            value={c.locName}
            onChange={(e) => c.setLocName(e.target.value)}
            className="sor-input col-span-2"
            placeholder="Location name (optional)"
          />
          <input
            value={c.locAddress}
            onChange={(e) => c.setLocAddress(e.target.value)}
            className="sor-input col-span-2"
            placeholder="Address (optional)"
          />
        </div>
      )}

      {c.msgType === "reaction" && (
        <div className="space-y-2">
          <input
            value={c.reactionMsgId}
            onChange={(e) => c.setReactionMsgId(e.target.value)}
            className="sor-input w-full"
            placeholder="Message ID to react to"
          />
          <input
            value={c.emoji}
            onChange={(e) => c.setEmoji(e.target.value)}
            className="sor-input w-full"
            placeholder="Emoji (e.g. 👍)"
          />
        </div>
      )}

      <button
        onClick={c.handleSend}
        disabled={c.isSending || !c.to}
        className="sor-btn sor-btn-primary flex items-center space-x-2"
      >
        {c.isSending ? <LoadingSpinner /> : <Send size={14} />}
        <span>Send</span>
      </button>

      <ErrorMsg msg={c.errorMsg} />
      {c.result && (
        <div className="text-success text-sm flex items-center space-x-2">
          <CheckCircle size={14} />
          <span>{c.result}</span>
        </div>
      )}
    </div>
  );
};

export default ComposeTab;
