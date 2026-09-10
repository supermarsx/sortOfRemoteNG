import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/** Source-reviewed controls, not an assertion about every deployment or theme. */
export const SELF_HOSTED_VAULT_PROFILES: readonly HttpApplicationProfile[] = [
  ...(["bitwarden-self-hosted", "vaultwarden"] as const).map(
    (id): HttpApplicationProfile => ({
      id,
      label: id === "vaultwarden" ? "Vaultwarden" : "Bitwarden (self-hosted)",
      category: "mailStorage",
      capability: "known-form",
      requiresHttps: true,
      loginModes: ["manual", "form"],
      loginFlow: "bitwarden",
      usernameLabel: "Email",
      loginPath: "/",
      totpChallenges: [
        {
          id: `${id}-totp`,
          label: "Web vault — selected authenticator app",
          codeSelector:
            'app-two-factor-auth form app-two-factor-auth-authenticator input[type="text"]',
          submitSelector:
            'app-two-factor-auth form:has(app-two-factor-auth-authenticator) button[type="submit"]',
          paths: ["/"],
          submission: "spa",
        },
      ],
      description:
        (id === "vaultwarden"
          ? "Community Vaultwarden server using its patched Bitwarden web vault, not the /admin token page. "
          : "Official self-hosted Bitwarden web vault, not the hosted cloud service. ") +
        "Reviewed email-then-master-password login over HTTPS, once per connection attempt. Use the website account, not an API key. SSO, passkeys, device approval and unsupported versions stay interactive. Optional codes target only the selected authenticator-app challenge; email and recovery codes are not filled.",
    }),
  ),
  {
    id: "nextcloud",
    label: "Nextcloud",
    category: "mailStorage",
    capability: "known-form",
    requiresHttps: true,
    loginModes: ["manual", "form"],
    loginPath: "/login",
    selectors: {
      usernameSelector: 'form.login-form[name="login"] input#user[name="user"]',
      passwordSelector:
        'form.login-form[name="login"] input#password[name="password"][type="password"]',
      submitSelector: 'form.login-form[name="login"] button[type="submit"]',
    },
    totpChallenges: [
      {
        id: "nextcloud-totp",
        label: "Nextcloud twofactor_totp app — enrolled authenticator",
        codeSelector:
          'form.totp-form[method="POST" i] input[name="challenge"][autocomplete="one-time-code"][inputmode="numeric"]',
        submitSelector:
          'form.totp-form[method="POST" i] button.two-factor-submit[type="submit"]',
        paths: ["/login/challenge/totp", "/index.php/login/challenge/totp"],
        submission: "post",
      },
    ],
    description:
      "Reviewed HTTPS account/password login and optional enrolled twofactor_totp challenge. WebDAV app passwords are not website credentials. Passkeys, SSO, backup codes and other MFA providers stay interactive. Subdirectory installs may need their login path entered manually; automatic codes require an exact reviewed challenge path.",
  },
];
