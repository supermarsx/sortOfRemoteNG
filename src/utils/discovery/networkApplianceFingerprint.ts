/**
 * Passive network-appliance fingerprints (OPNsense, TP-Link, Yealink).
 *
 * Same contract as serviceFingerprint.ts: only complete, vendor-branded
 * identifiers in the HTTP title, Server header, Basic realm, final redirect
 * origin, a few unambiguous body asset paths, or a SIP User-Agent count. A
 * generic FreeBSD banner, a bare "Router Webserver" or an OUI prefix is never
 * enough on its own. Self-reported strings, not identity verification.
 *
 * Not covered on purpose: SNMP sysObjectID, mDNS/SSDP and MAC OUI evidence is
 * not collected by the scanner, so there is nothing to match against.
 */

export type NetworkApplianceProduct =
  "OPNsense" | "TP-Link" | "TP-Link Omada" | "Yealink";

export interface NetworkApplianceMatch {
  product: NetworkApplianceProduct;
  /** Model/family hint taken from the branded string, when present. */
  model?: string;
  /** Short human readable reason, appended to the discovery evidence. */
  signal: string;
}

export interface NetworkApplianceEvidence {
  title?: string;
  server?: string;
  basicRealm?: string;
  status?: number;
  finalOrigin?: string;
  /** Raw banner / body text (may be HTML). */
  text?: string;
}

const norm = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim();

// ---- OPNsense -------------------------------------------------------------
// Login page: "OPNsense"; dashboard: "<host> | Lobby: Dashboard | OPNsense".
// pfSense is deliberately absent: its title/assets are matched elsewhere.
const OPNSENSE_TITLE =
  /^(?:[\w.-]+\s*[-–|]\s*)?(?:(?:Lobby:\s*Dashboard|Login|Sign In)\s*[-–|]\s*)?OPNsense(?:®)?(?:\s*[-–|:]\s*(?:Login|Sign In|Dashboard))?$/i;
// Theme assets served by the OPNsense MVC UI (never by pfSense).
const OPNSENSE_ASSET =
  /\/ui\/themes\/opnsense\/|\/ui\/js\/opnsense[\w.-]*\.js/i;

// ---- TP-Link --------------------------------------------------------------
const TPLINK_MODEL =
  /\b(Archer\s+[A-Z]{1,3}\d{1,4}[A-Z0-9]*|Deco\s+[A-Z]{1,2}\d{1,3}[A-Z0-9]*|(?:TL-)?(?:WR|WA|WDR|SG|SF|SL|TD|MR|RE|ER|EAP|SX|OC|AP|CPE)\d{2,5}[A-Z0-9]*)\b/i;
const TPLINK_PRODUCT_WORDS =
  "(?:Wireless|Gigabit|Router|Archer|Deco|JetStream|Omada|Switch|Access Point|Wi-?Fi|Range Extender|Powerline|Smart|Modem|Mesh|Easy Smart|TL-|\\w+-?[A-Z]{1,4}\\d{2,5})";
const TPLINK_TITLE = new RegExp(
  `^TP-?LINK(?:®)?\\s+${TPLINK_PRODUCT_WORDS}[\\w .()/+-]{0,70}$`,
  "i",
);
const TPLINK_ARCHER_TITLE =
  /^Archer\s+[A-Z]{1,3}\d{1,4}[A-Z0-9]*(?:\s*\([\w .-]+\))?$/i;
const TPLINK_MODEL_TITLE = /^TL-[A-Z]{1,4}\d{2,5}[A-Z0-9]*(?:\s+[\w.]+)?$/i;
const TPLINK_DECO_TITLE = /^TP-?Link\s+Deco(?:\s+[\w-]+)?$/i;
const OMADA_TITLE =
  /^Omada(?:\s+(?:Software|Hardware))?(?:\s+Controller)?(?:\s*[-–|:]\s*(?:Login|Sign In))?$/i;
const TPLINK_SERVER = /^TP-?LINK(?:[ -][\w]+){0,3}(?:\/[\d.]+)?$/i;
// Setup hostnames the firmware redirects to.
const TPLINK_ORIGIN =
  /(?:^|\/\/)(?:tplinkwifi|tplinklogin|tplinkmodem|tplinkextender|tplinkplc|tplinkrepeater)\.net(?::\d+)?$/i;
const TPLINK_REALM = /^TP-?LINK\b\s*(.*)$/i;

// ---- Yealink --------------------------------------------------------------
const YEALINK_MODEL_TOKEN =
  "(?:SIP[- ]?)?(?:T\\d{2}[A-Z]{0,2}|VP\\d{2}[A-Z]?|W\\d{2}[A-Z]?|CP\\d{3}[A-Z]?|MP\\d{2}[A-Z]?|EXP\\d{2}[A-Z]?|A\\d{2}[A-Z]?)";
