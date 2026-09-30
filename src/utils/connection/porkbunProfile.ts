import type {
  HttpApplicationProfile,
  HttpApplicationTotpChallenge,
} from "./httpApplicationProfiles";

export const PORKBUN_LOGIN_URL = "https://porkbun.com/account/login";

/**
 * Public, unauthenticated HTML and /js/skaboink.js reviewed 2026-09-30.
 * The Login button is outside loginForm and calls logInExec()/logIn().
 * The form's /blank iframe target is NOT the site's AJAX login endpoint.
 * Preserve the site's CAPTCHA and AJAX handlers; never submit this form directly.
 */
export const PORKBUN_LOGIN_SELECTORS = {
  usernameSelector:
    'form#loginForm input#loginUsername[name="loginUsername"][autocomplete="username"]',
  passwordSelector:
    'form#loginForm input#loginPassword[name="loginPassword"][type="password"]',
  submitSelector: "#accountLoginButtonContainer button#accountLoginButton",
} as const;

/** The public page distinguishes app codes from email, SMS and recovery fields. */
export const PORKBUN_TOTP_CHALLENGE: HttpApplicationTotpChallenge = {
  id: "porkbun-totp",
  label: "Porkbun authenticator app",
  codeSelector:
    'form#loginForm #twoFactorLoginContainer input#twoFactorLoginCode[autocomplete="one-time-code"]',
  submitSelector: PORKBUN_LOGIN_SELECTORS.submitSelector,
  paths: ["/account/login"],
  origins: ["https://porkbun.com"],
  submission: "porkbun",
};

export const PORKBUN_PROFILE: HttpApplicationProfile = {
  id: "porkbun",
  label: "Porkbun",
  category: "networking",
  capability: "known-form",
  loginModes: ["manual", "form"],
  usernameLabel: "Username or email",
  requiresHttps: true,
  hostedLoginUrl: PORKBUN_LOGIN_URL,
  loginPath: "/account/login",
  selectors: PORKBUN_LOGIN_SELECTORS,
  totpChallenges: [PORKBUN_TOTP_CHALLENGE],
  description:
    "Reviewed Porkbun registrar username/email and password controls at https://porkbun.com/account/login. Automatic login requires explicit opt-in and the portal's Login button to become ready. Automatic 2FA targets only the authenticator-app challenge when separately enabled. CAPTCHA, email/SMS verification, device approval, recovery, security keys and passwordless login remain interactive. API keys and email-hosting passwords are separate. Live authenticated login has not been verified.",
};
