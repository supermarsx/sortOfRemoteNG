import { MsgType } from "./types";
import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";

// ── Compose Tab ──────────────────────────────────────────────────────

const ComposeTab: React.FC<{ wa: ReturnType<typeof useWhatsApp> }> = ({
  wa,
}) => {
  const [to, setTo] = useState("");
  const [msgType, setMsgType] = useState<MsgType>("text");

  // Text
  const [textBody, setTextBody] = useState("");
  const [previewUrl, setPreviewUrl] = useState(false);

  // Media (image/video/audio/doc)
  const [mediaId, setMediaId] = useState("");
  const [mediaLink, setMediaLink] = useState("");
  const [caption, setCaption] = useState("");
  const [filename, setFilename] = useState("");

  // Location
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");

  // Reaction
  const [reactionMsgId, setReactionMsgId] = useState("");
  const [emoji, setEmoji] = useState("");

  const [result, setResult] = useState<string | null>(null);

  const handleSend = async () => {
    setResult(null);
    let resp;
    switch (msgType) {
      case "text":
        resp = await wa.sendText.execute(to, textBody, previewUrl);
        break;
      case "image":
        resp = await wa.sendImage.execute(to, {
          mediaId: mediaId || undefined,
          link: mediaLink || undefined,
          caption: caption || undefined,
        });
        break;
      case "document":
        resp = await wa.sendDocument.execute(to, {
          mediaId: mediaId || undefined,
          link: mediaLink || undefined,
          caption: caption || undefined,
          filename: filename || undefined,
        });
        break;
      case "video":
        resp = await wa.sendVideo.execute(to, {
          mediaId: mediaId || undefined,
          link: mediaLink || undefined,
          caption: caption || undefined,
        });
        break;
      case "audio":
        resp = await wa.sendAudio.execute(to, {
          mediaId: mediaId || undefined,
          link: mediaLink || undefined,
        });
        break;
      case "location":
        resp = await wa.sendLocation.execute(
          to,
          parseFloat(lat),
          parseFloat(lng),
          locName || undefined,
          locAddress || undefined,
        );
        break;
      case "reaction":
        resp = await wa.sendReaction.execute(to, reactionMsgId, emoji);
        break;
    }
    if (resp) {
      setResult(`Sent — Message ID: ${resp.messages?.[0]?.id ?? "ok"}`);
    }
  };

  const icons: Record<MsgType, React.ElementType> = {
    text: Send,
    image: Image,
    document: FileText,
    video: Video,
    audio: Music,
    location: MapPin,
    reaction: SmilePlus,
  };

  const isSending =
    wa.sendText.loading ||
    wa.sendImage.loading ||
    wa.sendDocument.loading ||
    wa.sendVideo.loading ||
    wa.sendAudio.loading ||
    wa.sendLocation.loading ||
    wa.sendReaction.loading;

  const errorMsg =
    wa.sendText.error ??
    wa.sendImage.error ??
    wa.sendDocument.error ??
    wa.sendVideo.error ??
    wa.sendAudio.error ??
    wa.sendLocation.error ??
    wa.sendReaction.error;

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Send size={16} />
        <span>Compose Message</span>
      </h3>

      <label className="block">
        <span className="text-xs text-[var(--color-textSecondary)]">Recipient (E.164)</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="sor-input mt-1 w-full"
          placeholder="+1234567890"
        />
      </label>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(icons) as MsgType[]).map((t) => {
          const Icon = icons[t];
          return (
            <button
              key={t}
              onClick={() => setMsgType(t)}
              className={`px-3 py-1.5 rounded text-xs flex items-center space-x-1 transition-colors ${
                msgType === t
                  ? "bg-green-600 text-white"
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
      {msgType === "text" && (
        <div className="space-y-2">
          <textarea
            rows={4}
            value={textBody}
            onChange={(e) => setTextBody(e.target.value)}
            className="sor-input w-full"
            placeholder="Type your message..."
          />
          <label className="flex items-center space-x-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={previewUrl}
              onChange={(e) => setPreviewUrl(e.target.checked)}
            />
            <span>Enable URL preview</span>
          </label>
        </div>
      )}

      {(msgType === "image" || msgType === "video" || msgType === "audio" || msgType === "document") && (
        <div className="space-y-2">
          <input
            value={mediaId}
            onChange={(e) => setMediaId(e.target.value)}
            className="sor-input w-full"
            placeholder="Media ID (from upload)"
          />
          <input
            value={mediaLink}
            onChange={(e) => setMediaLink(e.target.value)}
            className="sor-input w-full"
            placeholder="Or public URL"
          />
          {(msgType === "image" || msgType === "video" || msgType === "document") && (
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="sor-input w-full"
              placeholder="Caption (optional)"
            />
          )}
          {msgType === "document" && (
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="sor-input w-full"
              placeholder="Filename (optional)"
            />
          )}
        </div>
      )}

      {msgType === "location" && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className="sor-input"
            placeholder="Latitude"
            type="number"
            step="any"
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            className="sor-input"
            placeholder="Longitude"
            type="number"
            step="any"
          />
          <input
            value={locName}
            onChange={(e) => setLocName(e.target.value)}
            className="sor-input col-span-2"
            placeholder="Location name (optional)"
          />
          <input
            value={locAddress}
            onChange={(e) => setLocAddress(e.target.value)}
            className="sor-input col-span-2"
            placeholder="Address (optional)"
          />
        </div>
      )}

      {msgType === "reaction" && (
        <div className="space-y-2">
          <input
            value={reactionMsgId}
            onChange={(e) => setReactionMsgId(e.target.value)}
            className="sor-input w-full"
            placeholder="Message ID to react to"
          />
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            className="sor-input w-full"
            placeholder="Emoji (e.g. 👍)"
          />
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={isSending || !to}
        className="sor-btn-primary flex items-center space-x-2"
      >
        {isSending ? <LoadingSpinner /> : <Send size={14} />}
        <span>Send</span>
      </button>

      <ErrorMsg msg={errorMsg} />
      {result && (
        <div className="text-green-400 text-sm flex items-center space-x-2">
          <CheckCircle size={14} />
          <span>{result}</span>
        </div>
      )}
    </div>
  );
};

export default ComposeTab;
