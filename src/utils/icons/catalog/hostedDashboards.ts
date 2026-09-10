import {
  claude,
  openrouter,
  facebook,
  instagram,
  gmail,
  googleanalytics,
  googleads,
  googlesearchconsole,
  youtube,
  icloud,
} from "../brand/generatedBrandIcons";
import {
  adobe,
  registroBr,
  marcariaIdentifier,
  freednsIdentifier,
} from "../brand/dashboardBrandIcons";
import { defineIcon } from "./types";

/** Pure provider marks: no browser/server frames or permission implications. */
export const HOSTED_DASHBOARD_ICONS = [
  defineIcon(
    "adobe",
    "Adobe",
    "web-applications",
    adobe,
    ["adobe", "adobe account", "creative cloud"],
    "Publisher Adobe A contour, normalized from its official SVG wordmark; theme-aware vector.",
  ),
  defineIcon("youtube", "YouTube", "web-applications", youtube, [
    "youtube",
    "you tube",
    "google video",
    "video channel",
  ]),
  defineIcon("icloud", "iCloud", "web-applications", icloud, [
    "icloud",
    "i cloud",
    "apple cloud",
    "apple account",
  ]),
  defineIcon("claude", "Claude", "web-applications", claude, [
    "claude",
    "anthropic",
    "ai assistant",
  ]),
  defineIcon("openrouter", "OpenRouter", "web-applications", openrouter, [
    "openrouter",
    "open router",
    "ai models",
  ]),
  defineIcon("facebook", "Facebook", "web-applications", facebook, [
    "facebook",
    "meta",
    "social network",
  ]),
  defineIcon("instagram", "Instagram", "web-applications", instagram, [
    "instagram",
    "meta",
    "social photos",
  ]),
  defineIcon("gmail", "Gmail", "web-applications", gmail, [
    "gmail",
    "google mail",
    "google workspace",
  ]),
  defineIcon(
    "google-analytics",
    "Google Analytics",
    "web-applications",
    googleanalytics,
    ["google analytics", "analytics", "ga4"],
  ),
  defineIcon("google-ads", "Google Ads", "web-applications", googleads, [
    "google ads",
    "adwords",
    "advertising",
  ]),
  defineIcon(
    "google-search-console",
    "Google Search Console",
    "web-applications",
    googlesearchconsole,
    ["google search console", "webmaster", "search console"],
  ),
] as const;

export const HOSTED_REGISTRAR_ICONS = [
  defineIcon(
    "marcaria",
    "Marcaria",
    "domain-registrars",
    marcariaIdentifier,
    ["marcaria", "marcaria.com", "domain registrar", "trademark"],
    "App-authored M/trademark vector identifier; not an official Marcaria logo.",
  ),
  defineIcon(
    "freedns",
    "FreeDNS (afraid.org)",
    "domain-registrars",
    freednsIdentifier,
    ["freedns", "free dns", "afraid.org", "dynamic dns", "ddns"],
    "App-authored F/DNS vector identifier; not an official FreeDNS logo.",
  ),
  defineIcon(
    "registro-br",
    "Registro.br",
    "domain-registrars",
    registroBr,
    ["registro.br", "registro br", "brazil", "br registry", "nic.br"],
    "Publisher .br mark from the official pinned-tab SVG; uniformly scaled, theme-aware vector.",
  ),
] as const;
