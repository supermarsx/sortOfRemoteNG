import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const CHATGPT_LOGIN_URL = "https://chatgpt.com/auth/login";
export const CHATGPT_PROFILE: HttpApplicationProfile = {
  id: "chatgpt",
  label: "ChatGPT",
  category: "business",
  capability: "known-form",
  hostedLoginUrl: CHATGPT_LOGIN_URL,
  requiresHttps: true,
  loginModes: ["manual", "form"],
  loginFlow: "chatgpt",
  usernameLabel: "Email",
  description:
    "Optional bounded email/password assistance using a fixture-tested semantic staged adapter. Public pages show email and Continue, but DOM selectors and later live stages have not been verified. SSO, email codes, MFA, CAPTCHA, account choice and recovery remain interactive; unattended completion is not guaranteed. API keys are not website credentials.",
};
