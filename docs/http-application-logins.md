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

## Git, CI, hosted business login and Microsoft portals

| Application                       | Password stage                                                                           | Second factor and compatibility                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GitHub                            | Reviewed public `github.com/login` form; preset pins `https://github.com:443`            | Interactive TOTP, SMS, GitHub Mobile, SSO or passkey; GitHub Enterprise requires a separate custom profile                       |
| Gitea                             | Reviewed v1.27.3 `/user/login` form                                                      | Optional linked TOTP at `/user/two_factor`; scratch codes, enrollment, subpath/custom forms and external providers remain manual |
| Brevo                             | Reviewed public `login.brevo.com` email/password controls; preset pins that HTTPS origin | Authenticator/SMS and Google/Apple/SAML remain manual; separate application origins may require the system browser               |
| Drone CI                          | Interactive configured Git-provider OAuth                                                | No universal Drone password form; provider MFA and cross-origin callbacks may need the system browser                            |
| Exchange Admin Center / ECP       | Interactive on-premises `/ecp/`                                                          | Server-dependent forms, Windows authentication, ADFS or publishing MFA; not the Exchange Online portal                           |
| Windows RemoteApp / RD Web Access | Interactive `/RDWeb/` entry                                                              | Legacy portal, HTML5 client, gateway and Entra preauthentication differ; this does not configure or launch a native RemoteApp    |

GitHub and Brevo selection does not overwrite the current address. Their explicit
**Use login address** action sets the reviewed hosted authority without changing
certificate settings or saved secrets. The initial page uses the preset's static
login path; proxy transport still binds only the configured origin.

For every valid HTTPS website, the sign-in notice offers an explicit system-browser
action. It derives a destination from the saved HTTPS authority and a static
profile path, never the current page's query, fragment, token or SSO callback.
Mismatched session/saved authorities and malformed metadata disable this handoff.
YubiKey WebAuthn, passkeys and Windows Hello use the actual website origin in that
browser, not hardware-key emulation through the proxy. The app does not transfer
private keys, saved passwords, cookies, or a completed browser session back to the
embedded tab. Review the separate-network-route warning before using this action.

Additional reviewed sources:

- [GitHub public login](https://github.com/login) and [supported two-factor methods](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication)
- [Gitea v1.27.3 password template](https://github.com/go-gitea/gitea/blob/v1.27.3/templates/user/auth/signin_inner.tmpl), [TOTP template](https://github.com/go-gitea/gitea/blob/v1.27.3/templates/user/auth/twofa.tmpl), [external authentication](https://docs.gitea.com/next/administration/authentication/)
- [Brevo public login](https://login.brevo.com/) and [authenticator/SMS two-factor instructions](https://help.brevo.com/hc/en-us/articles/360021203440-Secure-your-account-with-Two-Factor-Authentication-2FA)
- [Drone Git-provider OAuth configuration](https://docs.drone.io/server/provider/github/)
- [Exchange ECP authentication settings](https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-ecpvirtualdirectory?view=exchange-ps)
- [RD Web Access](https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/remote-desktop-web-access-troubleshooting), [Entra preauthentication for Remote Desktop Services](https://learn.microsoft.com/en-us/entra/identity/app-proxy/application-proxy-integrate-with-remote-desktop-services)
