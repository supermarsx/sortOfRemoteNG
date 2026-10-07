import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/**
 * Classic Windows Server RDWeb form contract, not the HTML5/Entra web client.
 * Microsoft documents the portal/password-change distinction:
 * https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/remote-desktop-web-access-troubleshooting
 * Firsthand Server 2016 form and POST trace (including onLoginFormSubmit):
 * https://community.ibm.com/community/user/discussion/forms-based-sso-credential-pass-through
 *
 * Explicit selectors use the generic client's existing same-origin POST,
 * readiness and one-shot guards. Clicking btnSignIn preserves the server's
 * onsubmit handler, hidden state and public/private computer choice. Do not
 * guess a form for password changes, federated pages or embedded challenges.
 */
const classicForm =
  'form#FrmLogin[name="FrmLogin"][method="post" i]' +
  ':is([action^="login.aspx" i],[action*="/login.aspx" i])' +
  ':not([target]):not(:has(input[type="password"]:not(#UserPass),input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="captcha" i],iframe))';

export const RD_WEB_LOGIN_SELECTORS = {
  usernameSelector: `${classicForm} input#DomainUserName[name="DomainUserName"][type="text"]:not(:disabled):not([readonly])`,
  passwordSelector: `${classicForm} input#UserPass[name="UserPass"][type="password"]:not(:disabled):not([readonly])`,
  submitSelector: `${classicForm} input#btnSignIn[type="submit"]:not([formaction]):not([formmethod]):not([formtarget]):not([form]):not(:disabled)`,
} as const;

export const RD_WEB_PROFILE: HttpApplicationProfile = {
  id: "rdweb",
  label: "Windows RemoteApp / RD Web Access",
  category: "virtualization",
  capability: "known-form",
  requiresHttps: true,
  loginModes: ["manual", "form"],
  loginPath: "/RDWeb/",
  usernameLabel: "Domain\\username or UPN",
  selectors: RD_WEB_LOGIN_SELECTORS,
  description:
    "Optional classic RD Web Access form login. Opens /RDWeb/ and waits for the localized FrmLogin form, then clicks Sign in once using the page's own submit handler. Enter the complete account name required by your server, such as DOMAIN\\username or user@example.com; no domain is guessed or added. Automatic filling currently requires an HTML response; raw XML/XSL portals are not supported. HTML5 web clients, Microsoft Entra/ADFS, Windows-integrated authentication, MFA, password changes and customized forms remain interactive. Portal login does not automatically launch a RemoteApp or native RDP session.",
};
