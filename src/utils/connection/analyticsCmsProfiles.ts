import type { HttpApplicationProfile } from "./httpApplicationProfiles";

/** Reviewed upstream login controls; deployment-specific SSO/MFA stays interactive. */
export const ANALYTICS_CMS_PROFILES: readonly HttpApplicationProfile[] = [
  {
    id: "matomo",
    label: "Matomo",
    category: "monitoring",
    capability: "known-form",
    requiresHttps: true,
    loginModes: ["manual", "form"],
    loginPath: "/index.php",
    usernameLabel: "Username or email",
    selectors: {
      usernameSelector:
        'form.loginForm__form input#login_form_login[name="form_login"]',
      passwordSelector:
        'form.loginForm__form input#login_form_password[name="form_password"][type="password"]',
      submitSelector:
        'form.loginForm__form input#login_form_submit[type="submit"]',
    },
    description:
      "Reviewed Matomo password form over HTTPS; reset-password forms are excluded. Use the website account, not token_auth. MFA, SSO and CAPTCHA remain interactive. Subdirectory installs need their actual login path.",
  },
  {
    id: "plausible",
    label: "Plausible Analytics",
    category: "monitoring",
    capability: "known-form",
    requiresHttps: true,
    loginModes: ["manual", "form"],
    loginPath: "/login",
    usernameLabel: "Email",
    selectors: {
      usernameSelector:
        'form[action="/login"] input[type="email"][autocomplete="username"]',
      passwordSelector:
        'form[action="/login"] input#current-password[type="password"][autocomplete="current-password"]',
      submitSelector: 'form[action="/login"] button[type="submit"]',
    },
    description:
      "Reviewed HTTPS email/password form on the configured Plausible host, not an API key. Authenticator verification, recovery codes and SSO remain interactive; the preset does not choose a hosted or self-hosted account for you.",
  },
  {
    id: "odoo",
    label: "Odoo",
    category: "business",
    capability: "known-form",
    requiresHttps: true,
    loginModes: ["manual", "form"],
    loginPath: "/web/login",
    usernameLabel: "Email / login",
    selectors: {
      usernameSelector:
        'form.oe_login_form[action="/web/login"] input#login[name="login"]',
      passwordSelector:
        'form.oe_login_form[action="/web/login"] input#password[name="password"][type="password"]',
      submitSelector:
        'form.oe_login_form[action="/web/login"] button.btn-primary[type="submit"]:not([name])',
    },
    description:
      "Reviewed HTTPS website-account login, not an RPC API key. Select the intended database/account interactively first; hidden account-picker forms are not filled. Authenticator codes, SSO and CAPTCHA remain manual. Debug superuser-login buttons are excluded.",
  },
  {
    id: "ghost",
    label: "Ghost Admin",
    category: "business",
    capability: "manual",
    requiresHttps: true,
    loginModes: ["manual"],
    loginPath: "/ghost/",
    description:
      "Interactive Ghost staff sign-in, not member Portal or an Admin API key. Current Ghost uses a JavaScript form action that the guarded automatic-login client intentionally refuses. Email verification, SSO and other challenges stay on the website; use the original-origin browser if embedding is unsupported.",
  },
  {
    id: "strapi",
    label: "Strapi Admin",
    category: "business",
    capability: "manual",
    requiresHttps: true,
    loginModes: ["manual"],
    loginPath: "/admin/auth/login",
    description:
      "Interactive Strapi administrator sign-in, not a content API token or end-user account. The reviewed SPA declares a non-POST form method, so automatic credential submission is intentionally unavailable. Custom admin paths, SSO and MFA remain interactive; use the original-origin browser when needed.",
  },
  {
    id: "phpmyadmin",
    label: "phpMyAdmin",
    category: "business",
    capability: "known-form",
    requiresHttps: true,
    loginModes: ["manual", "form"],
    loginPath: "/index.php",
    selectors: {
      usernameSelector:
        'form#login_form[name="login_form"] input#input_username[name="pma_username"]',
      passwordSelector:
        'form#login_form[name="login_form"] input#input_password[name="pma_password"][type="password"]',
      submitSelector:
        'form#login_form[name="login_form"] input#input_go[type="submit"]',
    },
    description:
      "Reviewed HTTPS cookie-authentication form. Review the selected database server before enabling automatic login; the preset never selects or changes it. HTTP-auth, signon, CAPTCHA, authenticator and security-key flows remain manual. Enter the actual phpMyAdmin subdirectory path when applicable.",
  },
];
