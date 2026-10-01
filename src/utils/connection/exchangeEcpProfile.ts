import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/** ECP uses Exchange's OWA forms-authentication page, not Exchange Online. */
export const EXCHANGE_ECP_LOGIN_SELECTORS = {
  usernameSelector: 'form[name="logonForm"] input#username[name="username"]',
  passwordSelector:
    'form[name="logonForm"] input#password[name="password"][type="password"]',
  submitSelector: 'form[name="logonForm"] .signinbutton[role="button"]',
} as const;

export const EXCHANGE_ECP_PROFILE: HttpApplicationProfile = {
  id: "exchange-ecp",
  label: "Exchange Admin Center / ECP",
  category: "mailStorage",
  capability: "known-form",
  requiresHttps: true,
  loginModes: ["manual", "form"],
  loginPath: "/ecp/",
  usernameLabel: "Domain\\username, UPN, or username",
  selectors: EXCHANGE_ECP_LOGIN_SELECTORS,
  description:
    "Optional on-premises Exchange ECP forms-based login. Opens /ecp/, waits for the OWA sign-in form, and uses its own Sign in handler once. Enter the exact account format required by your server: DOMAIN\\username, user@example.com, or username. Saved or vault credentials are supported; the ECP return destination and session cookies stay on the configured proxy path. Windows-integrated authentication, ADFS, MFA, password changes and customized forms remain interactive. This is not the Exchange Online admin portal.",
};
