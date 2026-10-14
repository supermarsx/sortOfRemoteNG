import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/** Central integration supplies the reviewed native-only declarative steps.
 * Authenticator sign-in remains interactive until its actual DOM is recorded.
 */
export const TIME4VPS_PROFILE: HttpApplicationProfile = {
  id: "time4vps",
  label: "Time4VPS dashboard",
  category: "management",
  capability: "manual",
  loginModes: ["manual"],
  requiresHttps: true,
  loginPath: "/clientarea/",
  hostedLoginUrl: "https://billing.time4vps.com/clientarea/",
  description:
    "Time4VPS billing and VPS customer account. Email and password sign-in uses the Client Area form in the native browser. Authenticator codes, email verification, recovery and enrollment remain interactive until reviewed. VPS operating-system credentials are separate. Open original sign-in uses the system browser with separate cookies.",
};
