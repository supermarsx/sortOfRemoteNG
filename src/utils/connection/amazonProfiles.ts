import type { HttpApplicationProfile } from "./httpApplicationProfiles";
import { parseCanonicalWebAuthority } from "./sanitizeHostname";

/**
 * Retail storefronts, not shipping destinations, AWS regions or Seller Central.
 * Reviewed 2026-10-06 against Amazon's current marketplace list:
 * https://developer-docs.amazon.com/sp-api/docs/marketplace-ids
 * Domain cross-checks:
 * https://developer-docs.amazon.com/sp-api/docs/seller-central-urls
 * https://sellercentral.amazon.ie/welcome/sell-across-europe
 * https://www.aboutamazon.eu/news/retail/amazon-launches-amazon-ie-in-ireland
 * https://www.aboutamazon.com/news/retail/amazon-south-africa
 * https://www.aboutamazon.sg/news/company-news/amazon-singapore-to-expand-international-store-selection-in-response-to-customer-demand
 *
 * Do not infer storefronts from country-code TLDs. In particular, shipping to
 * Portugal, Austria, Switzerland or another country does not establish a local
 * retail storefront. The US store also serves international shoppers.
 */
export const AMAZON_SHOPPING_MARKETS = [
  {
    code: "GB",
    country: "United Kingdom",
    region: "Europe",
    hostname: "www.amazon.co.uk",
  },
  {
    code: "IE",
    country: "Ireland",
    region: "Europe",
    hostname: "www.amazon.ie",
  },
  {
    code: "DE",
    country: "Germany",
    region: "Europe",
    hostname: "www.amazon.de",
  },
  {
    code: "FR",
    country: "France",
    region: "Europe",
    hostname: "www.amazon.fr",
  },
  { code: "IT", country: "Italy", region: "Europe", hostname: "www.amazon.it" },
  { code: "ES", country: "Spain", region: "Europe", hostname: "www.amazon.es" },
  {
    code: "NL",
    country: "Netherlands",
    region: "Europe",
    hostname: "www.amazon.nl",
  },
  {
    code: "BE",
    country: "Belgium",
    region: "Europe",
    hostname: "www.amazon.com.be",
  },
  {
    code: "SE",
    country: "Sweden",
    region: "Europe",
    hostname: "www.amazon.se",
  },
  {
    code: "PL",
    country: "Poland",
    region: "Europe",
    hostname: "www.amazon.pl",
  },
  {
    code: "TR",
    country: "Türkiye",
    region: "Europe",
    hostname: "www.amazon.com.tr",
  },
  {
    code: "US",
    country: "United States / International",
    region: "Americas",
    hostname: "www.amazon.com",
  },
  {
    code: "CA",
    country: "Canada",
    region: "Americas",
    hostname: "www.amazon.ca",
  },
  {
    code: "MX",
    country: "Mexico",
    region: "Americas",
    hostname: "www.amazon.com.mx",
  },
  {
    code: "BR",
    country: "Brazil",
    region: "Americas",
    hostname: "www.amazon.com.br",
  },
  {
    code: "JP",
    country: "Japan",
    region: "Asia-Pacific",
    hostname: "www.amazon.co.jp",
  },
  {
    code: "IN",
    country: "India",
    region: "Asia-Pacific",
    hostname: "www.amazon.in",
  },
  {
    code: "AU",
    country: "Australia",
    region: "Asia-Pacific",
    hostname: "www.amazon.com.au",
  },
  {
    code: "SG",
    country: "Singapore",
    region: "Asia-Pacific",
    hostname: "www.amazon.sg",
  },
  {
    code: "AE",
    country: "United Arab Emirates",
    region: "Middle East and Africa",
    hostname: "www.amazon.ae",
  },
  {
    code: "SA",
    country: "Saudi Arabia",
    region: "Middle East and Africa",
    hostname: "www.amazon.sa",
  },
  {
    code: "EG",
    country: "Egypt",
    region: "Middle East and Africa",
    hostname: "www.amazon.eg",
  },
  {
    code: "ZA",
    country: "South Africa",
    region: "Middle East and Africa",
    hostname: "www.amazon.co.za",
  },
] as const;

export type AmazonShoppingMarketCode =
  (typeof AMAZON_SHOPPING_MARKETS)[number]["code"];

/**
 * Public storefront entry points deliberately let the website generate its own
 * current sign-in link, OpenID parameters and return destination. Naked
 * /ap/signin probes did not yield reviewable retail forms. Do not invent a
 * universal selector set or reuse a seller/carrier/Pay login DOM for shopping.
 * Manual-only profiles never resolve saved passwords, API credentials or TOTP.
 */
export function getAmazonShoppingMarket(code: unknown) {
  return AMAZON_SHOPPING_MARKETS.find((market) => market.code === code);
}

/** Only reviewed retail authorities; not arbitrary subdomains or lookalikes. */
export function detectAmazonShoppingMarket(address: string) {
  try {
    const authority = parseCanonicalWebAuthority(address);
    if (authority.port !== undefined && authority.port !== 443)
      return undefined;
    return AMAZON_SHOPPING_MARKETS.find(
      (market) =>
        authority.hostname === market.hostname ||
        authority.hostname === market.hostname.replace(/^www\./, ""),
    );
  } catch {
    return undefined;
  }
}

/** Import compatibility: old regional entries are no longer separate choices. */
export function getLegacyAmazonShoppingMarket(id: string) {
  return AMAZON_SHOPPING_MARKETS.find(
    (market) => id === `amazon-shopping-${market.code.toLowerCase()}`,
  );
}

export const AMAZON_SHOPPING_PROFILES: readonly HttpApplicationProfile[] = [
  {
    id: "amazon-shopping",
    label: "Amazon Shopping",
    category: "business",
    capability: "manual",
    requiresHttps: true,
    hostedLoginUrl: "https://www.amazon.com/",
    loginPath: "/",
    loginModes: ["manual"],
    description:
      "The marketplace is detected from the saved URL, or selected in the marketplace dropdown. Open the store's own Sign in / Account link and sign in interactively. " +
      "Saved passwords, API keys and automatic 2FA are not supplied. Shopping accounts are distinct from AWS console, IAM and Seller Central credentials; this preset never forwards credentials to another regional store. MFA, CAPTCHA, passkeys, account recovery and verification stay interactive. " +
      "Only this exact HTTPS storefront is selected; redirects and additional resource origins remain subject to this connection's existing proxy policy. This does not claim successful embedded sign-in or automatic login.",
  },
];
