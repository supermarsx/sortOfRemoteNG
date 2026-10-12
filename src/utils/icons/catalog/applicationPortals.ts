import {
  apacheguacamole,
  arlo,
  brevo,
  ebay,
  googleadsense,
  googleforms,
  googlegemini,
  googleplay,
  kimi,
  notion,
  npm,
  pypi,
  reddit,
  steam,
  tesla,
  uptimekuma,
  vaultwarden,
  x,
  youtubestudio,
} from "../brand/generatedBrandIcons";
import { openai } from "../brand/historicalBrandIcons";
import {
  autoridadeTributariaIdentifier,
  eRedesIdentifier,
  imtIdentifier,
  irnIdentifier,
  lovableIdentifier,
  segurancaSocialIdentifier,
  viaVerdeIdentifier,
  zabbixIdentifier,
} from "../brand/applicationPortalIdentifierIcons";
import { defineIcon } from "./types";

/**
 * Icons for the website applications that previously suggested a generic glyph
 * or their family's mark. Sources and terms: docs/connection-icon-brands.md.
 *
 * Keys are persisted values and name the application, never the artwork. To
 * give one application different artwork, change the icon of its entry here
 * (and the description, which says what the artwork is): the suggestion maps
 * and the tests do not depend on which kind of artwork an entry uses.
 */
export const APPLICATION_PORTAL_ICONS = [
  defineIcon(
    "autoridade-tributaria",
    "Autoridade Tributária",
    "web-applications",
    autoridadeTributariaIdentifier,
    [
      "autoridade tributária",
      "autoridade tributaria",
      "at",
      "portal das finanças",
      "portal das financas",
      "finanças",
    ],
    "App-authored AT initials identifier; not an official Autoridade Tributária logo.",
  ),
  defineIcon(
    "seguranca-social",
    "Segurança Social",
    "web-applications",
    segurancaSocialIdentifier,
    [
      "segurança social",
      "seguranca social",
      "segurança social direta",
      "ss",
      "seg-social",
    ],
    "App-authored SS initials identifier; not an official Segurança Social logo.",
  ),
  defineIcon(
    "irn",
    "IRN (Registos)",
    "web-applications",
    irnIdentifier,
    ["irn", "registos", "notariado", "instituto dos registos e do notariado"],
    "App-authored IRN initials identifier; not an official IRN logo.",
  ),
  defineIcon(
    "e-redes",
    "E-REDES",
    "web-applications",
    eRedesIdentifier,
    ["e-redes", "eredes", "balcão digital", "distribuição de eletricidade"],
    "App-authored ER initials identifier; not an official E-REDES logo.",
  ),
  defineIcon(
    "imt",
    "IMT",
    "web-applications",
    imtIdentifier,
    ["imt", "imt online", "instituto da mobilidade e dos transportes"],
    "App-authored IMT initials identifier; not an official IMT logo.",
  ),
  defineIcon(
    "via-verde",
    "Via Verde",
    "web-applications",
    viaVerdeIdentifier,
    ["via verde", "viaverde", "portagens", "tolls"],
    "App-authored VV initials identifier; not an official Via Verde logo.",
  ),
  defineIcon(
    "zabbix",
    "Zabbix",
    "web-applications",
    zabbixIdentifier,
    ["zabbix", "monitoring"],
    "App-authored ZB initials identifier; not an official Zabbix logo.",
  ),
  defineIcon(
    "lovable",
    "Lovable",
    "web-applications",
    lovableIdentifier,
    ["lovable", "lovable.dev", "app builder"],
    "App-authored L/code-chevrons identifier; not an official Lovable logo.",
  ),
  defineIcon(
    "chatgpt",
    "ChatGPT",
    "web-applications",
    openai,
    ["chatgpt", "chat gpt", "openai", "ai assistant"],
    "ChatGPT connection icon using the historical OpenAI mark pinned from Simple Icons 15.22.0; not current OpenAI or ChatGPT branding.",
  ),
  defineIcon(
    "google-gemini",
    "Google Gemini",
    "web-applications",
    googlegemini,
    ["google gemini", "gemini", "google ai", "ai assistant"],
  ),
  defineIcon("kimi", "Kimi", "web-applications", kimi, [
    "kimi",
    "moonshot ai",
    "moonshot",
    "ai assistant",
  ]),
  defineIcon("google-play", "Google Play", "web-applications", googleplay, [
    "google play",
    "play store",
    "play console",
    "android apps",
  ]),
  defineIcon(
    "google-adsense",
    "Google AdSense",
    "web-applications",
    googleadsense,
    ["google adsense", "adsense", "advertising revenue"],
  ),
  defineIcon("google-forms", "Google Forms", "web-applications", googleforms, [
    "google forms",
    "forms",
    "surveys",
  ]),
  defineIcon(
    "youtube-studio",
    "YouTube Studio",
    "web-applications",
    youtubestudio,
    ["youtube studio", "youtube", "creator studio", "video channel"],
  ),
  defineIcon("notion", "Notion", "web-applications", notion, [
    "notion",
    "notes",
    "wiki",
    "workspace",
  ]),
  defineIcon("arlo", "Arlo", "web-applications", arlo, [
    "arlo",
    "security cameras",
    "smart home",
  ]),
  defineIcon("uptime-kuma", "Uptime Kuma", "web-applications", uptimekuma, [
    "uptime kuma",
    "uptimekuma",
    "status page",
    "monitoring",
  ]),
  defineIcon("steam", "Steam", "web-applications", steam, [
    "steam",
    "valve",
    "steam store",
    "games",
  ]),
  defineIcon("npm", "npm", "web-applications", npm, [
    "npm",
    "npmjs",
    "node package manager",
    "package registry",
  ]),
  defineIcon("pypi", "PyPI", "web-applications", pypi, [
    "pypi",
    "python package index",
    "python packages",
    "package registry",
  ]),
  defineIcon("reddit", "Reddit", "web-applications", reddit, [
    "reddit",
    "subreddit",
    "social network",
  ]),
  defineIcon("tesla", "Tesla", "web-applications", tesla, [
    "tesla",
    "tesla account",
    "electric vehicle",
  ]),
  defineIcon("ebay", "eBay", "web-applications", ebay, [
    "ebay",
    "marketplace",
    "auctions",
  ]),
  defineIcon("x", "X", "web-applications", x, [
    "x",
    "x.com",
    "twitter",
    "social network",
  ]),
  defineIcon("vaultwarden", "Vaultwarden", "web-applications", vaultwarden, [
    "vaultwarden",
    "vault warden",
    "bitwarden compatible",
    "password manager",
  ]),
  defineIcon(
    "guacamole",
    "Apache Guacamole",
    "web-applications",
    apacheguacamole,
    ["guacamole", "apache guacamole", "clientless remote desktop"],
  ),
  defineIcon("brevo", "Brevo", "web-applications", brevo, [
    "brevo",
    "sendinblue",
    "email marketing",
    "transactional email",
  ]),
] as const;
