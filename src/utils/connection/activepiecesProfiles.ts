import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const ACTIVEPIECES_PROFILES: readonly HttpApplicationProfile[] = [
  {
    id: "activepieces",
    label: "Activepieces Cloud",
    category: "business",
    capability: "manual",
    hostedLoginUrl: "https://cloud.activepieces.com/sign-in",
    requiresHttps: true,
    usernameLabel: "Email",
    description:
      "Activepieces Cloud workflow automation. Use your website email and password, not an API key. If email-code login appears, choose Use password on the website before automatic login. SSO, verification codes and account approval remain interactive.",
  },
  {
    id: "activepieces-self-hosted",
    label: "Activepieces (self-hosted)",
    category: "business",
    capability: "manual",
    loginPath: "/sign-in",
    usernameLabel: "Email",
    description:
      "Your Activepieces website URL, hostname or IP address and port. The single-container example uses HTTP port 8080; enter your deployment's actual port. Use your website email and password. First-account setup, email codes, SSO and approval remain interactive; password login must be enabled by your administrator.",
  },
];