const YEALINK_TITLE = new RegExp(
  `^Yealink(?:\\s+(${YEALINK_MODEL_TOKEN}))?(?:\\s+(?:IP Phone|Phone|Web (?:Management|Interface)))?(?:\\s*[-–|:]\\s*(?:Login|Sign In))?$`,
  "i",
);
const YEALINK_SERVER = /^Yealink(?:[ -][\w.]+){0,3}(?:\/[\d.]+)?$/i;
const YEALINK_REALM = new RegExp(
  `^Yealink(?:\\s+(${YEALINK_MODEL_TOKEN}))?$`,
  "i",
);
// Yealink's phone UI is served from /servlet?m=mod_data&p=... .
const YEALINK_ASSET = /\/servlet\?m=mod_data&(?:amp;)?p=(?:login|status)/i;
const YEALINK_UA = /(?:^|\r?\n)(?:User-Agent|Server):\s*Yealink\s+([^\r\n]*)/i;

const tidyModel = (value: string | undefined): string | undefined => {
  const model = value
    ?.replace(/^SIP[- ]?/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!model) return undefined;
  const family = model.match(/^(archer|deco)\s+(.+)$/i);
  return family
    ? `${family[1][0].toUpperCase()}${family[1].slice(1).toLowerCase()} ${family[2].toUpperCase()}`
    : model.toUpperCase();
};

/** Returns the first vendor-branded match, or undefined. */
export function identifyNetworkAppliance(
  evidence: NetworkApplianceEvidence,
): NetworkApplianceMatch | undefined {
  const title = norm(evidence.title);
  const server = norm(evidence.server);
  const realm = norm(evidence.basicRealm);
  const text = evidence.text ?? "";
  const challenged = evidence.status === 401;

  // Title evidence first, then headers, then body assets.
  if (title && OPNSENSE_TITLE.test(title)) {
    return { product: "OPNsense", signal: "OPNsense page title" };
  }
  if (title && YEALINK_TITLE.test(title)) {
    return {
      product: "Yealink",
      model: tidyModel(title.match(YEALINK_TITLE)?.[1]),
      signal: "Yealink page title",
    };
  }
  if (title && OMADA_TITLE.test(title)) {
    return { product: "TP-Link Omada", signal: "Omada controller page title" };
  }
  if (
    title &&
    (TPLINK_TITLE.test(title) ||
      TPLINK_ARCHER_TITLE.test(title) ||
      TPLINK_MODEL_TITLE.test(title) ||
      TPLINK_DECO_TITLE.test(title))
  ) {
    return {
      product: "TP-Link",
      model: tidyModel(title.match(TPLINK_MODEL)?.[1]),
      signal: "TP-Link page title",
    };
  }
  if (server && YEALINK_SERVER.test(server)) {
    return { product: "Yealink", signal: "Yealink Server header" };
  }
  if (server && TPLINK_SERVER.test(server)) {
    return { product: "TP-Link", signal: "TP-LINK Server header" };
  }
  // Realms are configurable on some firmware: only trust a 401 challenge.
  if (challenged && realm) {
    const yealink = realm.match(YEALINK_REALM);
    if (yealink) {
      return {
        product: "Yealink",
        model: tidyModel(yealink[1]),
        signal: "Yealink Basic realm",
      };
    }
    const tplink = realm.match(TPLINK_REALM);
    if (tplink && tplink[1].length > 0) {
      return {
        product: "TP-Link",
        model: tidyModel(tplink[1].match(TPLINK_MODEL)?.[1]),
        signal: "TP-LINK Basic realm",
      };
    }
  }
  const origin = norm(evidence.finalOrigin);
  if (origin && TPLINK_ORIGIN.test(origin)) {
    return { product: "TP-Link", signal: "TP-Link setup hostname redirect" };
  }
  if (text) {
    if (OPNSENSE_ASSET.test(text)) {
      return { product: "OPNsense", signal: "OPNsense UI theme asset path" };
    }
    if (YEALINK_ASSET.test(text)) {
      return { product: "Yealink", signal: "Yealink web UI servlet path" };
    }
  }
  return undefined;
}

export interface SipYealinkMatch {
  model?: string;
  firmware?: string;
}

/** `User-Agent: Yealink SIP-T46S 66.85.0.5` in a SIP response/request. */
export function identifyYealinkSip(
  banner: string | undefined,
): SipYealinkMatch | undefined {
  const text = banner ?? "";
  if (!/^(?:SIP\/2\.0\s+\d{3}\b|[A-Z]+\s+\S+\s+SIP\/2\.0)/.test(text.trim())) {
    return undefined;
  }
  const ua = text.match(YEALINK_UA)?.[1]?.trim();
  if (ua === undefined) return undefined;
  const parts = ua.match(
    new RegExp(
      `^(${YEALINK_MODEL_TOKEN})(?:\\s+(\\d+(?:\\.\\d+){1,4}))?$`,
      "i",
    ),
  );
  return { model: tidyModel(parts?.[1]), firmware: parts?.[2] };
}
