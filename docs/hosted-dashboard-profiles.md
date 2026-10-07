---
title: Hosted dashboards and website sign-in
description: Reviewed dashboard addresses, browser sign-in boundaries and provider icons.
---

# Hosted dashboards and website sign-in

In an HTTP/HTTPS connection, choose **Protocol → Application**. Every new preset
starts in **Manual** mode. Selecting a preset does not overwrite your icon,
launch a browser, or send credentials. First-party Google presets own their
reviewed HTTPS destination: a blank connection receives it automatically, and
switching between Google presets replaces the previous managed Google address.
An explicit custom address is preserved. The Porkbun and PTisp presets set
their exact HTTPS hostname and port 443 on selection, without changing the
certificate policy or enabling automatic login. Adobe Admin Console, Instagram,
Canva, Amazon Shopping and AWS console presets fill a blank address with their
HTTPS hostname and port 443, but preserve an existing custom address. Use their
explicit address button to replace it; hosted-origin validation still applies.
Amazon Shopping and AWS are manual-only. For other hosted services use the
explicit **Use hosted login address** action, review the change, and save.
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

The following are hosted website presets, **manual by default**. The bounded
opt-in assistance described below is not a guarantee of completed sign-in or an
automatic 2FA integration. SSO, email links, CAPTCHA, tenant policy, device approval,
passkeys and security keys stay with the provider. Use the original-site browser
when a sign-in flow requires a different origin or rejects the embedded browser.
In particular, [Google documents restrictions on embedded-browser sign-in](https://support.google.com/accounts/answer/7675428).
Only explicitly reviewed first-party route catalogs extend the embedded proxy;
unlisted origins are not automatically approved.

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
| PTisp                   | [myPTisp login](https://my.ptisp.pt/login); opt-in customer email/password automation is described below.                                                                                                                                                                                          |
| Marcaria                | [Account login](https://www.marcaria.com/register/user/login.asp), linked from its [homepage](https://www.marcaria.com/ws/en/home); provider challenge protection remains intact.                                                                                                                   |
| FreeDNS                 | [afraid.org member dashboard](https://freedns.afraid.org/); dynamic DNS update tokens are not account passwords.                                                                                                                                                                                    |
| Registro.br             | [Account login](https://registro.br/login/).                                                                                                                                                                                                                                                        |
| Gmail                   | [Web mail](https://mail.google.com/); Google Account sign-in, not an IMAP app password.                                                                                                                                                                                                             |
| Outlook Online          | [Microsoft 365 work/school mail](https://outlook.office.com/mail/); tenant policy, Entra SSO and MFA stay interactive.                                                                                                                                                                              |

Public entry-point/source review and fixture tests do **not** prove that a
provider currently permits embedded sign-in, that a particular account is
authenticated, or that every deployment works. No live accounts were used.

### LinkedIn

The **LinkedIn** preset (`linkedin`) opens the [official login page](https://www.linkedin.com/login)
and suggests its own local, theme-aware brand icon. Blank connections receive the
built-in HTTPS address; existing custom addresses and saved icon choices are not
overwritten. Manual mode is the default. Selecting **Automatic form login** is
an explicit opt-in to one submission with connection-local or selected vault
credentials.

The adapter recognizes the reviewed English/Portuguese form-less controls and
the traditional named POST form. It preserves user-entered values and stops when
the form, destination or document changes. Selector overrides, extra form fields
and automatic MFA are not supported. CAPTCHA, MFA, passkeys, SSO, recovery and
unrecognized layouts remain interactive; there is no retry loop or HTTP Basic
fallback. Public markup was inspected on 2026-10-06 and reduced fixtures exercise
the injected client. A successful authenticated LinkedIn login has not been
live-verified.

### Google Tag Manager

The **Google Tag Manager** website preset (`google-tag-manager`) opens
[the official dashboard](https://tagmanager.google.com/), linked from Google's
[Tag Manager documentation](https://developers.google.com/tag-platform/tag-manager).
Public entry-point review on 2026-10-06 confirmed the Google Accounts redirect;
no credentials were submitted or authenticated dashboard session verified.

It reuses the existing Google staged sign-in and enrolled-TOTP flow, with manual
browsing as the default and explicit opt-in for automatic login. The preset has
its own theme-aware Tag Manager brand icon from the vendored Simple Icons set.
Adding this preset does not publish containers, install tracking tags, grant
API access or allow `www.googletagmanager.com` scripts on unrelated websites.
Only this dashboard's exact origin is added to its Google session route catalog;
the existing sign-in, credential-consent and proxy-routing boundaries remain.

### Additional portal catalog

Provider-family modules keep the shared application selector and authentication
resolver small. All new presets start in manual mode; selecting one is not
credential or request-permission consent. All hosted presets fill a blank
connection with the reviewed HTTPS address, while preserving existing custom
addresses until **Use login address** is chosen. Self-hosted portals require the
actual deployment hostname and port; saved full-URL paths are retained.

- [Eight additional Google services](google-service-profiles.md): Ad Manager,
  AdSense, Forms, Gemini, Workspace Admin, Play Store, Google for Developers and
  Play Console reuse the existing opt-in Google Account flow. Play Store and
  Console have distinct entry paths, not separate origins.
- [International portals](international-portal-profiles.md): 23 entries including
  the requested account/developer, community, retail and monitoring services.
  These are manual-only presets, not verified automatic-login adapters. Zulip,
  Uptime Kuma, Wazuh and Zabbix retain administrator-configured deployment URLs.
- [Portuguese portals](portugal-portal-profiles.md): 12 manual-only customer and
  government-service entries. A distinct UZO Empresas portal was not verified;
  only my UZO is provided. Cegid Primavera uses the current myCegid customer entry.
- [RD Web Access](rd-web-access-login.md): opt-in classic HTML form login and a
  dedicated theme-aware icon. HTML5, federated and raw XML/XSL deployments are
  outside this adapter's verified contract.
- [OPNsense](opnsense-login.md): opt-in WebGUI form login preserving the real
  submitter and CSRF fields. TOTP and SSO stay interactive.

The new presets do not establish successful live authenticated login or remove
embedded-browser, routing, cookie or provider challenge restrictions. Their
tests exercise configuration, routing contracts and reviewed form fixtures.

### Amazon Shopping and AWS consoles

These are **manual-only website presets**: automatic login is not implemented,
and successful live authenticated sign-in has not been verified. Selecting any
of them fills a blank connection with its canonical HTTPS hostname and port 443;
an existing custom address, certificate policy and saved icon are preserved.
The explicit **Use [preset] login address** button replaces an existing address.
Selecting another application does not silently replace a populated address.

Amazon Shopping is **one application choice**. Its searchable **Amazon
marketplace** dropdown defaults to **Auto-detect from URL** and recognizes the
reviewed storefront hosts below (both `www` and apex spelling). Existing URLs
are retained; a blank connection starts at the United States / International
store. Choosing a country explicitly updates the saved HTTPS hostname and port
443. Switching back to Auto-detect leaves that URL in place. A mismatched manual
selection is rejected before connecting, rather than silently opening another
marketplace. Unknown domains, lookalikes, credential-bearing URLs and custom
ports are not accepted as a retail store.

Old saved `amazon-shopping-<country>` profile IDs normalize to `amazon-shopping`
with their original explicit marketplace. They remain usable without adding
duplicate application choices or changing passwords, TLS policy or icons.

The 23 retail storefronts were checked against Amazon's
[marketplace list](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids)
and [regional domain listing](https://developer-docs.amazon.com/sp-api/docs/seller-central-urls)
on 2026-10-06. Presets open the store homepage over HTTPS, letting the store's own
**Sign in / Account** link generate its current sign-in and return parameters.
Shipping destinations are not additional storefronts.

| Region | Shopping storefront hostnames |
| --- | --- |
| Europe | `www.amazon.co.uk`, `www.amazon.ie`, `www.amazon.de`, `www.amazon.fr`, `www.amazon.it`, `www.amazon.es`, `www.amazon.nl`, `www.amazon.com.be`, `www.amazon.se`, `www.amazon.pl`, `www.amazon.com.tr` |
| Americas | `www.amazon.com` (US / international), `www.amazon.ca`, `www.amazon.com.mx`, `www.amazon.com.br` |
| Asia-Pacific | `www.amazon.co.jp`, `www.amazon.in`, `www.amazon.com.au`, `www.amazon.sg` |
| Middle East and Africa | `www.amazon.ae`, `www.amazon.sa`, `www.amazon.eg`, `www.amazon.co.za` |

AWS website presets are separate from both shopping accounts and the app's AWS
access-key API integration:

| Console | Canonical entry point and identity boundary |
| --- | --- |
| Commercial | `https://console.aws.amazon.com/` — use the appropriate [root, IAM or federated identity](https://docs.aws.amazon.com/signin/latest/userguide/sign-in-urls-defined.html). IAM Identity Center uses the administrator-provided portal as a separate saved website. |
| China | `https://console.amazonaws.cn/` — use the [China account's console identity](https://docs.amazonaws.cn/en_us/aws/latest/userguide/console.html), not an automatically reused commercial account. |
| GovCloud (US) | `https://console.amazonaws-us-gov.com/` — use the [GovCloud identity](https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/configure-account.html), not a linked commercial account's credentials. |

Saved passwords, API keys, session tokens and automatic TOTP are not supplied by
these presets. There is no automatic credential forwarding between stores or
between shopping and AWS. MFA, CAPTCHA, passkeys, SSO, verification and account
recovery remain interactive. Amazon uses the detected/selected storefront's
HTTPS origin; each AWS preset pins its own exact HTTPS origin;
redirects and subresources remain subject to the connection's existing routing
and trust policy. No wildcard Amazon/AWS permission or direct-network fallback
is added. Rendered editor and contract tests prove preset behavior, not provider
acceptance of the embedded browser or completion of a real login.

### Adobe Admin Console, Instagram and Canva

All three start in **Manual** mode. Explicit **Automatic form login** may use
connection-local or selected vault credentials; selecting the profile never
grants permission to submit them. SSO, account/profile choice, MFA, CAPTCHA,
recovery and unsupported stages remain interactive. No live authenticated
account completion has been established by the public-source and fixture tests.

| Preset | Entry point | Opt-in assistance and evidence boundary |
| --- | --- | --- |
| Adobe Admin Console (`adobe-admin-console`) | [Admin Console](https://adminconsole.adobe.com/) | Reviewed English email-then-password flow at `https://auth.services.adobe.com/en_US/index.html`, from `#/` to `#/password`. Public staged controls were verified; synthetic fixtures exercise the bounded adapter. Other locales, SSO and account/profile choice are not automated. The separate **Adobe Account** (`adobe`) preset remains manual-only. |
| Instagram (`instagram`) | [Login](https://www.instagram.com/accounts/login/) | One username/password submission through a strict same-form adapter. Public HTML was unhydrated: the hydrated live controls and authenticated completion were not verified. Strict fixtures are not proof of current live-site compatibility. |
| Canva (`canva`) | [Login](https://www.canva.com/login/) | **Generic email/password form assistance only.** Public markup research was blocked by HTTP 403. No Canva-specific selectors or staged flow were verified. The helper does not open email login, advance identifier/code stages, or claim full automatic support. |

#### Exact first-party proxy route catalogs

The embedded session routes approved documents, resources and redirects through
the connection's native proxy/network path, with no direct-network fallback.
These are exact HTTPS origins on port 443, not wildcard/suffix grants. A resource
route is not a navigation or credential-release grant; unknown destinations stay
blocked. Routing approval never enables automatic login or weakens TLS checks.

| Profile/catalog | Document/login hosts | Resource-only hosts |
| --- | --- | --- |
| Adobe Admin Console — `src/utils/protocol/adobeHostedRoutes.json` | `adminconsole.adobe.com`, `auth.services.adobe.com`, `ims-na1.adobelogin.com` | `adobeid-na1.services.adobe.com`, `auth-api.services.adobe.com`, `auth-api-i.services.adobe.com`, `static.adobelogin.com`, `wwwimages2.adobe.com`, `bps-il.adobe.io`, `p13n.adobe.io` |
| Instagram — `src/utils/protocol/instagramHostedRoutes.json` | `www.instagram.com` | `static.cdninstagram.com` |
| Canva — `src/utils/protocol/canvaHostedRoutes.json` | `www.canva.com` | `static.canva.com` |

Adobe's staged credential grant is narrower than its route catalog: only the
reviewed English document on `auth.services.adobe.com` may receive the email and
then the password. IMS and resource routes do not receive that grant. Instagram
and Canva use ordinary form assistance, not Adobe/Google staged grants. The
explicit **Open original sign-in** action remains a separate system-browser
handoff, with the separate cookies and OS routing described above.

### ChatGPT and Claude

Both presets start in **Manual** mode. Opt-in assistance uses the saved
connection identity or an explicitly selected vault identity and requires the
canonical HTTPS host on port 443: `chatgpt.com` for ChatGPT, `claude.ai` for
Claude. Selecting a preset is not consent to submit credentials. API keys are
not website login credentials.

The bounded adapters recognize semantic login controls rather than relying on
unverified generated CSS classes. Their behavior is exercised with synthetic
fixtures; that is not verification of a completed live sign-in.

| Preset | Entry and bounded assistance | Manual boundaries |
| --- | --- | --- |
| ChatGPT (`chatgpt`) | [Website login](https://chatgpt.com/auth/login), with the recognized email/password stages on known OpenAI login paths, including `https://auth.openai.com/log-in` and its password stage. Unknown or ambiguous controls are not filled. | Social/enterprise SSO, verification codes, MFA, passkeys, recovery, CAPTCHA and unsupported stages. |
| Claude (`claude`) | [Website login](https://claude.ai/login). Email-only assistance requests a login link once; it does not retrieve a saved password. | Opening the emailed link or entering its verification code, Google/enterprise SSO, CAPTCHA and other verification. Claude has no dedicated account password. |

Public-source inspection on 2026-09-30 did **not** establish live authenticated
completion. Direct unauthenticated GETs returned HTTP 403 challenge pages;
the web text extractor exposed email/Continue entry controls for ChatGPT, not
raw field selectors or a verified password transaction. The challenge responses
exposed same-origin `/cdn-cgi/challenge-platform/` resources and
`https://challenges.cloudflare.com`, not an additional static/CDN allowlist.
Do not infer wildcard access, external identity-provider grants, or a browser
resource host from an email-sender domain. Exact proxy routing and challenge
handling do not authorize password delivery or bypass a provider challenge.

Sources: [OpenAI authentication origin](https://developers.openai.com/siwc/website),
[OpenAI login entry](https://auth.openai.com/log-in), and
[Claude login methods and password limitation](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account).

### PTisp customer login

Reviewed 2026-09-30 from the public [login page](https://my.ptisp.pt/login),
its [login component](https://my.ptisp.pt/static/js/40.3795390781c5148c36d7.js),
its [input component](https://my.ptisp.pt/static/js/140.9b1e136d96380dbdb798.js),
and the first-party app bundle linked from that page. Select **PTisp customer
area**, save the customer email/password (or choose a vault record), then
explicitly select **Automatic form login**.

The client waits for the Vue-rendered password form and submits once through
the site's own handler. The dashboard and its exact first-party API,
`https://api3.ptisp.pt`, use the connection's internal proxy/network path. The
API has separate certificate verification and receives only the page's own
API requests, not injected dashboard HTTP credentials or cookies. An API grant
is not a navigation grant to other websites.

The six-digit verification step, CAPTCHA, recovery and other challenges remain
interactive. Remember me is not changed. Incorrect-password responses do not
trigger repeated automatic attempts. Tests use synthetic credentials and
reduced public-form fixtures; a real account sign-in has not been verified.

## Self-hosted and device profiles

On-premises **Exchange Admin Center / ECP** also supports opt-in forms-based
login; see [Exchange ECP login](exchange-ecp-login.md) for its form contract,
proxy behavior and interactive authentication cases.

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

Adobe Admin Console reuses the Adobe icon; Instagram keeps its existing mark.
Canva has a dedicated local, theme-aware SVG C contour from the publisher's
[official icon asset ZIP](https://www.canva.dev/assets/connect/Canva-logos.zip),
reviewed 2026-09-30. It uses the central code/SVG catalog, not an emoji, remote
image request or generic browser badge. Selecting a profile only suggests the
icon; it never replaces a saved choice automatically.
