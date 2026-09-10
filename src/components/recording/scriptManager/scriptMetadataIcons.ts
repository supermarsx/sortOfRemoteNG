import { OS_TAG_ICONS, type OSTag } from "./shared";
import { CONNECTION_ICON_REGISTRY } from "../../../utils/icons/connectionIconCatalog";

// UI-only lookup: shared data/type modules do not import the icon collection.
export const platformIcon = (platform: OSTag) =>
  CONNECTION_ICON_REGISTRY[
    OS_TAG_ICONS[platform] as keyof typeof CONNECTION_ICON_REGISTRY
  ] ?? CONNECTION_ICON_REGISTRY.globe;
export const scriptLanguageIcon = (language: string) =>
  CONNECTION_ICON_REGISTRY[
    (language === "auto"
      ? "file-code"
      : language) as keyof typeof CONNECTION_ICON_REGISTRY
  ] ?? CONNECTION_ICON_REGISTRY.terminal;
