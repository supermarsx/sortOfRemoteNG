import type { HttpApplicationProfile } from "./httpApplicationProfiles";

export const STANDARD_NOTES_LOGIN_URL = "https://app.standardnotes.com/";
export const STANDARD_NOTES_ENTRY_PATHS = ["/", "/index.html", "/popup.html"];

export const STANDARD_NOTES_PROFILES: readonly HttpApplicationProfile[] = [
  {
    id: "standard-notes",
    label: "Standard Notes",
    category: "mailStorage",
    capability: "manual",
    hostedLoginUrl: STANDARD_NOTES_LOGIN_URL,
    requiresHttps: true,
    usernameLabel: "Email",
    description:
      "Encrypted notes at app.standardnotes.com. Use your account email and password. Complete security challenges and account recovery on the website.",
  },
  {
    id: "standard-notes-self-hosted",
    label: "Standard Notes (self-hosted)",
    category: "mailStorage",
    capability: "manual",
    requiresHttps: true,
    usernameLabel: "Email",
    loginPath: "/",
    description:
      "Connect to your own Standard Notes web app using its website address and port. Use your account email and password; configure the sync server in the website if needed.",
  },
  {
    id: "standard-red-notes",
    label: "Standard Red Notes",
    category: "mailStorage",
    capability: "manual",
    requiresHttps: true,
    usernameLabel: "Email",
    loginPath: "/",
    description:
      "Self-hosted Standard Red Notes. Enter your web app address and port, then use your account email and password. Automatic sign-in uses the default workspace. For another workspace, turn off automatic submission, enter the workspace name on the website, then submit.",
  },
];

/** Both applications recognize this query on their HTML entry pages and open
 * the sign-in pane when signed out. It contains no account or credential data.
 * Sources: RouteParser and ApplicationEventObserver in the pinned login corpus. */
export function applyStandardNotesSignInEntry(
  target: URL,
  applicationId: string | undefined,
  loginMode: string | undefined,
): void {
  if (
    loginMode === "form" &&
    STANDARD_NOTES_PROFILES.some((profile) => profile.id === applicationId) &&
    STANDARD_NOTES_ENTRY_PATHS.includes(target.pathname)
  ) {
    // Match native's canonical query ordering, including duplicate settings keys.
    target.searchParams.delete("settings");
    target.searchParams.append("settings", "account");
  }
}
