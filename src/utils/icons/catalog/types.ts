import { type LucideIcon } from "lucide-react";

export const CONNECTION_ICON_CATEGORIES = [
  "remote-protocols",
  "servers-devices",
  "network",
  "cloud",
  "databases",
  "devops-monitoring",
  "security",
  "files",
  "communication",
  "generic-shapes",
  "operating-systems",
  "virtualization",
  "vendors-hardware",
  "voice-telephony",
  "web-applications",
] as const;

export type ConnectionIconCategory =
  (typeof CONNECTION_ICON_CATEGORIES)[number];

export interface ConnectionIconDefinition<Key extends string = string> {
  /** Stable persisted value. Never derive this from a component name. */
  key: Key;
  label: string;
  category: ConnectionIconCategory;
  icon: LucideIcon;
  /** Screen-reader label suitable for an icon-only control. */
  ariaLabel: string;
  description: string;
  keywords: readonly string[];
}

export function defineIcon<const Key extends string>(
  key: Key,
  label: string,
  category: ConnectionIconCategory,
  icon: LucideIcon,
  keywords: readonly string[],
  description = `${label} connection icon`,
): ConnectionIconDefinition<Key> {
  return {
    key,
    label,
    category,
    icon,
    ariaLabel: `${label} icon`,
    description,
    keywords,
  };
}
