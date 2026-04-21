import { useState } from "react";
import { FileText, Image, MapPin, Music, Send, SmilePlus, Video } from "lucide-react";
import { MsgType } from "./types";

/**
 * Encapsulates all form state and send logic for the WhatsApp compose tab.
 */
export function useComposeTab(wa: { sendText: any; sendImage: any; sendDocument: any; sendVideo: any; sendAudio: any; sendLocation: any; sendReaction: any }) {
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

  return {
    to, setTo,
    msgType, setMsgType,
    textBody, setTextBody,
    previewUrl, setPreviewUrl,
    mediaId, setMediaId,
    mediaLink, setMediaLink,
    caption, setCaption,
    filename, setFilename,
    lat, setLat,
    lng, setLng,
    locName, setLocName,
    locAddress, setLocAddress,
    reactionMsgId, setReactionMsgId,
    emoji, setEmoji,
    result,
    handleSend,
    icons,
    isSending,
    errorMsg,
  };
}
