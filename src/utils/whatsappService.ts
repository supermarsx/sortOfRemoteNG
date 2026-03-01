/**
 * WhatsApp integration service — Tauri command wrappers.
 *
 * Provides typed async functions that call the `wa_*` Tauri commands
 * exposed by the `sorng-whatsapp` Rust crate.
 */

import type {
  WaConfig,
  WaSessionSummary,
  WaSendMessageResponse,
  WaTemplatePayload,
  WaTemplateInfo,
  WaCreateTemplateRequest,
  WaPaginatedResponse,
  WaGroupInfo,
  WaChatMessage,
  QrCodeData,
  PairingState,
  UnofficialConnectionState,
} from "../types/whatsapp";

const invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | undefined =
  (globalThis as any).__TAURI__?.core?.invoke;

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invoke) throw new Error("Tauri runtime not available");
  return invoke<T>(cmd, args);
}

// ═══════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════

export function waConfigure(config: WaConfig): Promise<void> {
  return tauriInvoke("wa_configure", { config });
}

export function waConfigureUnofficial(): Promise<void> {
  return tauriInvoke("wa_configure_unofficial");
}

export function waIsConfigured(): Promise<boolean> {
  return tauriInvoke("wa_is_configured");
}

// ═══════════════════════════════════════════════════════════════════════
//  Messaging (Official Cloud API)
// ═══════════════════════════════════════════════════════════════════════

export function waSendText(
  to: string,
  body: string,
  previewUrl?: boolean,
  replyTo?: string,
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_text", {
    to,
    body,
    previewUrl: previewUrl ?? null,
    replyTo: replyTo ?? null,
  });
}

export function waSendImage(
  to: string,
  opts: { mediaId?: string; link?: string; caption?: string; replyTo?: string },
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_image", {
    to,
    mediaId: opts.mediaId ?? null,
    link: opts.link ?? null,
    caption: opts.caption ?? null,
    replyTo: opts.replyTo ?? null,
  });
}

export function waSendDocument(
  to: string,
  opts: {
    mediaId?: string;
    link?: string;
    caption?: string;
    filename?: string;
    replyTo?: string;
  },
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_document", {
    to,
    mediaId: opts.mediaId ?? null,
    link: opts.link ?? null,
    caption: opts.caption ?? null,
    filename: opts.filename ?? null,
    replyTo: opts.replyTo ?? null,
  });
}

export function waSendVideo(
  to: string,
  opts: { mediaId?: string; link?: string; caption?: string; replyTo?: string },
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_video", {
    to,
    mediaId: opts.mediaId ?? null,
    link: opts.link ?? null,
    caption: opts.caption ?? null,
    replyTo: opts.replyTo ?? null,
  });
}

export function waSendAudio(
  to: string,
  opts: { mediaId?: string; link?: string; replyTo?: string },
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_audio", {
    to,
    mediaId: opts.mediaId ?? null,
    link: opts.link ?? null,
    replyTo: opts.replyTo ?? null,
  });
}

export function waSendLocation(
  to: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_location", {
    to,
    latitude,
    longitude,
    name: name ?? null,
    address: address ?? null,
  });
}

export function waSendReaction(
  to: string,
  messageId: string,
  emoji: string,
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_reaction", { to, messageId, emoji });
}

export function waSendTemplate(
  to: string,
  template: WaTemplatePayload,
  replyTo?: string,
): Promise<WaSendMessageResponse> {
  return tauriInvoke("wa_send_template", {
    to,
    template,
    replyTo: replyTo ?? null,
  });
}

export function waMarkAsRead(messageId: string): Promise<void> {
  return tauriInvoke("wa_mark_as_read", { messageId });
}

// ═══════════════════════════════════════════════════════════════════════
//  Media
// ═══════════════════════════════════════════════════════════════════════

/** Upload media from base64-encoded bytes, returns the media ID. */
export function waUploadMedia(
  dataBase64: string,
  mimeType: string,
  filename?: string,
): Promise<string> {
  return tauriInvoke("wa_upload_media", {
    dataBase64,
    mimeType,
    filename: filename ?? null,
  });
}

/** Upload media from a file path, returns the media ID. */
export function waUploadMediaFile(filePath: string, mimeType: string): Promise<string> {
  return tauriInvoke("wa_upload_media_file", { filePath, mimeType });
}

/** Get the download URL for a media ID. */
export function waGetMediaUrl(mediaId: string): Promise<string> {
  return tauriInvoke("wa_get_media_url", { mediaId });
}

/** Download media — returns [base64Data, mimeType]. */
export function waDownloadMedia(mediaId: string): Promise<[string, string]> {
  return tauriInvoke("wa_download_media", { mediaId });
}

