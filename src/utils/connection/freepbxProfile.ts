import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/**
 * Reviewed FreePBX framework release/16.0 and release/17.0 admin dialog.
 * https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/views/login.php
 * https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/assets/js/script.legacy.js
 * The page keeps a hidden #login_form template and clones it into .ui-dialog.
 * Click Continue so FreePBX retains its password-reminder/MFA/SAML handlers.
 * UCP uses /ucp and form#frm-login, a separate contract not covered here.
 */
export const FREEPBX_ADMIN_PROFILE: HttpApplicationProfile = {
  id: "freepbx",
  label: "FreePBX Administration",
  category: "networking",
  capability: "known-form",
  loginModes: ["manual", "form"],
  loginPath: "/admin",
  selectors: {
    usernameSelector:
      '.ui-dialog form[id="loginform"] input[name="username"][type="text"]',
    passwordSelector:
      '.ui-dialog form[id="loginform"] input[name="password"][type="password"]',
    submitSelector:
      '.ui-dialog form[id="loginform"] button[id="customContinue"][type="button"]',
  },
  description:
    "Reviewed FreePBX 16/17 Administration password dialog at /admin. Open FreePBX Administration to show the login dialog; automatic form login requires explicit opt-in. Use the web administrator account. UCP (/ucp) is a separate user portal. MFA, SSO, password changes and older or customized login layouts remain interactive.",
};
