---
title: Additional Google website profiles
description: Public entry-point evidence and bounded Google Account sign-in for nine Google services.
---

# Additional Google website profiles

Reviewed on 2026-10-06. `GOOGLE_SERVICE_PROFILES` in
`src/utils/connection/googleServiceProfiles.ts` exports nine website presets.
They reuse `googleHosted` from `hostedDashboardProfiles.ts`: manual sign-in is
the default, with the existing Google Account adapter available only after
explicitly selecting form assistance. There are no new service-specific login
selectors, credential endpoints, identity-provider grants or API integrations.

This review used official public documentation and unauthenticated public
requests. No production account, password, authenticator secret or account
cookie was used. It did not complete sign-in, enroll an account, accept terms,
submit a form, purchase anything or publish an application. Entry-point evidence
and fixture tests do not establish that any of these services permits embedded
sign-in or that a complete authenticated dashboard works through the proxy.

## Entry points and primary evidence

| Profile ID               | Label                          | Saved public entry point                   |
| ------------------------ | ------------------------------ | ------------------------------------------ |
| `youtube-studio`         | YouTube Studio                 | <https://studio.youtube.com/>              |
| `google-ad-manager`      | Google Ad Manager              | <https://admanager.google.com/>            |
| `google-adsense`         | Google AdSense                 | <https://adsense.google.com/adsense/login> |
| `google-forms`           | Google Forms                   | <https://docs.google.com/forms/>           |
| `google-gemini`          | Google Gemini                  | <https://gemini.google.com/>               |
| `google-workspace-admin` | Google Workspace Admin console | <https://admin.google.com/>                |
| `google-play-store`      | Google Play Store              | <https://play.google.com/store/>           |
| `google-developers`      | Google for Developers          | <https://developers.google.com/>           |
| `google-play-console`    | Google Play Console            | <https://play.google.com/console/>         |

### YouTube Studio