/** Delete a media asset. */
export function waDeleteMedia(mediaId: string): Promise<void> {
  return tauriInvoke("wa_delete_media", { mediaId });
}

// ═══════════════════════════════════════════════════════════════════════
//  Templates
// ═══════════════════════════════════════════════════════════════════════

export function waCreateTemplate(
  request: WaCreateTemplateRequest,
): Promise<WaTemplateInfo> {
  return tauriInvoke("wa_create_template", { request });
}

export function waListTemplates(
  limit?: number,
  after?: string,
): Promise<WaPaginatedResponse<WaTemplateInfo>> {
  return tauriInvoke("wa_list_templates", {
    limit: limit ?? null,
    after: after ?? null,
  });
}

export function waDeleteTemplate(name: string): Promise<void> {
  return tauriInvoke("wa_delete_template", { name });
}

// ═══════════════════════════════════════════════════════════════════════
//  Contacts
// ═══════════════════════════════════════════════════════════════════════

export function waCheckContact(phoneNumber: string): Promise<boolean> {
  return tauriInvoke("wa_check_contact", { phoneNumber });
}

export function waMeLink(phoneNumber: string, message?: string): Promise<string> {
  return tauriInvoke("wa_me_link", {
    phoneNumber,
    message: message ?? null,
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Groups
// ═══════════════════════════════════════════════════════════════════════

export function waCreateGroup(
  subject: string,
  participants: string[],
): Promise<string> {
  return tauriInvoke("wa_create_group", { subject, participants });
}

export function waGetGroupInfo(groupId: string): Promise<WaGroupInfo> {
  return tauriInvoke("wa_get_group_info", { groupId });
}

// ═══════════════════════════════════════════════════════════════════════
//  Business Profile & Phone Numbers
// ═══════════════════════════════════════════════════════════════════════

export function waGetBusinessProfile(): Promise<unknown> {
  return tauriInvoke("wa_get_business_profile");
}

export function waListPhoneNumbers(): Promise<unknown> {
  return tauriInvoke("wa_list_phone_numbers");
}

// ═══════════════════════════════════════════════════════════════════════
//  Webhooks
// ═══════════════════════════════════════════════════════════════════════

export function waWebhookVerify(
  mode: string,
  token: string,
  challenge: string,
): Promise<string> {
  return tauriInvoke("wa_webhook_verify", { mode, token, challenge });
}

export function waWebhookProcess(
  rawBody: string,
  signature?: string,
): Promise<unknown> {
  return tauriInvoke("wa_webhook_process", {
    rawBody,
    signature: signature ?? null,
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Sessions
// ═══════════════════════════════════════════════════════════════════════

export function waListSessions(): Promise<WaSessionSummary[]> {
  return tauriInvoke("wa_list_sessions");
}

// ═══════════════════════════════════════════════════════════════════════
//  Unofficial (WA Web)
// ═══════════════════════════════════════════════════════════════════════

export function waUnofficialConnect(): Promise<void> {
  return tauriInvoke("wa_unofficial_connect");
}

export function waUnofficialDisconnect(): Promise<void> {
  return tauriInvoke("wa_unofficial_disconnect");
}

export function waUnofficialState(): Promise<UnofficialConnectionState> {
  return tauriInvoke("wa_unofficial_state");
}

export function waUnofficialSendText(
  to: string,
  text: string,
  replyTo?: string,
): Promise<string> {
  return tauriInvoke("wa_unofficial_send_text", {
    to,
    text,
    replyTo: replyTo ?? null,
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Pairing
// ═══════════════════════════════════════════════════════════════════════

export function waPairingStartQr(): Promise<QrCodeData> {
  return tauriInvoke("wa_pairing_start_qr");
}

export function waPairingRefreshQr(): Promise<QrCodeData | null> {
  return tauriInvoke("wa_pairing_refresh_qr");
}

export function waPairingStartPhone(phoneNumber: string): Promise<string> {
  return tauriInvoke("wa_pairing_start_phone", { phoneNumber });
}

export function waPairingState(): Promise<PairingState> {
  return tauriInvoke("wa_pairing_state");
}

export function waPairingCancel(): Promise<void> {
  return tauriInvoke("wa_pairing_cancel");
}

// ═══════════════════════════════════════════════════════════════════════
//  Chat History
// ═══════════════════════════════════════════════════════════════════════

export function waGetMessages(threadId: string): Promise<WaChatMessage[]> {
  return tauriInvoke("wa_get_messages", { threadId });
}

/** Send text via the best available channel (Cloud API or Unofficial). */
export function waSendAuto(to: string, text: string): Promise<string> {
  return tauriInvoke("wa_send_auto", { to, text });
}
