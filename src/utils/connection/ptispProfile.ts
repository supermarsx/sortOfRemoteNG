import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const PTISP_LOGIN_URL = "https://my.ptisp.pt/login";

/**
 * Public login chunk 40.3795390781c5148c36d7.js reviewed 2026-09-30.
 * Vue renders the password form inside this card; the six-digit verification
 * step replaces it entirely. Click the site's submit control so v-model,
 * validation and the site's API/session handling remain in charge.
 */
export const PTISP_LOGIN_SELECTORS = {
  usernameSelector:
    '.login-form-page #classic-card form input[type="email"][autocomplete="email"]',
  passwordSelector:
    '.login-form-page #classic-card form input[type="password"][autocomplete="password"]',
  submitSelector: '.login-form-page #classic-card form button[type="submit"]',
} as const;

export const PTISP_PROFILE: HttpApplicationProfile = {
  id: "ptisp",
  label: "PTisp customer area",
  category: "management",
  capability: "known-form",
  loginModes: ["manual", "form"],
  usernameLabel: "Customer email",
  requiresHttps: true,
  hostedLoginUrl: PTISP_LOGIN_URL,
  loginPath: "/login",
  selectors: PTISP_LOGIN_SELECTORS,
  description:
    "myPTisp hosting and billing customer email/password login, not a hosted server's account or API key. Automatic login requires explicit opt-in and submits the reviewed form once through the application proxy, including the exact first-party API at https://api3.ptisp.pt. Two-factor codes, CAPTCHA, recovery and other verification remain interactive; Remember me is left unchanged. Live authenticated login has not been verified.",
};
