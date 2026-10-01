import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const ADOBE_ADMIN_CONSOLE_URL = "https://adminconsole.adobe.com/";

export const ADOBE_ADMIN_CONSOLE_PROFILE: HttpApplicationProfile = {
  id: "adobe-admin-console",
  label: "Adobe Admin Console",
  category: "business",
  capability: "known-form",
  hostedLoginUrl: ADOBE_ADMIN_CONSOLE_URL,
  requiresHttps: true,
  loginModes: ["manual", "form"],
  loginFlow: "adobe",
  usernameLabel: "Email",
  description:
    "Optional staged email and password sign-in for Adobe Admin Console using saved or vault credentials. SSO, MFA, CAPTCHA and account/profile choice remain interactive; automatic completion is not guaranteed. Separate from Adobe Account and Creative Cloud desktop applications.",
};
