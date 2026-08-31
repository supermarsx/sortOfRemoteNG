import {
  FileKey2,
  Fingerprint,
  KeyRound,
  Lock,
  ScanFace,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { pfsense } from "../brand";
import { defineIcon } from "./types";

export const SECURITY_ICONS = [
  defineIcon("shield", "Shield", "security", Shield, [
    "security",
    "protection",
  ]),
  defineIcon("shield-check", "Protected", "security", ShieldCheck, [
    "pfsense",
    "verified",
    "firewall",
  ]),
  defineIcon("shield-alert", "Security alert", "security", ShieldAlert, [
    "warning",
    "threat",
  ]),
  defineIcon("lock", "Locked", "security", Lock, ["secure", "encrypted"]),
  defineIcon("key-round", "Key", "security", KeyRound, [
    "keepass",
    "credential",
  ]),
  defineIcon("fingerprint", "Identity", "security", Fingerprint, [
    "authentication",
    "biometric",
  ]),
  defineIcon("scan-face", "Identity scan", "security", ScanFace, [
    "face",
    "authentication",
  ]),
  defineIcon("file-key", "Key file", "security", FileKey2, [
    "certificate",
    "private key",
  ]),
  defineIcon("pfsense", "pfSense", "security", pfsense, [
    "pfsense",
    "firewall",
    "router",
    "network appliance",
  ]),
] as const;
