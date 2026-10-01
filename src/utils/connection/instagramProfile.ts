import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const INSTAGRAM_LOGIN_URL = "https://www.instagram.com/accounts/login/";
export const INSTAGRAM_LOGIN_SELECTORS = {
  usernameSelector: 'form input[name="username"]',
  passwordSelector: 'form input[name="password"][type="password"]',
  submitSelector: 'form button[type="submit"]',
} as const;

export const INSTAGRAM_PROFILE: HttpApplicationProfile = {
  id: "instagram",
  label: "Instagram",
  category: "business",
  capability: "known-form",
  hostedLoginUrl: INSTAGRAM_LOGIN_URL,
  requiresHttps: true,
  loginModes: ["manual", "form"],
  selectors: INSTAGRAM_LOGIN_SELECTORS,
  description:
    "Optional saved or vault username/password autofill and one login submission using a strict fixture-tested form adapter. Live hydrated Instagram login markup has not been verified. Checkpoints, 2FA, recovery, CAPTCHA and linked-account sign-in remain interactive unless independently reviewed; automatic completion is not guaranteed.",
};
