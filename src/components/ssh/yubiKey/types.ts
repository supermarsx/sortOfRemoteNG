import React from "react";
import {
  Usb,
  CreditCard,
  Fingerprint,
  Timer,
  KeyRound,
  Settings,
  Activity,
} from "lucide-react";
import { useYubiKey } from "../../../hooks/ssh/useYubiKey";

export type Mgr = ReturnType<typeof useYubiKey>;

export type YubiKeyTab =
  | "devices"
  | "piv"
  | "fido2"
  | "oath"
  | "otp"
  | "config"
  | "audit";

export interface YubiKeyManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const tabDefs: { id: YubiKeyTab; icon: React.ReactNode; labelKey: string }[] = [
  {
    id: "devices",
    icon: React.createElement(Usb, { className: "w-4 h-4" }),
    labelKey: "yubikey.tabs.devices",
  },
  {
    id: "piv",
    icon: React.createElement(CreditCard, { className: "w-4 h-4" }),
    labelKey: "yubikey.tabs.piv",
  },
  {
    id: "fido2",
    icon: React.createElement(Fingerprint, { className: "w-4 h-4" }),
    labelKey: "yubikey.tabs.fido2",
  },
  {
    id: "oath",
    icon: React.createElement(Timer, { className: "w-4 h-4" }),
    labelKey: "yubikey.tabs.oath",
  },
  {
    id: "otp",
    icon: React.createElement(KeyRound, { className: "w-4 h-4" }),
    labelKey: "yubikey.tabs.otp",
  },
  {
    id: "config",
    icon: React.createElement(Settings, { className: "w-4 h-4" }),
    labelKey: "yubikey.tabs.config",
  },
  {
    id: "audit",
    icon: React.createElement(Activity, { className: "w-4 h-4" }),
    labelKey: "yubikey.tabs.audit",
  },
];
