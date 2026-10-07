import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";
export const LINKEDIN_LOGIN_SELECTORS = {
  usernameSelector:
    'input#username[name="session_key"], input[type="email"][autocomplete="username"]',
  passwordSelector:
    'input#password[name="session_password"][type="password"], input[type="password"][autocomplete="current-password"]',
  submitSelector:
    'button[type="submit"][data-litms-control-urn="login-submit"], button[type="button"]',
} as const;

export const LINKEDIN_PROFILE: HttpApplicationProfile = {
  id: "linkedin",
  label: "LinkedIn",
  category: "business",
  capability: "known-form",
  hostedLoginUrl: LINKEDIN_LOGIN_URL,
  requiresHttps: true,
  usernameLabel: "Email or phone",
  loginModes: ["manual", "form"],
  selectors: LINKEDIN_LOGIN_SELECTORS,
  description:
    "Optional saved or vault credentials with one submission on the exact LinkedIn HTTPS login page. Recognizes the traditional password form and the reviewed English/Portuguese form-less controls. Unknown layouts, MFA, CAPTCHA, passkeys, SSO and account recovery remain interactive. Public markup was inspected; successful account login has not been live-verified.",
};
