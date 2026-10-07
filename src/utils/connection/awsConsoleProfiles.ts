import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/**
 * Official public console entry points, reviewed 2026-10-06:
 * https://docs.aws.amazon.com/signin/latest/userguide/sign-in-urls-defined.html
 * https://docs.amazonaws.cn/en_us/aws/latest/userguide/console.html
 * https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/configure-account.html
 *
 * Existing sorng-cloud/sorng-aws integrations use access keys/session tokens
 * for service APIs. They are not browser login adapters and must stay separate.
 * AWS's current sign-in experience differs by identity type; no single fixed
 * account ID, region, IAM alias, Identity Center tenant or password form is
 * inferred. Regional/tenant redirects do not constitute credential consent.
 */
export const AWS_CONSOLE_DESTINATIONS = [
  {
    id: "aws-console",
    label: "AWS Management Console",
    url: "https://console.aws.amazon.com/",
    detail:
      "Commercial AWS console. Choose the appropriate root, IAM or federated sign-in on AWS; an IAM user also needs the account ID or alias. IAM Identity Center users should use their administrator-provided access portal as a separate saved website.",
  },
  {
    id: "aws-console-china",
    label: "AWS Management Console — China",
    url: "https://console.amazonaws.cn/",
    detail:
      "Amazon Web Services China console. Use the China account's console identity; commercial AWS credentials are not automatically reused.",
  },
  {
    id: "aws-console-govcloud",
    label: "AWS Management Console — GovCloud (US)",
    url: "https://console.amazonaws-us-gov.com/",
    detail:
      "AWS GovCloud (US) console. Use the GovCloud identity provided by your administrator; a linked commercial account does not grant automatic browser sign-in.",
  },
] as const;

export const AWS_CONSOLE_PROFILES: readonly HttpApplicationProfile[] =
  AWS_CONSOLE_DESTINATIONS.map((destination) => ({
    id: destination.id,
    label: destination.label,
    category: "management",
    capability: "manual",
    requiresHttps: true,
    hostedLoginUrl: destination.url,
    loginPath: "/",
    loginModes: ["manual"],
    description:
      `${destination.detail} Interactive sign-in only: saved passwords, AWS access keys, session tokens and Amazon Shopping credentials are not supplied. ` +
      "MFA, CAPTCHA, SSO, passkeys, security keys and recovery remain interactive. Regional console and identity-provider redirects require the saved connection's existing routing/trust policy; no wildcard AWS origin grant is added. Embedded sign-in has not been live-verified.",
  }));
