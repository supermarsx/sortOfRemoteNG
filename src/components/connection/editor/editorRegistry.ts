import {
  Cloud,
  FileText,
  Settings2,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type ConnectionEditorTabId =
  | "general"
  | "protocol"
  | "behavior"
  | "organize"
  | "notes";

export type ConnectionEditorExpandableSectionId = "advanced" | "description";

export interface ConnectionEditorTabDescriptor {
  id: ConnectionEditorTabId;
  label: string;
  icon: LucideIcon;
  connectionOnly?: boolean;
}

export interface ConnectionEditorSearchFieldDescriptor {
  id: string;
  label: string;
  keywords?: readonly string[];
}

export interface ConnectionEditorSearchDescriptor {
  id: string;
  tabId: ConnectionEditorTabId;
  label: string;
  keywords: readonly string[];
  fields: readonly ConnectionEditorSearchFieldDescriptor[];
  connectionOnly?: boolean;
  expandableSectionId?: ConnectionEditorExpandableSectionId;
}

export interface ConnectionEditorSearchNavigationHandlers {
  activateTab: (tabId: ConnectionEditorTabId) => void;
  expandSection?: (sectionId: ConnectionEditorExpandableSectionId) => void;
  focusField?: (fieldId: string, sectionId: string) => void;
}

export const CONNECTION_EDITOR_TABS = [
  { id: "general", label: "Basics", icon: Settings2 },
  { id: "protocol", label: "Protocol", icon: Cloud, connectionOnly: true },
  { id: "behavior", label: "Behavior", icon: Zap, connectionOnly: true },
  { id: "organize", label: "Organize", icon: Tag },
  { id: "notes", label: "Notes", icon: FileText },
] as const satisfies readonly ConnectionEditorTabDescriptor[];

export const CONNECTION_EDITOR_SEARCH_DESCRIPTORS = [
  {
    id: "general-basics",
    tabId: "general",
    label: "Basics",
    keywords: ["identity", "folder", "group", "favorite"],
    fields: [
      { id: "isGroup", label: "Folder/Group", keywords: ["type"] },
      { id: "favorite", label: "Favorite", keywords: ["star"] },
      { id: "name", label: "Connection Name", keywords: ["title"] },
    ],
  },
  {
    id: "general-parent",
    tabId: "general",
    label: "Parent Folder",
    keywords: ["parent", "folder", "group", "root", "organize"],
    fields: [{ id: "parent-folder", label: "Parent Folder" }],
  },
  {
    id: "general-connection",
    tabId: "general",
    label: "Connection",
    keywords: ["protocol", "server", "host", "credentials", "integration"],
    fields: [
      { id: "protocol", label: "Protocol", keywords: ["connection type"] },
      { id: "hostname", label: "Hostname", keywords: ["host", "server"] },
      { id: "port", label: "Port" },
      { id: "username", label: "Username", keywords: ["user"] },
      { id: "password", label: "Password", keywords: ["credential"] },
      { id: "domain", label: "Domain" },
    ],
  },
  {
    id: "protocol-options",
    tabId: "protocol",
    label: "Protocol Options",
    keywords: [
      "ssh",
      "http",
      "https",
      "cloud",
      "rdp",
      "winrm",
      "totp",
      "backup codes",
      "security questions",
      "recovery",
    ],
    fields: [
      {
        id: "protocol-options",
        label: "Protocol-specific options",
        keywords: ["advanced", "authentication"],
      },
    ],
    connectionOnly: true,
  },
  {
    id: "behavior-focus",
    tabId: "behavior",
    label: "Focus Behavior",
    keywords: ["behavior", "focus", "background", "windows management"],
    fields: [
      { id: "focus-on-connect", label: "On Connect" },
      {
        id: "focus-on-winmgmt-tool",
        label: "On Windows Management Tool",
        keywords: ["winrm", "rdp"],
      },
    ],
    connectionOnly: true,
  },
  {
    id: "organize-icon",
    tabId: "organize",
    label: "Custom Icon",
    keywords: ["organize", "icon", "appearance", "symbol"],
    fields: [{ id: "icon", label: "Custom Icon" }],
  },
  {
    id: "organize-tags",
    tabId: "organize",
    label: "Tags",
    keywords: ["organize", "tags", "labels"],
    fields: [{ id: "tags", label: "Tags" }],
  },
  {
    id: "notes-description",
    tabId: "notes",
    label: "Description & Notes",
    keywords: ["notes", "description", "documentation", "comments"],
    fields: [{ id: "description", label: "Description & Notes" }],
    expandableSectionId: "description",
  },
] as const satisfies readonly ConnectionEditorSearchDescriptor[];

export function getConnectionEditorTabs(
  isGroup: boolean,
): readonly ConnectionEditorTabDescriptor[] {
  return CONNECTION_EDITOR_TABS.filter(
    (tab) => !isGroup || !("connectionOnly" in tab) || !tab.connectionOnly,
  );
}

export function getConnectionEditorSearchDescriptors(
  isGroup: boolean,
): readonly ConnectionEditorSearchDescriptor[] {
  return CONNECTION_EDITOR_SEARCH_DESCRIPTORS.filter(
    (descriptor) =>
      !isGroup ||
      !("connectionOnly" in descriptor) ||
      !descriptor.connectionOnly,
  );
}

export function navigateToConnectionEditorSearchDescriptor(
  sectionId: string,
  handlers: ConnectionEditorSearchNavigationHandlers,
  fieldId?: string,
  descriptors: readonly ConnectionEditorSearchDescriptor[] = CONNECTION_EDITOR_SEARCH_DESCRIPTORS,
): boolean {
  const descriptor = descriptors.find(
    (candidate) => candidate.id === sectionId,
  );
  if (!descriptor) return false;

  if (
    fieldId &&
    !descriptor.fields.some((candidate) => candidate.id === fieldId)
  ) {
    return false;
  }

  handlers.activateTab(descriptor.tabId);
  if (descriptor.expandableSectionId) {
    handlers.expandSection?.(descriptor.expandableSectionId);
  }
  if (fieldId) {
    handlers.focusField?.(fieldId, descriptor.id);
  }

  return true;
}
