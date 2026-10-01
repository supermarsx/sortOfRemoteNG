import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const CLAUDE_LOGIN_URL = "https://claude.ai/login";
export const CLAUDE_PROFILE: HttpApplicationProfile = {
  id: "claude",
  label: "Claude",
  category: "business",
  capability: "known-form",
  hostedLoginUrl: CLAUDE_LOGIN_URL,
  requiresHttps: true,
  loginModes: ["manual", "form"],
  loginFlow: "claude",
  emailOnly: true,
  usernameLabel: "Email",
  description:
    "Optional one-shot email assistance for Claude's passwordless sign-in. The semantic form adapter is fixture-tested, not live verified. No configured password is sent. Complete the emailed link or code yourself; SSO, security challenges and recovery remain interactive. An Anthropic API key is not a website login, and unattended completion is not supported.",
};
