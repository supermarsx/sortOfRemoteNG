---
title: Hosted dashboards and website sign-in
description: Reviewed dashboard addresses, browser sign-in boundaries and provider icons.
---

# Hosted dashboards and website sign-in

In an HTTP/HTTPS connection, choose **Protocol → Application**. Every new preset
starts in **Manual** mode. Selecting a preset does not overwrite your saved
address or icon, launch a browser, or send credentials. For hosted services use
the explicit **Use hosted login address** action, review the change, and save.
Hosted presets require their exact HTTPS origin; choosing one cannot relabel an
unrelated server as that provider. Self-hosted presets keep your server address
and expose a reviewed relative sign-in path.

**Open original sign-in** is an explicit system-browser handoff to the preset's
public URL or your configured server's reviewed path. The browser has separate
cookies and follows the operating system network route, not this connection's
internal proxy/tunnel settings. It does not import an authenticated session back
into the app. Credentials, API keys, cookies and one-time codes are not included
in the handoff URL. These presets add no cookie persistence.

## Hosted services

The following are **interactive website presets**, not automatic password or
2FA integrations. SSO, email links, CAPTCHA, tenant policy, device approval,
passkeys and security keys stay with the provider. Use the original-site browser
when a sign-in flow requires a different origin or rejects the embedded browser.
In particular, [Google documents restrictions on embedded-browser sign-in](https://support.google.com/accounts/answer/7675428).
The protected single-origin proxy is not expanded or weakened for these sites.

Official public entry points reviewed on 2026-09-10:

| Preset                  | Entry point and specific limitation                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namecheap               | [Account login](https://www.namecheap.com/myaccount/login/); registrar account, not a hosted control-panel account.                                                                                                                                                                                 |
| Network Solutions       | [Account Manager](https://www.networksolutions.com/my-account/login), as linked by its [hosting-control-panel guide](https://www.networksolutions.com/help/article/access-the-web-hosting-control-panel).                                                                                           |
| Time4VPS                | [Billing/customer area](https://billing.time4vps.com/); not a VPS OS login.                                                                                                                                                                                                                         |
| Contabo                 | [Original customer panel](https://my.contabo.com/account/login). The [new and original panels use separate credentials](https://help.contabo.com/en/support/solutions/articles/103000268754-what-is-the-customer-panel-and-how-do-i-access-it-); this preset does not silently switch between them. |
| ChatGPT                 | [ChatGPT website](https://chatgpt.com/); an OpenAI API key is not a website login.                                                                                                                                                                                                                  |
| Claude                  | [Claude website](https://claude.ai/). Its [login guide](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account) describes Google or email-link sign-in, not a dedicated Claude password.                                                                                     |
| OpenRouter              | [Website sign-in](https://openrouter.ai/sign-in); API keys remain separate.                                                                                                                                                                                                                         |
| GitLab.com              | [Hosted sign-in](https://gitlab.com/users/sign_in); staged account routing, SSO and challenges remain interactive.                                                                                                                                                                                  |
| Google Account          | [Account dashboard](https://myaccount.google.com/).                                                                                                                                                                                                                                                 |
| Google Cloud Console    | [Cloud console](https://console.cloud.google.com/); no service-account or API creation.                                                                                                                                                                                                             |
| Google Analytics        | [Analytics dashboard](https://analytics.google.com/analytics/web/).                                                                                                                                                                                                                                 |
| Google Business Profile | [Locations dashboard](https://business.google.com/locations).                                                                                                                                                                                                                                       |
| Google Search Console   | [Search Console](https://search.google.com/search-console/); no property verification.                                                                                                                                                                                                              |
| Google Ads              | [Ads overview](https://ads.google.com/aw/overview); Google Account sign-in, not an advertising API connection.                                                                                                                                                                                      |
| Facebook                | [Login](https://www.facebook.com/login/); Meta checkpoints are not bypassed.                                                                                                                                                                                                                        |
| Instagram               | [Login](https://www.instagram.com/accounts/login/); account checkpoints remain interactive.                                                                                                                                                                                                         |
| HPE GreenLake           | [Cloud dashboard](https://common.cloud.hpe.com/); distinct from a server's iLO/Redfish identity.                                                                                                                                                                                                    |
| Adobe                   | [Adobe Account](https://account.adobe.com/); no desktop Creative Cloud embedding.                                                                                                                                                                                                                   |
| YouTube                 | [YouTube](https://www.youtube.com/); Google Account sign-in.                                                                                                                                                                                                                                        |
| Zoom                    | [Web portal sign-in](https://zoom.us/signin); not the native meeting client.                                                                                                                                                                                                                        |
| iCloud                  | [iCloud website](https://www.icloud.com/); Apple Account/device verification, not app-specific passwords.                                                                                                                                                                                           |
| OVHcloud                | [EU Control Panel](https://manager.eu.ovhcloud.com/), the destination of the [legacy manager link](https://www.ovh.com/manager/). Other regions need a separately reviewed connection, not cross-origin credential forwarding.                                                                      |
| PTisp                   | [myPTisp](https://my.ptisp.pt/); hosting and billing customer account.                                                                                                                                                                                                                              |
| Marcaria                | [Account login](https://www.marcaria.com/register/user/login.asp), linked from its [homepage](https://www.marcaria.com/ws/en/home); provider challenge protection remains intact.                                                                                                                   |
| FreeDNS                 | [afraid.org member dashboard](https://freedns.afraid.org/); dynamic DNS update tokens are not account passwords.                                                                                                                                                                                    |
| Registro.br             | [Account login](https://registro.br/login/).                                                                                                                                                                                                                                                        |
| Gmail                   | [Web mail](https://mail.google.com/); Google Account sign-in, not an IMAP app password.                                                                                                                                                                                                             |
| Outlook Online          | [Microsoft 365 work/school mail](https://outlook.office.com/mail/); tenant policy, Entra SSO and MFA stay interactive.                                                                                                                                                                              |

Public entry-point/source review and fixture tests do **not** prove that a
provider currently permits embedded sign-in, that a particular account is
authenticated, or that every deployment works. No live accounts were used.

## Self-hosted and device profiles

| Preset                     | Supported behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitLab (self-hosted)       | Optional form login at `/users/sign_in`, only when both local username/password controls are visible together in the reviewed POST form. Two-step username routing, LDAP tabs, SSO, CAPTCHA, MFA and passkeys remain interactive. Older/custom forms are not inferred.                                                                                                                                                                                                    |
| SQLPad                     | Optional local/LDAP form at `/signin`; controlled inputs notify the page and its own handler submits to the same-origin API. SAML, Google and OIDC remain interactive. The [upstream project is archived](https://github.com/sqlpad/sqlpad); this is not a recommendation to deploy an unmaintained service. Use a maintained, reviewed deployment and adapt subdirectory paths explicitly. Website accounts are not saved SQL database credentials; login runs no query. |
| Eaton UPS                  | Manual HTTPS card web administration. [Network-M2 documentation](https://www.eaton.com/content/dam/eaton/products/backup-power-ups-surge-it-power-distribution/power-management-software-connectivity/eaton-gigabit-network-card/eaton-network-m2-user-guide.pdf) describes firmware-specific local/remote authentication. No universal M2/M3 selectors or default account are supplied.                                                                                  |
| Exchange OWA (on-premises) | Manual HTTPS `/owa/` at the organization's mail host. [Exchange virtual-directory settings](https://learn.microsoft.com/en-us/exchange/clients/outlook-on-the-web/virtual-directories) vary by deployment; no Windows identity, federation or API-session handoff is assumed.                                                                                                                                                                                             |
| DD-WRT                     | Explicit HTTP Basic authentication only, or Manual. Prefer trusted HTTPS. No initial password change or router configuration is automated.                                                                                                                                                                                                                                                                                                                                |
| FreshTomato                | Explicit HTTP Basic authentication only, or Manual, matching the web server's challenge. Prefer trusted HTTPS; [access settings](https://wiki.freshtomato.org/doku.php/admin-access) remain device-owned.                                                                                                                                                                                                                                                                 |

Form fixtures run the app's **actual injected client** with reduced reviewed DOM:
same-form controls, same-origin action, single submission, CSRF preservation,
no password release into username-only stages, and no native GET fallback for a
JavaScript-handled form. This is not a browser/NAS acceptance test. No additional
automatic-MFA challenge is declared for this batch.

Reviewed source revisions:

- [GitLab sign-in form](https://github.com/gitlabhq/gitlabhq/blob/fa8866a33046ee6ab803291d3a38810f16d395b0/app/assets/javascripts/authentication/sign_in/components/sign_in_form.vue) and [password input](https://github.com/gitlabhq/gitlabhq/blob/fa8866a33046ee6ab803291d3a38810f16d395b0/app/assets/javascripts/authentication/password/components/password_input.vue).
- [SQLPad local/LDAP form](https://github.com/sqlpad/sqlpad/blob/57cc866b4c5e8cb5a1964d6a58a789e76853d537/client/src/pages/SignIn.tsx) and [same-origin sign-in handler](https://github.com/sqlpad/sqlpad/blob/57cc866b4c5e8cb5a1964d6a58a789e76853d537/server/routes/signin.js).
- [DD-WRT HTTP Basic challenge implementation](https://github.com/mirror/dd-wrt/blob/eed3ba12dcbdb715acaba2579f86f32c66663898/src/router/httpd/httpd.c).
- [FreshTomato HTTP Basic challenge implementation](https://github.com/FreshTomato-Project/freshtomato-arm/blob/6a78cfbe9a52bc3789e1e736f189ac40f6178d7c/release/src-rt-6.x.4708/router/httpd/httpd.c).

## Icons

Suggestions reuse the existing central vector catalogue and never overwrite a
saved icon. Zoom, Namecheap, Network Solutions, Time4VPS, Contabo, GitLab, HPE,
OVHcloud, PTisp, SQLPad, Eaton, Microsoft, Exchange, DD-WRT and FreshTomato retain
their existing choices. ChatGPT uses a neutral AI glyph, not a claimed OpenAI
mark. New provenance is recorded in [connection icon brands](connection-icon-brands.md).
