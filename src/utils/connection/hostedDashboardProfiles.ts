import type { HttpApplicationProfile } from "./httpApplicationProfiles";

const interactive =
  "Interactive sign-in only; saved credentials, API keys and automatic 2FA are not supplied. Use Open original sign-in for SSO, passkeys, security keys, CAPTCHA or unsupported embedded-browser sign-in. The system browser has separate cookies and uses the operating system network route.";
const hosted = (
  id: string,
  label: string,
  hostedLoginUrl: string,
  category: HttpApplicationProfile["category"],
  detail: string,
): HttpApplicationProfile => ({
  id,
  label,
  category,
  capability: "manual",
  requiresHttps: true,
  loginModes: ["manual"],
  hostedLoginUrl,
  description: `${detail} ${interactive}`,
});

/** Public entry points only, never credentials, redirect parameters or API endpoints.
 * Primary evidence and reviewed source revisions: docs/hosted-dashboard-profiles.md.
 * Selection remains manual and never launches a browser or changes a saved host. */
export const HOSTED_DASHBOARD_PROFILES: readonly HttpApplicationProfile[] = [
  hosted(
    "namecheap",
    "Namecheap",
    "https://www.namecheap.com/myaccount/login/",
    "networking",
    "Domain registrar account dashboard, not a hosted website's control-panel account.",
  ),
  hosted(
    "network-solutions",
    "Network Solutions",
    "https://www.networksolutions.com/my-account/login",
    "networking",
    "Account Manager for domains, hosting and billing. Verification and recovery challenges stay on the website.",
  ),
  hosted(
    "time4vps",
    "Time4VPS dashboard",
    "https://billing.time4vps.com/",
    "management",
    "Billing and VPS customer area, not a VPS operating-system login.",
  ),
  hosted(
    "contabo",
    "Contabo customer panel",
    "https://my.contabo.com/account/login",
    "management",
    "Original Contabo Customer Panel. The separate new.contabo.com interface uses different credentials; this preset does not transfer or rebind them.",
  ),
  hosted(
    "chatgpt",
    "ChatGPT",
    "https://chatgpt.com/",
    "business",
    "ChatGPT website account. An OpenAI API key is not a ChatGPT browser login.",
  ),
  hosted(
    "claude",
    "Claude",
    "https://claude.ai/",
    "business",
    "Claude website with Google or email-link sign-in; no dedicated Claude password is assumed. An Anthropic API key is not a website login.",
  ),
  hosted(
    "openrouter",
    "OpenRouter",
    "https://openrouter.ai/sign-in",
    "business",
    "OpenRouter website account. Model API keys are not website passwords.",
  ),
  hosted(
    "gitlab-com",
    "GitLab.com",
    "https://gitlab.com/users/sign_in",
    "business",
    "Hosted GitLab sign-in can use staged account routing, SSO and challenges. Use the separate self-hosted preset for a reviewed local password form.",
  ),
  {
    id: "gitlab-self-hosted",
    label: "GitLab (self-hosted)",
    category: "business",
    capability: "known-form",
    requiresHttps: true,
    loginModes: ["manual", "form"],
    loginPath: "/users/sign_in",
    usernameLabel: "Username or primary email",
    selectors: {
      usernameSelector:
        'form#sign-in-form input[name="user[login]"][autocomplete="username"]',
      passwordSelector:
        'form#sign-in-form input[name="user[password]"][type="password"]',
      submitSelector:
        'form#sign-in-form button[data-testid="sign-in-button"][type="submit"]',
    },
    description:
      "Reviewed current GitLab local account form only when username and password are visible together in the same POST form. Two-step username routing, LDAP tabs, SSO, CAPTCHA and MFA remain interactive. Personal access tokens are not website passwords; use the original site for passkeys/security keys. Custom and older forms may need manual sign-in.",
  },
  hosted(
    "google-account",
    "Google Account",
    "https://myaccount.google.com/",
    "business",
    "Google account and security dashboard. Google can reject embedded browsers; use the system browser for sign-in.",
  ),
  hosted(
    "google-cloud-console",
    "Google Cloud Console",
    "https://console.cloud.google.com/",
    "management",
    "Google Cloud website console, not service-account or API-key authentication. Google sign-in redirects to its account origin.",
  ),
  hosted(
    "google-analytics",
    "Google Analytics",
    "https://analytics.google.com/analytics/web/",
    "monitoring",
    "Analytics website dashboard through Google Account sign-in; no Analytics API setup is performed.",
  ),
  hosted(
    "google-business-profile",
    "Google Business Profile",
    "https://business.google.com/locations",
    "business",
    "Business Profile locations dashboard through Google Account sign-in.",
  ),
  hosted(
    "google-search-console",
    "Google Search Console",
    "https://search.google.com/search-console/",
    "monitoring",
    "Search Console website dashboard through Google Account sign-in; this does not verify a property or create API access.",
  ),
  hosted(
    "google-ads",
    "Google Ads",
    "https://ads.google.com/aw/overview",
    "business",
    "Advertising website dashboard through Google Account sign-in; no advertising API credentials are supplied.",
  ),
  hosted(
    "facebook",
    "Facebook",
    "https://www.facebook.com/login/",
    "business",
    "Facebook account sign-in; account verification and Meta security checkpoints remain interactive.",
  ),
  hosted(
    "instagram",
    "Instagram",
    "https://www.instagram.com/accounts/login/",
    "business",
    "Instagram account sign-in; linked-account, verification and security checkpoints remain interactive.",
  ),
  hosted(
    "hpe-greenlake",
    "HPE GreenLake dashboard",
    "https://common.cloud.hpe.com/",
    "management",
    "HPE GreenLake cloud account dashboard. This is separate from an individual server's iLO account or Redfish credentials.",
  ),
  hosted(
    "adobe",
    "Adobe Account",
    "https://account.adobe.com/",
    "business",
    "Adobe account, subscriptions and identity-provider sign-in. This does not launch Creative Cloud desktop applications.",
  ),
  hosted(
    "youtube",
    "YouTube",
    "https://www.youtube.com/",
    "business",
    "YouTube website with Google Account sign-in; Google can reject embedded browsers.",
  ),
  hosted(
    "zoom",
    "Zoom web portal",
    "https://zoom.us/signin",
    "business",
    "Zoom web account portal, not native meeting-client embedding. Organization SSO and verification stay interactive.",
  ),
  hosted(
    "icloud",
    "iCloud",
    "https://www.icloud.com/",
    "mailStorage",
    "iCloud website with Apple Account sign-in and device verification. App-specific passwords are not iCloud website passwords.",
  ),
  hosted(
    "ovhcloud",
    "OVHcloud Control Panel (EU)",
    "https://manager.eu.ovhcloud.com/",
    "management",
    "European OVHcloud Control Panel. Other regional control-panel origins require their own connection; no silent regional credential forwarding.",
  ),
  hosted(
    "ptisp",
    "PTisp customer area",
    "https://my.ptisp.pt/",
    "management",
    "myPTisp customer account, hosting and billing area; not a hosted server's account.",
  ),
  hosted(
    "marcaria",
    "Marcaria",
    "https://www.marcaria.com/register/user/login.asp",
    "networking",
    "Marcaria domain and trademark account. Website protection and verification challenges remain interactive.",
  ),
  hosted(
    "freedns",
    "FreeDNS (afraid.org)",
    "https://freedns.afraid.org/",
    "networking",
    "FreeDNS member dashboard. Dynamic-DNS update URLs/tokens are not account login credentials.",
  ),
  hosted(
    "registro-br",
    "Registro.br",
    "https://registro.br/login/",
    "networking",
    "Registro.br domain account dashboard. Website verification and MFA remain interactive.",
  ),
  {
    id: "sqlpad",
    label: "SQLPad",
    category: "business",
    capability: "known-form",
    requiresHttps: true,
    loginModes: ["manual", "form"],
    loginPath: "/signin",
    usernameLabel: "Email or LDAP username",
    selectors: {
      usernameSelector:
        'form:has(input[name="password"][type="password"]) input[name="email"][type="email"]',
      passwordSelector:
        'form:has(input[name="email"][type="email"]) input[name="password"][type="password"]',
      submitSelector:
        'form:has(input[name="email"][type="email"]):has(input[name="password"][type="password"]) button[type="submit"]',
    },
    description:
      "Reviewed SQLPad local/LDAP account form; Google, SAML, OIDC and upstream authentication remain interactive. Use the SQLPad website account, not a database connection password. The upstream SQLPad project is archived; custom deployments and subdirectory paths need review. No SQL query is executed by sign-in.",
  },
  {
    id: "eaton-ups",
    label: "Eaton UPS web administration",
    category: "management",
    capability: "manual",
    requiresHttps: true,
    loginModes: ["manual"],
    loginPath: "/",
    description:
      "Interactive Network-M2/M3 web administration at your UPS network-card address. Firmware and local/LDAP/RADIUS configurations differ; no universal login selectors or MFA support are assumed. Trust the correct device certificate; no default credentials or TLS bypass are supplied.",
  },
  hosted(
    "gmail",
    "Gmail",
    "https://mail.google.com/",
    "mailStorage",
    "Gmail website through Google Account sign-in. IMAP app passwords and mail API tokens are not website credentials.",
  ),
  hosted(
    "outlook-online",
    "Outlook Online (Microsoft 365)",
    "https://outlook.office.com/mail/",
    "mailStorage",
    "Microsoft 365 work/school web mail with Microsoft Entra sign-in, tenant policy and interactive MFA. This is not on-premises Exchange OWA.",
  ),
  {
    id: "exchange-owa",
    label: "Exchange Outlook on the web (on-premises)",
    category: "mailStorage",
    capability: "manual",
    requiresHttps: true,
    loginModes: ["manual"],
    loginPath: "/owa/",
    description:
      "On-premises Exchange OWA at your organization's HTTPS mail host. Forms, Windows authentication, federation and MFA depend on deployment; no universal selectors, delegated Windows identity or Exchange API-session handoff is assumed. Use the original site/system browser for organization sign-in requirements.",
  },
  ...(
    [
      ["ddwrt", "DD-WRT"],
      ["freshtomato", "FreshTomato"],
    ] as const
  ).map(([id, label]): HttpApplicationProfile => ({
    id,
    label,
    category: "networking",
    capability: "http-auth",
    loginModes: ["manual", "basic"],
    loginPath: "/",
    description: `${label} router web interface with source-reviewed HTTP Basic authentication, not a password form. Select Basic explicitly to use this connection's router credentials at its saved origin. Prefer HTTPS with a trusted device certificate; Basic over plain HTTP exposes credentials. No first-run password change, firmware modification or MFA bypass is automated.`,
  })),
];
