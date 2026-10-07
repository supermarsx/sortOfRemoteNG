import type { HttpApplicationProfile } from "./httpApplicationProfiles";

const manualSignIn =
  "Manual sign-in only; saved credentials, API keys and automatic 2FA are not supplied. Complete identity-provider redirects, verification, passkeys and CAPTCHA interactively. Successful account sign-in has not been live-verified.";

const hosted = (
  id: string,
  label: string,
  category: HttpApplicationProfile["category"],
  hostedLoginUrl: string,
  detail: string,
): HttpApplicationProfile => ({
  id,
  label,
  category,
  capability: "manual",
  requiresHttps: true,
  loginModes: ["manual"],
  hostedLoginUrl,
  description: `${detail} ${manualSignIn}`,
});

/**
 * Public entry points reviewed 2026-10-06; full evidence and limits:
 * docs/international-portal-profiles.md.
 *
 * Metadata only: no requests, form selectors, credential resolution, redirect
 * grants, script permissions or proxy overrides. Registry integration is owned
 * by the main catalog. The type-only import avoids a runtime catalog cycle.
 */
export const INTERNATIONAL_PORTAL_PROFILES: readonly HttpApplicationProfile[] =
  [
    // https://support.apple.com/en-us/111001
    hosted(
      "apple-account",
      "Apple Account (Apple ID)",
      "custom",
      "https://account.apple.com/",
      "Apple Account identity and security management, formerly Apple ID. The existing iCloud preset opens a separate website for iCloud data.",
    ),
    // https://developer.apple.com/help/account/access/roles/
    // https://developer.apple.com/account/
    hosted(
      "apple-developer",
      "Apple Developer account",
      "business",
      "https://developer.apple.com/account/",
      "Apple Developer membership and development resources. Access depends on the selected Apple Account, team and role; certificates and App Store Connect API keys are not website passwords.",
    ),
    // https://www.register.com/my-account/login redirects to this canonical URL.
    // https://www.networksolutions.com/blog/registerdotcom-becomes-network-solutions/
    hosted(
      "register-com",
      "register.com (Network Solutions)",
      "networking",
      "https://www.networksolutions.com/my-account/login",
      "Register.com domain and hosting customers now use the Network Solutions Account Manager. This explicit legacy-brand entry shares the existing Network Solutions destination; it is not a separate registrar login service.",
    ),
    // https://www.noip.com/login
    hosted(
      "no-ip",
      "No-IP account",
      "networking",
      "https://www.noip.com/login",
      "No-IP account for Dynamic DNS and domain services. Configure hostnames after signing in; a DDNS update key is not a website account password.",
    ),
    // https://support.microsoft.com/en-us/accounts-billing/manage/how-to-sign-in-to-a-microsoft-account
    hosted(
      "microsoft-account",
      "Microsoft personal account",
      "custom",
      "https://account.microsoft.com/",
      "Personal Microsoft account management. Work or school accounts use their organization's sign-in flow; the existing Outlook Online preset serves Microsoft 365 mail.",
    ),
    // https://developer.microsoft.com/en-us/
    hosted(
      "microsoft-developer",
      "Microsoft Developer portal",
      "business",
      "https://developer.microsoft.com/en-us/",
      "Microsoft's public developer hub for tools, documentation and developer programs. Choose the required program there; this general entry does not select a Partner Center, Azure or Microsoft 365 developer tenant.",
    ),
    // https://support.hpe.com/connect/login
    hosted(
      "hpe-support",
      "HPE Support Center",
      "management",
      "https://support.hpe.com/connect/login",
      "HPE customer support portal with account and support-entitlement checks. This is separate from HPE GreenLake cloud management and a server's iLO or Redfish credentials.",
    ),
    // https://www.notion.com/help/notion-for-web
    // https://www.notion.com/login redirects to https://app.notion.com/login.
    hosted(
      "notion",
      "Notion",
      "business",
      "https://app.notion.com/login",
      "Notion workspace sign-in. Email verification, password, passkeys and organization SSO depend on the account and workspace; integration tokens are not browser sessions.",
    ),
    // https://zulip.com/help/logging-in documents organization URLs and /login/.
    {
      id: "zulip",
      label: "Zulip (organization / self-hosted)",
      category: "business",
      capability: "manual",
      requiresHttps: true,
      loginModes: ["manual"],
      loginPath: "/login/",
      description:
        "Configure your exact Zulip organization hostname and HTTPS port, supplied by its administrator or invitation. Opens /login/ on that saved host. Cloud tenants and self-hosted organizations choose their own authentication methods; there is no central account login preset. " +
        manualSignIn,
    },
    // https://kb.arlo.com/000063143/
    // https://kb.arlo.com/000062596/How-to-add-a-trusted-browser-to-your-Arlo-account
    hosted(
      "arlo",
      "Arlo Secure web portal",
      "monitoring",
      "https://my.arlo.com/",
      "Arlo camera and account web portal. Account verification and trusted-browser approval remain interactive; this preset does not establish camera streaming or device-control compatibility.",
    ),
    // https://github.com/louislam/uptime-kuma/blob/master/src/router.js
    // https://github.com/louislam/uptime-kuma/wiki/Reverse-Proxy
    {
      id: "uptime-kuma",
      label: "Uptime Kuma (self-hosted)",
      category: "monitoring",
      capability: "manual",
      requiresHttps: true,
      loginModes: ["manual"],
      loginPath: "/dashboard",
      description:
        "Configure your own Uptime Kuma HTTPS hostname and port. Opens the /dashboard management route, not a public status page or demo. Use a dedicated host with WebSocket support at its reverse proxy; this preset does not verify a deployment's authentication or monitoring runtime. " +
        manualSignIn,
    },
    // https://help.steampowered.com/en/faqs/view/1DED-79C6-0568-A72C
    // https://store.steampowered.com/login/
    hosted(
      "steam",
      "Steam account",
      "custom",
      "https://store.steampowered.com/login/",
      "Steam store website sign-in. Steam Guard and other account challenges remain interactive; website access does not launch the Steam client or authenticate a game server.",
    ),
    // https://www.autodesk.com/support/account/manage/use/explore/
    // https://manage.autodesk.com/
    hosted(
      "autodesk",
      "Autodesk Account",
      "business",
      "https://manage.autodesk.com/",
      "Autodesk account portal for products, downloads and subscription administration. Organization SSO and sign-in confirmation follow the account's policy; product licensing and API credentials are separate.",
    ),
    // https://www.kimi.com/
    hosted(
      "kimi",
      "Kimi",
      "business",
      "https://www.kimi.com/",
      "Kimi's public chat and agent workspace, with sign-in offered inside the application. This entry does not configure Kimi Code or the separate developer API platform.",
    ),
    // https://lovable.dev/login
    // https://docs.lovable.dev/introduction/getting-started
    hosted(
      "lovable",
      "Lovable",
      "business",
      "https://lovable.dev/login",
      "Lovable account and project workspace. Authentication providers and workspace membership remain interactive; this preset does not authorize integrations, build a project or publish a website.",
    ),
    // https://docs.npmjs.com/configuring-two-factor-authentication/
    hosted(
      "npm",
      "npm package registry",
      "business",
      "https://www.npmjs.com/login",
      "npm public package-registry account, distinct from Nginx Proxy Manager. Publishing tokens and npm CLI authentication are not website credentials; security-key and recovery challenges remain interactive.",
    ),
    // https://pypi.org/account/login/
    hosted(
      "pypi",
      "PyPI",
      "business",
      "https://pypi.org/account/login/",
      "Python Package Index account and package management. Upload tokens and trusted-publishing identities are separate from browser sign-in; account verification remains interactive.",
    ),
    // https://www.reddit.com/login/
    // https://support.reddithelp.com/hc/en-us/articles/28620245447572-How-do-I-log-in-and-out-of-my-Reddit-account
    hosted(
      "reddit",
      "Reddit",
      "custom",
      "https://www.reddit.com/login/",
      "Reddit community account sign-in. Email or username, one-time links, phone and linked identity providers can follow different flows; OAuth API tokens are not browser sessions.",
    ),
    // https://www.tesla.com/teslaaccount
    // https://www.tesla.com/support/tesla-account-security
    hosted(
      "tesla",
      "Tesla Account",
      "custom",
      "https://www.tesla.com/teslaaccount",
      "Tesla owner account entry, which redirects to Tesla authentication. Device verification stays interactive; this preset does not grant Fleet API access or operate vehicles and energy products.",
    ),
    // https://www.ebay.com/help/account/signing-account/signing-account?id=4189
    // https://signin.ebay.com/ redirects to https://signin.ebay.com/signin/.
    hosted(
      "ebay",
      "eBay account",
      "custom",
      "https://signin.ebay.com/signin/",
      "eBay.com buying and selling account sign-in. Linked providers, passkeys and verification remain interactive; regional marketplace redirects require normal review and no purchases or listings are performed.",
    ),
    // https://help.x.com/en/using-x/create-x-account-mobile
    hosted(
      "x",
      "X (Twitter)",
      "custom",
      "https://x.com/login",
      "X social account sign-in, formerly Twitter. Account-access challenges remain interactive; developer API credentials are not supplied to the website.",
    ),
    // https://documentation.wazuh.com/current/quickstart.html
    // https://documentation.wazuh.com/current/installation-guide/wazuh-dashboard/step-by-step.html
    {
      id: "wazuh",
      label: "Wazuh dashboard (self-hosted)",
      category: "monitoring",
      capability: "manual",
      requiresHttps: true,
      loginModes: ["manual"],
      loginPath: "/",
      description:
        "Configure your own Wazuh dashboard HTTPS hostname and port. The documented web entry is the dashboard host root; use your administrator's full URL for a customized deployment. Dashboard sign-in is separate from Wazuh server API access and agent enrollment; certificate trust and SSO remain subject to existing review. " +
        manualSignIn,
    },
    // https://www.zabbix.com/documentation/current/en/manual/quickstart/login
    // The documented Apache /zabbix and Nginx / entries differ. Leave the path
    // unset so normal embedded navigation preserves the user's full saved URL.
    {
      id: "zabbix",
      label: "Zabbix frontend (self-hosted)",
      category: "monitoring",
      capability: "manual",
      requiresHttps: true,
      loginModes: ["manual"],
      description:
        "Configure your own Zabbix HTTPS hostname, port and complete frontend URL. Official installations use /zabbix for Apache or / for Nginx; save the actual deployment path instead of assuming a universal login route. Internal, LDAP, HTTP or SAML authentication is deployment-specific; API tokens are not website credentials. " +
        manualSignIn,
    },
  ];
