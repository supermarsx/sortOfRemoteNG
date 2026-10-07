import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/**
 * Reviewed OPNsense WebGUI form (also present in stable/26.7), 2026-10-06:
 * https://github.com/opnsense/core/blob/be43690f7abaf6823a93d6e4f292095bc4e5d56c/src/www/authgui.inc
 * https://github.com/opnsense/core/blob/be43690f7abaf6823a93d6e4f292095bc4e5d56c/src/www/csrf.inc
 *
 * Unlike pfSense's input submitter, OPNsense uses a button carrying login=1.
 * Click the actual POST submitter so the site's dynamically named CSRF input,
 * cookies and native form handlers are retained; never fabricate a login POST.
 * This is the firewall WebGUI, not its captive portal or API authentication.
 */
const loginForm =
  'body.page-login .login-modal-content form#iform[name="iform"][method="post" i]:not([target])';

export const OPNSENSE_LOGIN_SELECTORS = {
  usernameSelector: `${loginForm} input#usernamefld[name="usernamefld"][type="text"]:enabled:not([readonly])`,
  passwordSelector: `${loginForm} input#passwordfld[name="passwordfld"][type="password"]:enabled:not([readonly])`,
  submitSelector: `${loginForm} button[type="submit"][name="login"][value="1"]:enabled:not([formaction]):not([formmethod]):not([formtarget])`,
} as const;

export const OPNSENSE_PROFILE: HttpApplicationProfile = {
  id: "opnsense",
  label: "OPNsense",
  category: "networking",
  capability: "known-form",
  loginModes: ["manual", "form"],
  usernameLabel: "WebGUI username",
  requiresHttps: true,
  loginPath: "/",
  selectors: OPNSENSE_LOGIN_SELECTORS,
  description:
    "OPNsense firewall WebGUI on your configured HTTPS host and port. Manual login is the default; automatic username/password form login requires explicit opt-in. Use Manual for TOTP (code and password share one field), SSO, password changes or customized forms. Captive portal and API-key authentication are separate. Live authenticated login has not been verified.",
};
