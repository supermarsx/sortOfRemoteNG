---
title: International portal profiles
eyebrow: Website connections
description: Supported international website profiles and authentication boundaries.
permalink: /international-portal-profiles/
---

# International portal profiles

Public-source review: 2026-10-06. Scope: the original 21 services in the
INTERNATIONAL lane plus the requested Wazuh and Zabbix additions, 23 total.
The implementation is
`src/utils/connection/internationalPortalProfiles.ts`, exporting
`INTERNATIONAL_PORTAL_PROFILES: readonly HttpApplicationProfile[]`.
`tests/utils/internationalPortalProfiles.test.ts` consumes that export directly.
Central registry, editor, authentication, types and icon integration belong to
the main lane and are not changed here.

## Capability and evidence boundaries

Every entry has `capability: "manual"`, `loginModes: ["manual"]` and
`requiresHttps: true`. No entry supplies selectors, a login adapter, automatic
MFA challenges or email-only assistance. Reading an official help page or a
public sign-in page establishes a destination, not a reviewed automation
contract. No account was used, no credential was submitted, and no successful
sign-in, account dashboard, entitlement, device operation or embedded-browser
compatibility is claimed.

The module imports the core profile as a type only. Importing it performs no
network requests or credential resolution. Its metadata adds no proxy bypass,
direct-network fallback, redirect trust, credential consent, wildcard host
grant or script/request permission. Existing application proxy routing and
consent checks must continue to govern primary requests, secondary requests and
redirects. A public destination or a documented identity provider is not an
authorization to grant it credentials or bypass that routing. This lane does
not add automatic external-browser handoff; any existing explicit handoff has
its own browser cookies and network route and is not evidence of app-proxy use.

## Duplicate review

Before adding the module, the existing core catalog and profile modules were
searched for every requested brand and service. No exact requested profile ID
was present. Related entries were retained:

- `icloud` is for iCloud data; Apple Account is for identity management, and
  Apple Developer is for developer membership/resources.
- `hpe-greenlake` and the native iLO profile are separate from HPE Support Center.
- `outlook-online` and Exchange profiles are separate from the Microsoft
  personal account and public developer hub.
- `nginxProxyMgr` is Nginx Proxy Manager, not the npm package registry.
- `network-solutions` already exists. The requested `register-com` entry is an
  explicit legacy-brand alias with the same canonical Account Manager URL,
  reflecting the official consolidation. It is intentionally not presented as
  a second authentication service. Main integration can retain this requested
  discovery name without creating another Network Solutions profile ID.
- Wazuh and Zabbix had no entries in the existing website profile modules when
  the follow-up was assessed. Wazuh already had a catalog icon; Zabbix did not.

## Complete destination and icon handoff

Icon keys below were checked against the existing catalog. They are suggestions
only; this lane does not edit icon files. Generic keys are intentionally used
where there is no matching brand in the catalog.

| Requested service                 | Profile ID            | Category     | Public entry / configured path                      | Suggested existing icon key |
| --------------------------------- | --------------------- | ------------ | --------------------------------------------------- | --------------------------- |
| Apple Account / Apple ID          | `apple-account`       | `custom`     | `https://account.apple.com/`                        | `apple`                     |
| Apple Developer                   | `apple-developer`     | `business`   | `https://developer.apple.com/account/`              | `apple`                     |
| register.com                      | `register-com`        | `networking` | `https://www.networksolutions.com/my-account/login` | `network-solutions`         |
| No-IP                             | `no-ip`               | `networking` | `https://www.noip.com/login`                        | `noip`                      |
| Microsoft personal online account | `microsoft-account`   | `custom`     | `https://account.microsoft.com/`                    | `microsoft`                 |
| Microsoft developer portal        | `microsoft-developer` | `business`   | `https://developer.microsoft.com/en-us/`            | `microsoft`                 |
| HPE customer/support portal       | `hpe-support`         | `management` | `https://support.hpe.com/connect/login`             | `hpe`                       |
| Notion                            | `notion`              | `business`   | `https://app.notion.com/login`                      | `file-text`                 |
| Zulip                             | `zulip`               | `business`   | User's organization host + `/login/`                | `zulip`                     |
| Arlo                              | `arlo`                | `monitoring` | `https://my.arlo.com/`                              | `camera`                    |
| Uptime Kuma                       | `uptime-kuma`         | `monitoring` | User's deployment host + `/dashboard`               | `activity`                  |
| Steam                             | `steam`               | `custom`     | `https://store.steampowered.com/login/`             | `web-application`           |
| Autodesk                          | `autodesk`            | `business`   | `https://manage.autodesk.com/`                      | `web-application`           |
| Kimi                              | `kimi`                | `business`   | `https://www.kimi.com/`                             | `bot`                       |
| Lovable                           | `lovable`             | `business`   | `https://lovable.dev/login`                         | `code-editor`               |
| npm                               | `npm`                 | `business`   | `https://www.npmjs.com/login`                       | `package`                   |
| PyPI                              | `pypi`                | `business`   | `https://pypi.org/account/login/`                   | `package`                   |
| Reddit                            | `reddit`              | `custom`     | `https://www.reddit.com/login/`                     | `messages`                  |
| Tesla                             | `tesla`               | `custom`     | `https://www.tesla.com/teslaaccount`                | `web-application`           |
| eBay                              | `ebay`                | `custom`     | `https://signin.ebay.com/signin/`                   | `storefront`                |
| X                                 | `x`                   | `custom`     | `https://x.com/login`                               | `messages`                  |
| Wazuh                             | `wazuh`               | `monitoring` | User's dashboard host + `/`                         | `wazuh`                     |
| Zabbix                            | `zabbix`              | `monitoring` | User's full frontend URL, no fixed path             | `activity`                  |

