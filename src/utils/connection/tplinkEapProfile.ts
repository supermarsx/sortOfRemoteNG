import type { HttpApplicationProfile } from "./httpApplicationProfiles";
/** TP-Link official EAP225 v3 emulator: pages/login.html and password.js.
 * The widget hides the named original and reads its visible password clone.
 * The site's login click applies MD5 itself; credentials are never prehashed.
 */
export const TPLINK_EAP_SELECTORS = {
  usernameSelector: 'form#form-login input#login-username[name="username"]',
  passwordSelector:
    'form#form-login span.password-wrap:has(> input#login-password[name="password"]) > input.password-hidden[type="password"]',
  submitSelector: 'form#form-login button#login-btn[type="button"]',
} as const;
export const TPLINK_EAP_PROFILE: HttpApplicationProfile = {
  id: "tplink-eap",
  label: "TP-Link EAP access point",
  category: "networking",
  capability: "known-form",
  loginModes: ["manual", "form"],
  selectors: TPLINK_EAP_SELECTORS,
  description:
    "Reviewed EAP225 v3 standalone login form. The native browser types into the visible password widget and clicks the device's own Login control; the page handles its password hashing. Use the standalone device account. First-time account creation, controller-managed devices and other firmware layouts remain interactive. Omada Controller accounts and TP-Link cloud accounts are separate.",
};
