---
title: Website application login and two-factor authentication
eyebrow: Use the app
description: Reviewed website password forms, optional linked authenticator codes, and true-origin limitations.
permalink: /http-application-logins/
---

# Website application login

For an HTTP/HTTPS connection, open **Protocol → Application**, choose the website
application, and save. Selection is manual by default: it does not change the
address, port, certificate policy, passwords, or icon. The suggested icon is an
explicit action; a neutral application symbol is used when no dedicated mark is
available.

Choose **Automatic form login** only to submit the saved website account once.
API tokens, agent credentials, remote desktop passwords, and native integration
sessions are not interchangeable with website authentication. A failed login is
not automatically retried. Custom forms can require reviewed selector overrides.

| Application          | Reviewed password form                             | Automatic authenticator challenge                                                                             |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tactical RMM         | Dashboard `/login`, reviewed against web v0.101.64 | Separate authenticator dialog at `/login`                                                                     |
| WordPress            | Core `/wp-login.php`                               | Maintained Two-Factor plugin's `Two_Factor_Totp` provider only                                                |
| Joomla Administrator | Administrator login, Joomla 5.4 source             | Manual: core email and TOTP share indistinguishable captive controls; some desktop submit controls are hidden |
| Drupal               | Core user login, Drupal 11 source                  | Manual: contributed TFA modules select different validation providers                                         |
| Payload CMS          | Core admin login, normally `/admin/login`          | Manual: authentication strategies and MFA are project-specific                                                |
| MeshCentral          | Web account login, not account reset               | Manual: authenticator/email/SMS challenges share controls                                                     |
| Apache Guacamole     | Username/password login, reviewed against 1.6.0    | Installed TOTP extension, already-enrolled challenge only, at `/guacamole/` or `/`                            |

These are source-reviewed templates and synthetic regression fixtures, not a
claim that every deployed version, custom theme, authentication extension, or
signed-in site has been tested. Login paths and challenge DOM must match. Changed
or unsupported forms remain interactive rather than receiving a guessed code.

## Explicit automatic authenticator codes

1. Enroll your authenticator with the website using its normal account-security
   process. Configure the existing secret in this connection under **Protocol →
   Recovery → 2FA / TOTP**. This app does not enroll/reset the website account.
2. In **Application**, choose the supported challenge and a connection
   authenticator. No authenticator is selected automatically.
3. Click **Enable automatic codes for this origin**, then save the connection.
   HTTPS with certificate verification is required. Consent stores a stable authenticator reference and the
   exact HTTPS origin, not a second secret or an OTP.
4. Connect and complete the password stage, manually or using its separate
   explicit automatic-login setting. The supported challenge may receive one
   transient code after the page/document, database access, persisted consent,
   origin, and exact controls are checked. A rejected submission is not retried.

The initial challenge search lasts 30 seconds. If it expires before submission,
the 2FA Codes panel offers **Check for 2FA challenge again**. It cannot repeat a
submitted code during the same proxy session. A fresh proxy session starts a new
authentication attempt. A page acknowledgment means the code was submitted, not
that the website accepted the login. Missing or duplicate authenticator IDs,
unavailable database access, unpersisted consent, or disabled certificate
verification block automatic codes.

Changing the address does not silently rebind consent. Explicitly review and
enable again for the new origin. Disable automatic codes to return to manual
entry. The session's **2FA Codes** panel remains available for manual copying.
Custom plugins, email/SMS codes, recovery codes, enrollment, CAPTCHA, SSO and push
approval are not generalized into automatic TOTP.

## Proxy and true-origin limitations

Tactical RMM requires an HTTPS dashboard address. Standard installations configure
the frontend's `PROD_URL` as a separate API origin. The embedded proxy binds one
upstream origin; this preset does not introduce arbitrary cross-origin routing or
weaken CORS/certificate checks. If the dashboard cannot reach its backend, use the
session's explicit external-browser action at the original website origin.

Passkeys and security keys (including YubiKey WebAuthn) depend on the website's
real relying-party origin. Use the system browser at that origin; the localhost
proxy must not impersonate it. The external browser has separate cookies and
uses the operating system's routing, not this connection's embedded proxy route.
Opening it is always explicit, not a background launch.

## Reviewed upstream sources

- [Tactical RMM v0.101.64 login](https://github.com/amidaware/tacticalrmm-web/blob/v0.101.64/src/views/LoginView.vue), [axios API origin](https://github.com/amidaware/tacticalrmm-web/blob/v0.101.64/src/boot/axios.js)
- [WordPress core login](https://github.com/WordPress/WordPress/blob/master/wp-login.php), [Two-Factor TOTP provider](https://github.com/WordPress/two-factor/blob/master/providers/class-two-factor-totp.php), [challenge form](https://github.com/WordPress/two-factor/blob/master/class-two-factor-core.php)
- [Joomla administrator login](https://github.com/joomla/joomla-cms/blob/5.4-dev/administrator/modules/mod_login/tmpl/default.php), [TOTP provider](https://github.com/joomla/joomla-cms/blob/5.4-dev/plugins/multifactorauth/totp/src/Extension/Totp.php), [email provider](https://github.com/joomla/joomla-cms/blob/5.4-dev/plugins/multifactorauth/email/src/Extension/Email.php)
- [Drupal core login](https://github.com/drupal/drupal/blob/11.x/core/modules/user/src/Form/UserLoginForm.php), [contributed TFA entry form](https://git.drupalcode.org/project/tfa/-/blob/8.x-1.x/src/Form/EntryForm.php)
- [Payload login form](https://github.com/payloadcms/payload/blob/main/packages/ui/src/views/Login/LoginForm/index.tsx), [authentication configuration](https://payloadcms.com/docs/authentication/overview)
- [MeshCentral login template](https://github.com/Ylianst/MeshCentral/blob/master/views/login.handlebars)
- [Guacamole 1.6 login template](https://github.com/apache/guacamole-client/blob/1.6.0/guacamole/src/main/frontend/src/app/login/templates/login.html), [TOTP field and enrollment template](https://github.com/apache/guacamole-client/blob/1.6.0/extensions/guacamole-auth-totp/src/main/resources/templates/authenticationCodeField.html), [TOTP extension documentation](https://guacamole.apache.org/doc/gug/totp-auth.html)

Sources were reviewed in September 2026. Branch-linked upstream sources may change;
the tests capture the specific controls reviewed, not their entire implementations.
