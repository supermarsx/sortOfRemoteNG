import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const WINDMILL_LOGIN_URL = "https://app.windmill.dev/user/login";

const passwordHelp =
  'Use your website email and password, not an API token. Automatic login can open the website’s "Log in without third-party" password pane. SSO, MFA, approval, initial setup and password reset remain interactive.';

export const WINDMILL_PROFILES: readonly HttpApplicationProfile[] = [
  {
    id: "windmill",
    label: "Windmill",
    category: "business",
    capability: "manual",
    hostedLoginUrl: WINDMILL_LOGIN_URL,
    requiresHttps: true,
    usernameLabel: "Email",
    description: `Developer automation and workflows at app.windmill.dev. Password access must be enabled for your Windmill Cloud account. ${passwordHelp}`,
  },
  {
    id: "windmill-self-hosted",
    label: "Windmill (self-hosted)",
    category: "business",
    capability: "manual",
    loginPath: "/user/login",
    requiresHttps: true,
    usernameLabel: "Email",
    description: `Connect to your own Windmill instance using its website URL, hostname or IP address and configured port. ${passwordHelp}`,
  },
];
