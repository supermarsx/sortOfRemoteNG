

export type TabId =
  | "chat"
  | "compose"
  | "templates"
  | "media"
  | "contacts"
  | "pairing"
  | "settings";

export type MsgType = "text" | "image" | "document" | "video" | "audio" | "location" | "reaction";

export const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "compose", label: "Compose", icon: Send },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "media", label: "Media", icon: Image },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "pairing", label: "Pairing", icon: QrCode },
  { id: "settings", label: "Settings", icon: Settings },
];

// ═══════════════════════════════════════════════════════════════════════
//  Sub-components
// ═══════════════════════════════════════════════════════════════════════
