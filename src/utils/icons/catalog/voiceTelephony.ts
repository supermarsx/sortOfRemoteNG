import { PhoneCall, Voicemail } from "lucide-react";

import {
  android,
  apple,
  asterisk,
  cisco,
  freepbxIdentifier,
  grandstream,
  samsung,
  ubiquiti,
  yealink,
} from "../brand";
import { createRoleIcon } from "../createRoleIcon";
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
  defineIcon(
    "pbx-server",
    "PBX server",
    "voice-telephony",
    createRoleIcon("PbxServer", "server", Voicemail),
    ["pbx", "voicemail", "telephony", "extension", "voice"],
  ),
  defineIcon(
    "freepbx",
    "FreePBX",
    "voice-telephony",
    freepbxIdentifier,
    ["freepbx", "pbx", "pbx gui", "telephony", "sip"],
    "FreePBX frog mascot locally hand-traced from the upstream framework artwork as a compact monochrome vector.",
  ),
  defineIcon(
    "freepbx-server",
    "FreePBX server",
    "voice-telephony",
    createRoleIcon("FreePBXServer", "server", freepbxIdentifier),
    ["freepbx", "free pbx", "pbx server", "sip"],
    "FreePBX server using the same compact monochrome trace of the upstream frog mascot.",
  ),
  defineIcon("asterisk", "Asterisk", "voice-telephony", asterisk, [
    "asterisk",
    "pbx",
    "sip",
    "telephony",
  ]),
  defineIcon(
    "asterisk-server",
    "Asterisk server",
    "voice-telephony",
    createRoleIcon("AsteriskServer", "server", asterisk),
    ["asterisk", "pbx server", "sip", "telephony"],
  ),
  defineIcon(
    "yealink",
    "Yealink",
    "voice-telephony",
    yealink,
    ["yealink", "phone", "sip", "voip"],
    "Yealink device identifier authored by the app; not an official Yealink logo.",
  ),
  defineIcon(
    "grandstream",
    "Grandstream",
    "voice-telephony",
    grandstream,
    ["grandstream", "phone", "sip", "voip"],
    "Grandstream G emblem locally hand-traced from the publisher artwork, with gradients simplified for monochrome display.",
  ),
  defineIcon(
    "yealink-phone",
    "Yealink phone",
    "voice-telephony",
    createRoleIcon("YealinkPhone", "desk-phone", yealink),
    ["yealink", "phone", "sip", "voip", "desk phone"],
    "Yealink phone with an app-authored device identifier; not an official Yealink logo.",
  ),
  defineIcon(
    "grandstream-phone",
    "Grandstream phone",
    "voice-telephony",
    createRoleIcon("GrandstreamPhone", "desk-phone", grandstream),
    ["grandstream", "phone", "sip", "voip", "desk phone"],
    "Grandstream phone using the same locally traced monochrome G emblem.",
  ),
  defineIcon(
    "cisco-phone",
    "Cisco phone",
    "voice-telephony",
    createRoleIcon("CiscoPhone", "desk-phone", cisco),
    ["cisco", "phone", "ip phone", "sip", "voip"],
  ),
  defineIcon(
    "ubiquiti-phone",
    "Ubiquiti phone",
    "voice-telephony",
    createRoleIcon("UbiquitiPhone", "desk-phone", ubiquiti),
    ["ubiquiti", "phone", "unifi talk", "sip", "voip"],
  ),
  defineIcon(
    "iphone",
    "iPhone",
    "voice-telephony",
    createRoleIcon("IPhone", "phone", apple),
    ["iphone", "apple phone", "ios", "mobile", "smartphone"],
  ),
  defineIcon(
    "android-phone",
    "Android phone",
    "voice-telephony",
    createRoleIcon("AndroidPhone", "phone", android),
    ["android", "phone", "mobile", "smartphone"],
  ),
  defineIcon(
    "samsung-phone",
    "Samsung phone",
    "voice-telephony",
    createRoleIcon("SamsungPhone", "phone", samsung),
    ["samsung", "smasung", "phone", "galaxy", "android", "mobile"],
  ),
  defineIcon("voicemail", "Voicemail", "voice-telephony", Voicemail, [
    "voicemail",
    "voice mail",
    "pbx",
    "message",
    "plain",
  ]),
] as const;
