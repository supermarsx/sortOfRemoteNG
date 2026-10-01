import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const CANVA_LOGIN_URL = "https://www.canva.com/login/";

export const CANVA_PROFILE: HttpApplicationProfile = {
  id: "canva",
  label: "Canva",
  category: "business",
  capability: "generic-form",
  hostedLoginUrl: CANVA_LOGIN_URL,
  requiresHttps: true,
  loginModes: ["manual", "form"],
  usernameLabel: "Email",
  description:
    "Generic email/password form assistance; Canva staged email/code/SSO flow not verified. Security challenges remain interactive. Explicit opt-in uses saved or vault credentials only for the current supported form; it does not open email login or advance unknown stages.",
};
