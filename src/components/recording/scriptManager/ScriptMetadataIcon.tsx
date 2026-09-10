import type { OSTag } from "./shared";
import { platformIcon, scriptLanguageIcon } from "./scriptMetadataIcons";

/** Uses the central immutable vector collection; no font/emoji substitution. */
export function ScriptMetadataIcon({
  platform,
  language,
  size = 16,
}: {
  platform?: OSTag;
  language?: string;
  size?: number;
}) {
  const Icon = platform
    ? platformIcon(platform)
    : scriptLanguageIcon(language ?? "auto");
  return <Icon size={size} aria-hidden="true" className="shrink-0" />;
}
