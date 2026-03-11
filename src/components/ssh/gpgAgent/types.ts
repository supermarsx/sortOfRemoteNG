import React from "react";
import {
  Shield,
  Key,
  FileKey,
  Lock,
  ShieldCheck,
  CreditCard,
  Globe,
  FileText,
  Settings,
} from "lucide-react";
import { useGpgAgent } from "../../../hooks/ssh/useGpgAgent";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type Mgr = ReturnType<typeof useGpgAgent>;

export type GpgTab =
  | "overview"
  | "keyring"
  | "sign-verify"
  | "encrypt-decrypt"
  | "trust"
  | "smartcard"
  | "keyserver"
  | "audit"
  | "config";

export interface GpgAgentManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Tab definitions                                                    */
/* ------------------------------------------------------------------ */

export const tabs: { id: GpgTab; icon: React.ReactNode; labelKey: string }[] = [
  { id: "overview", icon: React.createElement(Shield, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.overview" },
  { id: "keyring", icon: React.createElement(Key, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.keyring" },
  { id: "sign-verify", icon: React.createElement(FileKey, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.signVerify" },
  { id: "encrypt-decrypt", icon: React.createElement(Lock, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.encryptDecrypt" },
  { id: "trust", icon: React.createElement(ShieldCheck, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.trust" },
  { id: "smartcard", icon: React.createElement(CreditCard, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.smartCard" },
  { id: "keyserver", icon: React.createElement(Globe, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.keyserver" },
  { id: "audit", icon: React.createElement(FileText, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.audit" },
  { id: "config", icon: React.createElement(Settings, { className: "w-4 h-4" }), labelKey: "gpgAgent.tabs.config" },
];
