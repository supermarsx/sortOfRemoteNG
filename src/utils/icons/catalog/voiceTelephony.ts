import { PhoneCall, PhoneForwarded, Voicemail } from "lucide-react";

import { defineIcon } from "./types";

/**
 * Voice and telephony icons. Seeded with generic Lucide entries so the category
 * is never empty; the remaining PBX, handset and carrier entries are appended by
 * later work without touching the entries below.
 */
export const VOICE_TELEPHONY_ICONS = [
  defineIcon("voip", "VoIP", "voice-telephony", PhoneCall, [
    "voip",
    "sip",
    "voice",
    "telephony",
    "call",
  ]),
  defineIcon("pbx-server", "PBX server", "voice-telephony", Voicemail, [
    "pbx",
    "voicemail",
    "telephony",
    "extension",
    "voice",
  ]),
  defineIcon("freepbx", "FreePBX", "voice-telephony", PhoneForwarded, [
    "freepbx",
    "pbx",
    "pbx gui",
    "telephony",
    "sip",
  ]),
] as const;
