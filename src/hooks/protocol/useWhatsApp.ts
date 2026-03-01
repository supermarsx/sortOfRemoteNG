/**
 * React hook for WhatsApp integration state management.
 *
 * Wraps the WhatsApp Tauri service with React state, loading indicators,
 * error handling, and automatic session polling.
 */

import { useState, useCallback, useEffect, useRef } from "react";
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
} from "../../types/whatsapp";
import * as wa from "../../utils/whatsappService";

// ─── Internal Helpers ────────────────────────────────────────────────

function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fn(...args);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [fn],
  );

  return { execute, loading, error };
}

// ═══════════════════════════════════════════════════════════════════════
//  useWhatsApp — primary hook
// ═══════════════════════════════════════════════════════════════════════

export interface UseWhatsAppOptions {
  /** Poll sessions every N ms (0 = disabled). Default 10 000. */
  pollIntervalMs?: number;
}

export function useWhatsApp(opts?: UseWhatsAppOptions) {
  const pollMs = opts?.pollIntervalMs ?? 10_000;

  // ── State ────────────────────────────────────────────────────────
  const [configured, setConfigured] = useState(false);
  const [sessions, setSessions] = useState<WaSessionSummary[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Configuration ────────────────────────────────────────────────
  const configureAction = useAsyncAction(async (config: WaConfig) => {
    await wa.waConfigure(config);
    setConfigured(true);
  });

  const configureUnofficial = useAsyncAction(async () => {
    await wa.waConfigureUnofficial();
  });

  const checkConfigured = useCallback(async () => {
    try {
      const ok = await wa.waIsConfigured();
      setConfigured(ok);
      return ok;
    } catch {
      return false;
    }
  }, []);

  // ── Sessions ─────────────────────────────────────────────────────
  const refreshSessions = useCallback(async () => {
    try {
      const list = await wa.waListSessions();
      setSessions(list);
    } catch {
      /* ignore polling errors */
    }
  }, []);

  useEffect(() => {
    checkConfigured();
    refreshSessions();
  }, [checkConfigured, refreshSessions]);

  useEffect(() => {
    if (pollMs <= 0) return;
    pollRef.current = setInterval(refreshSessions, pollMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollMs, refreshSessions]);

  // ── Messaging ────────────────────────────────────────────────────
  const sendText = useAsyncAction(
    async (to: string, body: string, previewUrl?: boolean, replyTo?: string) =>
      wa.waSendText(to, body, previewUrl, replyTo),
  );

  const sendImage = useAsyncAction(
    async (to: string, opts: Parameters<typeof wa.waSendImage>[1]) =>
      wa.waSendImage(to, opts),
  );

  const sendDocument = useAsyncAction(
    async (to: string, opts: Parameters<typeof wa.waSendDocument>[1]) =>
      wa.waSendDocument(to, opts),
  );

  const sendVideo = useAsyncAction(
    async (to: string, opts: Parameters<typeof wa.waSendVideo>[1]) =>
      wa.waSendVideo(to, opts),
  );

  const sendAudio = useAsyncAction(
    async (to: string, opts: Parameters<typeof wa.waSendAudio>[1]) =>
      wa.waSendAudio(to, opts),
  );

  const sendLocation = useAsyncAction(
    async (to: string, lat: number, lng: number, name?: string, address?: string) =>
      wa.waSendLocation(to, lat, lng, name, address),
  );

  const sendReaction = useAsyncAction(
    async (to: string, messageId: string, emoji: string) =>
      wa.waSendReaction(to, messageId, emoji),
  );

  const sendTemplate = useAsyncAction(
    async (to: string, template: WaTemplatePayload, replyTo?: string) =>
      wa.waSendTemplate(to, template, replyTo),
  );

  const markAsRead = useAsyncAction(async (messageId: string) =>
    wa.waMarkAsRead(messageId),
  );

  const sendAuto = useAsyncAction(async (to: string, text: string) =>
    wa.waSendAuto(to, text),
  );

  // ── Media ────────────────────────────────────────────────────────
  const uploadMedia = useAsyncAction(
    async (dataBase64: string, mimeType: string, filename?: string) =>
      wa.waUploadMedia(dataBase64, mimeType, filename),
  );

  const uploadMediaFile = useAsyncAction(
    async (filePath: string, mimeType: string) =>
      wa.waUploadMediaFile(filePath, mimeType),
  );

  const getMediaUrl = useAsyncAction(async (mediaId: string) =>
    wa.waGetMediaUrl(mediaId),
  );

  const downloadMedia = useAsyncAction(async (mediaId: string) =>
    wa.waDownloadMedia(mediaId),
  );

  const deleteMedia = useAsyncAction(async (mediaId: string) =>
    wa.waDeleteMedia(mediaId),
  );

  // ── Templates ────────────────────────────────────────────────────
  const createTemplate = useAsyncAction(
    async (request: WaCreateTemplateRequest) => wa.waCreateTemplate(request),
  );

  const listTemplates = useAsyncAction(
    async (limit?: number, after?: string) => wa.waListTemplates(limit, after),
  );

  const deleteTemplate = useAsyncAction(async (name: string) =>
    wa.waDeleteTemplate(name),
  );

  // ── Contacts ─────────────────────────────────────────────────────
  const checkContact = useAsyncAction(async (phoneNumber: string) =>
    wa.waCheckContact(phoneNumber),
  );

  const meLink = useAsyncAction(
    async (phoneNumber: string, message?: string) =>
      wa.waMeLink(phoneNumber, message),
  );

  // ── Groups ───────────────────────────────────────────────────────
  const createGroup = useAsyncAction(
    async (subject: string, participants: string[]) =>
      wa.waCreateGroup(subject, participants),
  );

  const getGroupInfo = useAsyncAction(async (groupId: string) =>
    wa.waGetGroupInfo(groupId),
  );

  // ── Business Profile & Phone Numbers ─────────────────────────────
  const getBusinessProfile = useAsyncAction(async () =>
    wa.waGetBusinessProfile(),
  );

  const listPhoneNumbers = useAsyncAction(async () =>
    wa.waListPhoneNumbers(),
  );

  // ── Chat History ─────────────────────────────────────────────────
  const getMessages = useAsyncAction(async (threadId: string) =>
    wa.waGetMessages(threadId),
  );

  // ── Unofficial (WA Web) ──────────────────────────────────────────
  const unofficialConnect = useAsyncAction(async () =>
    wa.waUnofficialConnect(),
  );

  const unofficialDisconnect = useAsyncAction(async () =>
    wa.waUnofficialDisconnect(),
  );

  const unofficialState = useAsyncAction(async () =>
    wa.waUnofficialState(),
  );

  const unofficialSendText = useAsyncAction(
    async (to: string, text: string, replyTo?: string) =>
      wa.waUnofficialSendText(to, text, replyTo),
  );

  // ── Pairing ──────────────────────────────────────────────────────
  const pairingStartQr = useAsyncAction(async () =>
    wa.waPairingStartQr(),
  );

  const pairingRefreshQr = useAsyncAction(async () =>
    wa.waPairingRefreshQr(),
  );

  const pairingStartPhone = useAsyncAction(async (phoneNumber: string) =>
    wa.waPairingStartPhone(phoneNumber),
  );

  const pairingState = useAsyncAction(async () =>
    wa.waPairingState(),
  );

  const pairingCancel = useAsyncAction(async () =>
    wa.waPairingCancel(),
  );

  return {
    // state
    configured,
    sessions,

    // config
    configure: configureAction,
    configureUnofficial,
    checkConfigured,
    refreshSessions,

    // messaging
    sendText,
    sendImage,
    sendDocument,
    sendVideo,
    sendAudio,
    sendLocation,
    sendReaction,
    sendTemplate,
    markAsRead,
    sendAuto,

    // media
    uploadMedia,
    uploadMediaFile,
    getMediaUrl,
    downloadMedia,
    deleteMedia,

    // templates
    createTemplate,
    listTemplates,
    deleteTemplate,

    // contacts
    checkContact,
    meLink,

    // groups
    createGroup,
    getGroupInfo,

    // business profile & phone numbers
    getBusinessProfile,
    listPhoneNumbers,

    // chat history
    getMessages,

    // unofficial
    unofficialConnect,
    unofficialDisconnect,
    unofficialState,
    unofficialSendText,

    // pairing
    pairingStartQr,
    pairingRefreshQr,
    pairingStartPhone,
    pairingState,
    pairingCancel,
  };
}
