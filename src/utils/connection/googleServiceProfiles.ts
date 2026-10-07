import type { HttpApplicationProfile } from "./httpApplicationProfiles";
import { googleHosted } from "./hostedDashboardProfiles";

/**
 * Public Google website entry points reviewed on 2026-10-06.
 * Reuse the existing, opt-in Accounts adapter; no service-specific selectors,
 * credential grants or additional resource origins are declared here.
 * Manual remains the default. Evidence and limits: docs/google-service-profiles.md.
 */
export const GOOGLE_SERVICE_PROFILES: readonly HttpApplicationProfile[] = [
  // https://support.google.com/youtube/answer/7548152?hl=en
  googleHosted(
    "youtube-studio",
    "YouTube Studio",
    "https://studio.youtube.com/",
    "business",
    "YouTube creator dashboard through Google Account sign-in for an owned or delegated channel. Channel selection, uploads, publishing and monetization changes require user action.",
  ),
  // https://support.google.com/admanager/answer/7084151?hl=en
  googleHosted(
    "google-ad-manager",
    "Google Ad Manager",
    "https://admanager.google.com/",
    "business",
    "Publisher advertising dashboard for an authorized Ad Manager account. Network access, enrollment and account approval remain with Google; no ad inventory or campaigns are changed by this preset.",
  ),
  // https://support.google.com/adsense/answer/10190?hl=en
  googleHosted(
    "google-adsense",
    "Google AdSense",
    "https://adsense.google.com/adsense/login",
    "business",
    "AdSense publisher account through Google Account sign-in. Account approval, payment verification and acceptance of terms remain interactive; publisher IDs and advertising API keys are not website passwords.",
  ),
  // https://support.google.com/docs/answer/6281888?hl=en
  // https://workspace.google.com/products/forms/ links forms.google.com, which
  // redirects to docs.google.com/forms/create. Use the actual Forms origin.
  googleHosted(
    "google-forms",
    "Google Forms",
    "https://docs.google.com/forms/",
    "business",
    "Forms editor entry through Google Account sign-in; Google may open its new-form page. Form sharing and organization access still apply. This preset does not fill or submit responses, publish forms or configure the Forms API.",
  ),
  // https://support.google.com/gemini/answer/13275745?hl=en
  googleHosted(
    "google-gemini",
    "Google Gemini",
    "https://gemini.google.com/",
    "business",
    "Gemini web app with Google Account sign-in for account features. Availability and Workspace administrator policy still apply. This is separate from AI Studio, Vertex AI and Gemini API keys; no prompts are submitted by the preset.",
  ),
  // https://support.google.com/a/answer/182076?hl=en
  googleHosted(
    "google-workspace-admin",
    "Google Workspace Admin console",
    "https://admin.google.com/",
    "management",
    "Google Admin console for an authorized organization administrator. A personal Gmail account does not grant admin access. Organization SSO and additional verification remain interactive; no tenant identity-provider origin is inferred.",
  ),
  // https://support.google.com/googleplay/answer/16671014?hl=en
  // https://play.google.com/store/
  googleHosted(
    "google-play-store",
    "Google Play Store",
    "https://play.google.com/store/",
    "business",
    "Google Play consumer storefront with Google Account sign-in for account features. Purchases, subscriptions and device installation require user action. The developer publishing console has its own preset on the same Google Play origin.",
  ),
  // https://developers.google.com/
  // https://developers.google.com/profile/help/faq
  googleHosted(
    "google-developers",
    "Google for Developers",
    "https://developers.google.com/",
    "business",
    "Google developer documentation and Developer Program website. Public documentation can be read without signing in. Program enrollment, linked product consoles and developer API credentials are separate from this website preset.",
  ),
  // https://support.google.com/googleplay/android-developer/answer/6112435?hl=en
  // https://google.play/business/ links the console on play.google.com.
  googleHosted(
    "google-play-console",
    "Google Play Console",
    "https://play.google.com/console/",
    "management",
    "Google Play developer publishing console for an enrolled or invited account. Signed-out entry may redirect to Google's public business site. Registration, identity verification, fees and app publishing remain interactive; the preset neither enrolls an account nor uploads releases.",
  ),
];