## Primary evidence and per-service limits

1. **Apple Account.** [Apple's sign-in guide](https://support.apple.com/en-us/111001)
   explicitly distinguishes managing an account at account.apple.com from using
   iCloud.com, and identifies Apple Account as the renamed Apple ID.
   [The account entry](https://account.apple.com/) returned the expected page
   title but no extractable application body. Identity verification and trusted
   device interaction have not been exercised.

2. **Apple Developer.** [Apple's roles and access guide](https://developer.apple.com/help/account/access/roles/)
   links the developer account landing page and explains team-role access to
   membership resources. Opening [the account entry](https://developer.apple.com/account/)
   redirected to Apple's `idmsa.apple.com` authentication, which the research
   tool could not retrieve. The preset retains `/account/`, without copying
   authentication query parameters or authorizing that identity-provider origin.

3. **register.com.** [Register.com's own landing page](https://www.register.com/)
   advertises the consolidation and links the
   [Network Solutions announcement](https://www.networksolutions.com/blog/registerdotcom-becomes-network-solutions/).
   Opening [the legacy Account Manager path](https://www.register.com/my-account/login)
   redirected to `https://www.networksolutions.com/my-account/login`.
   That canonical destination is shared with the existing `network-solutions`
   profile. No password form or migrated customer account was tested.

4. **No-IP.** [The official account login](https://www.noip.com/login)
   exposes a username/email and password sign-in page and links Dynamic DNS,
   account support and DDNS-key documentation. This supports the public entry,
   not automatic form submission; no controls or hidden-token contract are
   adopted. DDNS update credentials are not injected into the portal.

5. **Microsoft personal account.** [Microsoft's account sign-in guide](https://support.microsoft.com/en-us/accounts-billing/manage/how-to-sign-in-to-a-microsoft-account)
   explicitly names account.microsoft.com for personal accounts and
   myaccount.microsoft.com for work/school accounts. Opening
   [the personal account entry](https://account.microsoft.com/) produced an
   account landing redirect. Only the stable root is saved, without generated
   navigation query parameters; account choices and verification remain manual.

6. **Microsoft Developer.** [Microsoft's public developer hub](https://developer.microsoft.com/en-us/)
   supplies tools, documentation and links to multiple developer programs.
   The unlocalized root redirected to `/en-us/`. The request did not specify
   Partner Center, Azure or a Microsoft 365 Developer Program tenant, so this
   preset opens the actual general hub. It does not invent a shared developer
   login endpoint or claim enrollment in any program. Program-specific
   navigation and authentication remain interactive.

7. **HPE Support Center.** [The official Support Center login](https://support.hpe.com/connect/login)
   returned its HPE Support Center title and account-choice controls.
   [The support landing page](https://support.hpe.com/connect/s/) is a separate
   client-rendered destination. The customer-support entry does not reuse
   GreenLake or hardware-management credentials; support entitlements and
   federated sign-in have not been exercised.

8. **Notion.** [Notion's browser guide](https://www.notion.com/help/notion-for-web)
   directs users to its website login.
   [The documented login route](https://www.notion.com/login) redirected to
   `https://app.notion.com/login`, which is the saved canonical entry.
   [Notion's sign-in help](https://www.notion.com/en-gb/help/log-in-and-out)
   describes email verification, passwords, SAML, linked providers and passkeys.
   None of those branches is automated, including third-party Google sign-in.

9. **Zulip.** [Zulip's login guide](https://zulip.com/help/logging-in)
   instructs users to obtain their organization's URL and documents the
   organization-relative `/login/` route. Administrators control which login
   methods are enabled. The profile has no `hostedLoginUrl`: enter the exact
   organization hostname and HTTPS port from an invitation or administrator.
   Both cloud tenants and self-hosted organizations are supported as configured
   destinations. No `zulip.com` central login, wildcard tenant grant, guessed
   organization name or public community server is selected.

10. **Arlo.** [Arlo's multiple-device sign-in guide](https://kb.arlo.com/000063143/)
    names my.arlo.com and explains its account login.
    [Trusted-browser documentation](https://kb.arlo.com/000062596/How-to-add-a-trusted-browser-to-your-Arlo-account)
    requires interactive authentication and trust approval. Direct retrieval of
    my.arlo.com failed in the research tool; the destination is documentation
    backed. Streaming, microphone access, camera control and browser trust were
    not tested.

11. **Uptime Kuma.** The project's
    [router source](https://github.com/louislam/uptime-kuma/blob/master/src/router.js)
    (also read through its [raw source](https://raw.githubusercontent.com/louislam/uptime-kuma/master/src/router.js))
    defines `/dashboard` separately from `/status` and `/status/:slug`.
    Its [reverse-proxy guide](https://github.com/louislam/uptime-kuma/wiki/Reverse-Proxy)
    requires WebSocket handling and recommends a dedicated domain/subdomain
    rather than a subdirectory. The preset has no `hostedLoginUrl`: configure
    your own HTTPS host and port. `/dashboard` is a navigation route, not an
    invented `/login` form. No public demo, localhost fallback, port-3001
    assumption or deployed instance was used. Source was read at the review
    date; version-specific behavior and socket/proxy compatibility need an
    actual authorized deployment check.

12. **Steam.** [Valve's account help](https://help.steampowered.com/en/faqs/view/1DED-79C6-0568-A72C)
    explicitly links `https://store.steampowered.com/login/`.
    [That entry](https://store.steampowered.com/login/) returned sign-in page
    metadata with a limited extracted shell. There is no Steam Guard, QR,
    password or device-approval automation and no Steam client integration.

13. **Autodesk.** [Autodesk's account overview](https://www.autodesk.com/support/account/manage/use/explore/)
    describes account management and
    [its portal troubleshooting guide](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Unable-to-open-Autodesk-account-portal.html)
    explicitly names manage.autodesk.com. Opening that root in the research
    tool hit a redirect loop. The entry is documentation backed; no embedded
    sign-in success, product activation or entitlement access is claimed.

14. **Kimi.** [The official Kimi web application](https://www.kimi.com/)
    exposes chat/workspace content and a sign-in action. The application root
    is the entry; no separate login pathname is inferred from a button.
    This preset covers the web application, not the developer API console or
    Kimi Code device authorization. Regional authentication and account
    verification remain manual.

15. **Lovable.** [Lovable's login page](https://lovable.dev/login)
    returned a login title with a loading shell.
    [The official quick start](https://docs.lovable.dev/introduction/getting-started)
    establishes the product workspace. A script-rendered shell is insufficient
    for selector or identity-provider assumptions. No project was created,
    connected to another service, or published.

16. **npm.** [npm's two-factor documentation](https://docs.npmjs.com/configuring-two-factor-authentication/)
    links its website Sign In page and documents security-key/recovery behavior.
    Direct retrieval of `www.npmjs.com/login` returned HTTP 403, so the preset
    relies on official documentation for that entry and adopts no form
    selectors. npm CLI and registry publishing tokens remain separate from
    browser credentials. The existing Nginx Proxy Manager profile is unrelated.

17. **PyPI.** [PyPI's official login page](https://pypi.org/account/login/)
    returned its username/password page and Python Software Foundation footer.
    No submission contract was reviewed or exercised, and no MFA automation is
    supplied. Upload tokens and trusted-publishing identities are not used for
    website sign-in.

18. **Reddit.** [Reddit's sign-in guide](https://support.reddithelp.com/hc/en-us/articles/28620245447572-How-do-I-log-in-and-out-of-my-Reddit-account)
    explains the distinct login methods.
    [The official login page](https://www.reddit.com/login/) exposed email or
    username, phone, one-time-link and verification UI text. That public page
    content is not evidence of an authenticated session, and no selectors,
    automatic codes, posts or community actions are included.

19. **Tesla.** Opening [Tesla Account](https://www.tesla.com/teslaaccount)
    redirected to Tesla's OAuth authorization service at auth.tesla.com.
    [Tesla's account-security guidance](https://www.tesla.com/support/tesla-account-security)
    describes account verification and third-party API access. The preset keeps
    the stable account URL, not generated OAuth parameters, scopes or tokens.
    It grants no vehicle control, energy-product access or Fleet API authority.

20. **eBay.** [eBay's sign-in help](https://www.ebay.com/help/account/signing-account/signing-account?id=4189)
    links its sign-in service and describes password, linked-provider and
    passkey branches. Opening [signin.ebay.com](https://signin.ebay.com/)
    redirected to the selected `/signin/` path and exposed its account-entry
    form text. Region-specific navigation still needs normal redirect review.
    No buying, selling, payment or account changes were performed.

21. **X.** [X's web-account guide](https://help.x.com/en/using-x/create-x-account-mobile)
    explicitly supplies `https://x.com/login`.
    [The login-help page](https://help.x.com/en/using-x/log-in-issues) describes
    account-access challenges. Direct login-page retrieval failed in the
    research tool. The stable documented route is used; a current internal
    flow path is not guessed, and no API authorization, posting or credential
    automation is provided.

22. **Wazuh.** [Wazuh's quickstart](https://documentation.wazuh.com/current/quickstart.html)
    specifies the dashboard's HTTPS host as the web entry.
    [The dashboard installation guide](https://documentation.wazuh.com/current/installation-guide/wazuh-dashboard/step-by-step.html)
    distinguishes the dashboard address from the Wazuh server API connection.
    The profile uses `/` on a user-configured HTTPS hostname and port, with no
    central cloud URL, default credentials or certificate-trust exception.
    A complete saved URL can select a customized deployment path for embedded
    navigation. No deployed login form or version-specific control source was
    reviewed; the page guidance is not enough to justify form automation.
    SSO, certificate review, role selection and verification stay interactive.

23. **Zabbix.** [Zabbix's current frontend login guide](https://www.zabbix.com/documentation/current/en/manual/quickstart/login)
    documents `/zabbix` for Apache and `/` for Nginx.
    [Zabbix's HTTP authentication documentation](https://www.zabbix.com/documentation/8.0/en/manual/web_interface/frontend_sections/users/authentication/http)
    also distinguishes the ordinary login form from web-server authentication.
    The profile intentionally sets neither `hostedLoginUrl` nor `loginPath`:
    configure the actual complete frontend URL and port supplied by the
    administrator. This preset requires HTTPS, including when adapting the
    documentation's HTTP examples. No public demo, default credentials, forced
    `/index.php` route, Basic fallback or selectors are added. Source evidence
    establishes deployment-specific navigation, not safe automated submission
    across Zabbix versions, LDAP, SAML and HTTP-auth configurations.

## Verification and integration handoff

The focused suite checks all 23 IDs, the 19 exact hosted destinations, all four
configurable-host profiles, categories, HTTPS/manual-only capabilities, absence of
selectors/MFA/adapters, and an allowlist of metadata keys that excludes network
or permission overrides. Tenant-path checks use reserved `.test` hosts and a
nondefault port, without making requests. Tests are independent of registry
integration and do not claim runtime proxy behavior or live login acceptance.

The central catalog now imports and spreads `INTERNATIONAL_PORTAL_PROFILES`;
this was confirmed by reading `httpApplicationProfiles.ts` after main's
integration. Main owns the existing-icon mapping, and the Portugal lane owns
cross-array runtime and editor integration tests. Those broader test results
are not claimed by this module's suite.

Preserve all four tenant/self-hosted hosts as user-configured values. Treat the
Microsoft Developer entry as a general hub and register.com as a documented
alias when presenting them. Do not promote any entry to form automation,
inherit Google automation for a third-party login button, or add trust grants
from this public URL evidence alone.

Local validation on 2026-10-06:

- `npm test -- tests/utils/internationalPortalProfiles.test.ts`: 49 tests passed,
  including the rerun after central registration.
- `npx eslint src/utils/connection/internationalPortalProfiles.ts tests/utils/internationalPortalProfiles.test.ts`:
  passed after central registration.
- Prettier and whitespace checks cover only the three assigned files.
- The repository `tsc --noEmit --incremental false --pretty false` check passed
  during the initial implementation, before central registration. That result
  does not replace validation of subsequent shared integration changes.

For Zabbix, preserve the complete saved frontend URL (`/zabbix`, `/` or the
administrator's custom deployment path). Current `useWebBrowser` initial
navigation honors `parseCanonicalWebAuthority(...).initialPathname` for profiles
without a hosted URL. Main has updated `getHttpApplicationExternalTarget` to
preserve a non-root saved pathname for non-hosted profiles, while excluding
query strings and fragments and retaining the saved-origin checks. This
replaces the previously documented Zabbix subdirectory limitation. Source
inspection also confirmed six added cases in
`tests/protocol/httpApplicationExternal.test.ts`, covering Zabbix, Wazuh, Zulip,
Uptime Kuma, OPNsense and RD Web. Main owns the final execution and integration
check for that shared change; this lane verified the implementation and test
additions by inspection, without claiming their final test result.
