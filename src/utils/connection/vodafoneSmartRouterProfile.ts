import type { HttpApplicationProfile } from "./httpApplicationProfiles";

// Vodafone Smart Router 3 login DOM supplied by the user, 2026-10-06.
// The router owns SubmitForm(), including password processing and requests.
// Do not invent a POST endpoint or replace it with native form submission.
const login = "#mainbody #logindiv";
export const VODAFONE_SMART_ROUTER_LOGIN_SELECTORS = {
  usernameSelector: `${login} input#username[type="text"]:enabled:not([readonly])`,
  passwordSelector: `${login} input#userpwd[type="password"]:enabled:not([readonly])`,
  submitSelector: `${login} input#loginbtn[type="button"][name="login"]:enabled`,
} as const;

export const VODAFONE_SMART_ROUTER_PROFILE: HttpApplicationProfile = {
  id: "vodafone-smart-router-3",
  label: "Vodafone Smart Router 3",
  category: "networking",
  capability: "known-form",
  loginModes: ["manual", "form"],
  usernameLabel: "Router username",
  selectors: VODAFONE_SMART_ROUTER_LOGIN_SELECTORS,
  description:
    "Local Vodafone Smart Router 3 administration, not My Vodafone. Keeps your configured router address, port and path. Manual login is the default; opt in to fill username/password and click the router's Iniciar Sessão button once its own login handler is ready. Supports the supplied #username / #userpwd layout. Prefer HTTPS when available; HTTP is unencrypted. Live device login has not been verified.",
};