[Google's YouTube Studio guide](https://support.google.com/youtube/answer/7548152?hl=en)
links the creator dashboard at `studio.youtube.com`. This preset is separate
from the consumer YouTube website and preserves the Studio URL through the
existing Google Account sign-in flow. It suggests the existing theme-aware
YouTube vector icon without overwriting a saved custom icon.

Manual sign-in remains the default; automatic form login requires explicit
opt-in. Account and channel selection, verification challenges, uploads,
publishing and monetization changes remain interactive. Public review of
`https://studio.youtube.com/` confirmed a Google Accounts identifier redirect
whose `continue` URL is `https://www.youtube.com/signin`, with a nested `next`
back to Studio. Studio therefore declares exactly `https://www.youtube.com` as
an extra document route through its own protected proxy alias. No credential
grant accompanies this route. `accounts.youtube.com` remains scoped to the
existing consumer YouTube profile; it was not demonstrated in this Studio
continuation. Live authenticated Studio access has
not been tested, so this preset does not establish that Google accepts the
embedded browser.

### Google Ad Manager

[Google's Ad Manager setup guide](https://support.google.com/admanager/answer/7084151?hl=en)
directs existing users to `admanager.google.com` to sign in and explains that
initial setup uses an AdSense account. An unauthenticated GET of the selected
entry returned HTTP 200; that is public availability evidence only.
This is the publisher inventory dashboard. It does not replace Google Ads,
AdSense or a Google Workspace administrator account. Network membership,
account activation and organization permissions remain Google's responsibility;
the preset does not create ad inventory or campaigns.

### Google AdSense

[Google's AdSense sign-in guide](https://support.google.com/adsense/answer/10190?hl=en)
specifies `https://adsense.google.com/adsense/login`. The public endpoint returned
HTTP 302 to `accounts.google.com/ServiceLogin` with the AdSense login URL as its
continuation. The preset stores the public service URL, without copying dynamic
identity-provider query parameters. The guide also explains that updated terms
can require acceptance after sign-in. Terms, publisher approval, identity and
payment checks remain interactive. The preset does not install advertising code
or supply publisher IDs, payment details or API keys as passwords.

### Google Forms

[Google's Forms guide](https://support.google.com/docs/answer/6281888?hl=en) and
[the official Forms product page](https://workspace.google.com/products/forms/)
link `forms.google.com`. Public navigation of that link reaches the Forms editor
on `docs.google.com`; the product page's sign-in link reached Google Accounts
with a continuation to `https://docs.google.com/forms/create?usp=direct_url`.
A direct request to the selected `https://docs.google.com/forms/` entry returned
HTTP 302 to `https://docs.google.com/forms/create`. The signed-out page identifies
Google Forms on the Google Account sign-in screen.

The saved origin is therefore the actual editor origin, avoiding an extra
document route for the short `forms.google.com` entry. Opening the entry can
lead to Google's new-form page after sign-in; this is not a promise of a
dashboard-only landing. Form creation, editing, response submission and sharing
are not automated by the preset. Form and organization permissions still apply.
The existing proxy grants origins, so a Forms connection is not isolated from
other paths on `docs.google.com`; no additional Drive or Forms API origins are
granted by this change.

### Google Gemini

[Google's Gemini usage guide](https://support.google.com/gemini/answer/13275745?hl=en)
directs desktop users to `gemini.google.com`. It distinguishes signed-out
features from those requiring a Google Account and describes work/school account
requirements. The public entry was available to the web research tool. A
separate Node HTTP probe failed with `UND_ERR_HEADERS_OVERFLOW`, so it is not
evidence of successful app transport or a successful Gemini session.

Account eligibility, availability, Workspace administrator policy and additional
verification remain with Google. This profile supplies neither prompts nor API
keys and does not grant AI Studio, Vertex AI or Gemini API destinations.

### Google Workspace Admin console

[Google's administrator sign-in guide](https://support.google.com/a/answer/182076?hl=en)
now redirects to the [Workspace knowledge-base article](https://knowledge.workspace.google.com/admin/getting-started/sign-in-to-your-admin-console).
It explicitly identifies `admin.google.com`, requires an administrator account,
and describes organization SSO. Personal Gmail sign-in does not provide
administrator privileges.

The standard public Admin console entry is known; it does not need a guessed
tenant hostname. An organization's external identity provider is not inferred
or added to the proxy catalog. SSO, account selection and additional verification
remain interactive and unlisted origins remain blocked. No users, devices,
domains, subscriptions or tenant policies are changed by selecting this profile.

### Google Play Store

[Google's desktop installation guide](https://support.google.com/googleplay/answer/16671014?co=GENIE.Platform%3DDesktop&hl=en)
directs users to `play.google.com` and describes the subsequent user-driven
selection and installation steps. Opening the selected
[store entry](https://play.google.com/store/) resolved to
`https://play.google.com/store/games` during public review.

This is the consumer storefront. Purchases, subscriptions and device installation
remain user actions. The profile neither buys content nor pushes applications to
a device. Publisher account management is represented separately by Play Console.

### Google for Developers

The [official developer homepage](https://developers.google.com/) identifies
Google for Developers and includes a sign-in action. The
[Google Developer Program FAQ](https://developers.google.com/profile/help/faq)
describes the program and profile features. Public documentation is readable
without signing in; an account and any required enrollment remain necessary for
account-specific features.

This preset opens the developer website, not a Cloud project, API credential
console or Play publisher account. Links to other developer product hosts do not
grant those hosts proxy routes or credential access. Program enrollment,
subscriptions and linked services are not automated.

### Google Play Console

[Google's Play Console setup guide](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en)
describes the Google Account, developer enrollment, verification and subsequent
app-management workflow. Google's [public Play business site](https://google.play/business/)
links the Console at `https://play.google.com/console/u/0/developers/`.
The selected public `https://play.google.com/console/` entry returned HTTP 301 to
`https://play.google.com/console/developers`; a signed-out request to the linked
`/console/u/0/developers/` path returned HTTP 302 to `/console/about`.
The web research tool ultimately reached `https://google.play/business/` for
signed-out console navigation.

The preset retains the console's `play.google.com` origin and does not grant
`google.play` just because it is a marketing redirect. That unlisted destination
remains blocked in the embedded session. The existing Accounts entry helper can
preserve the selected console URL as the sign-in continuation, but successful
return and authenticated Console behavior have not been verified. Enrollment,
fees, identity checks, invitations, release upload and publication remain user
actions. Store and Console have distinct entry paths but share one origin.

## Existing session and credential restrictions

The declarations reuse the existing reviewed Google adapter rather than deriving
form selectors from help articles. `known-form` refers only to that bounded
Google Account adapter, not a reviewed password form on each service. Google
[documents that embedded browsers may be refused](https://support.google.com/accounts/answer/7675428?hl=en).
Account chooser, CAPTCHA, passkeys, security keys, SSO, recovery, SMS, device
approval and unknown challenge pages remain interactive. The existing TOTP
metadata is reused only for its exact reviewed Google Account challenge.

The following existing code was inspected before declaring these profiles:

- `hostedDashboardProfiles.ts`: `googleHosted` provides HTTPS, `manual`/`form`
  choices, the `google` flow and the existing Accounts-only TOTP challenge.
- `httpApplicationProfiles.ts` and `httpApplicationLogin.ts`: missing login mode
  defaults to manual; manual mode emits no credentials and disables automatic
  login. Hosted targets must match their declared HTTPS origin. The staged flow
  rejects selector overrides and respects the existing credential-source logic.
- `googleProxySession.ts`: route manifests require exact upstream origins and
  distinct native-issued localhost aliases on the listener port. Resource-only
  routes cannot be used as documents. URL projection does not grant credentials.
- `src-tauri/crates/sorng-protocols/src/http_google.rs`: native and frontend code
  share the JSON catalog. Google automatic credential access is limited to
  `https://accounts.google.com` in Google form mode and uses the existing
  origin/document-bound grant. Service, resource and `www.google.com` routes do
  not thereby gain automatic credential access. The native session also refuses
  WebSocket upgrades; the presets do not claim to lift transport limitations.

The JSON change adds the nine IDs under `profiles`, each mapped to its
exact service origin, plus Studio's reviewed `www.youtube.com` document
continuation under `profileOrigins`. Existing login/resource origins are
unchanged. Only the YouTube and YouTube Studio profiles treat their declared
extras as documents; all other profile extras remain resource-only. No wildcard
hosts, tenant identity providers or direct-network fallbacks are introduced.
Unreviewed secondary requests and redirects must keep
failing closed. Complete post-login asset/API dependencies were not established;
missing routes must be reviewed separately, not guessed from a Google suffix.

Route selection is origin-based. Play Store and Play Console therefore get the
same route set, and both intentionally have no profile-specific extras. Native
code sorts profile IDs while the frontend uses JSON insertion order; identical
scope for these two entries avoids order-dependent permissions. This does not
claim a path-based security boundary between `/store/` and `/console/`.

Selecting a profile does not consent to credential release. The existing
**Open original sign-in** action is a separate, explicit system-browser handoff;
it uses separate cookies and the operating system's route, not the connection's
internal proxy. This change neither invokes that action nor treats it as an
automatic fallback or an authenticated-session import.

## Integration and validation

Central registration consumes `GOOGLE_SERVICE_PROFILES` and includes the nine
IDs above in `FIRST_PARTY_GOOGLE_HTTP_APPLICATION_IDS`. The shared registry,
login resolver, connection types, Application UI and icon files are outside this
module's scope. Suggested existing icon keys for central wiring: `google` for
Ad Manager, AdSense, Forms, Workspace Admin and Google for Developers; `bot` for
Gemini; `android` for Play Store and Play Console. These are catalog fallbacks,
not newly supplied product logos.

`tests/utils/googleServiceProfiles.test.ts` imports the exported array directly,
so its profile coverage does not depend on central registry integration. It
checks all nine entries, inherited adapter restrictions, exact route scope,
shared Play origin behavior, protected alias projection, rejection of missing
or expanded manifests, and rejection of resource-to-document promotion.

Validation command:

```powershell
node --max-old-space-size=4096 node_modules/vitest/vitest.mjs --run tests/utils/googleServiceProfiles.test.ts src/utils/protocol/googleProxySession.test.ts tests/protocol/googleAutologinClient.test.ts
```

Initial eight-service validation on 2026-10-06: 3 files passed, 58 tests passed.

YouTube Studio integration validation on 2026-10-06:

```powershell
npx vitest run tests/utils/googleServiceProfiles.test.ts tests/connectionEditor/GoogleServicePresets.test.tsx tests/protocol/GoogleServiceTargets.test.tsx tests/protocol/autologinAsset.test.ts tests/protocol/googleAutologinClient.test.ts
```

Result: 5 files passed, 148 tests passed. These are local profile, rendered
selector, route and login-client fixture checks; no live authenticated login
or complete native browser session is claimed.

Studio continuation correction on 2026-10-06: rerunning the five suites above
plus `src/utils/protocol/googleProxySession.test.ts` passed all 154 tests across
6 files. Coverage includes the observed YouTube `/signin` continuation with its
nested Studio URL, separate protected aliases, and rejection of missing or
resource-only continuation routes. Targeted ESLint, Prettier, diff checks and
`rustfmt --check --edition 2021 src-tauri/crates/sorng-protocols/src/http_google.rs`
passed.

Independent integration review also included
`tests/protocol/originBrowserConnectionTarget.test.ts`: all 161 tests passed
across 7 files. The native Google proxy suite passed 45 tests, with one opt-in
public navigation diagnostic not run. Native coverage includes exact Studio
route scope and preserving the nested Studio target through the YouTube
sign-in continuation's separate protected alias.

```powershell
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib http::google_tests --locked
```

Live authenticated browser acceptance remains unverified.
