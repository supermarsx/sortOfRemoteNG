---
title: Synology browser and NAS API views
description: Choose the DSM website or Synology NAS API and understand its authentication status.
---

# Synology browser and NAS API views

Choose **HTTP** or **HTTPS**, then **Protocol → Application → Synology DSM**.
Synology is an application, not a transport protocol. Choose either the DSM
website or **Synology NAS API**. Existing saved Synology records
remain readable; editing and saving them uses the HTTP(S) application format.

## QuickConnect and reviewed website redirects

In **Protocol → Application → Synology access**, **Allow reviewed redirects to
another address** is off by default. Enable and save it when a DSM website or
reverse proxy needs a different address. This is the same saved setting as
**Advanced → Internal proxy controls → Allow reviewed cross-origin redirects**;
it does not enable HTTP downgrades or login forwarding.

Up to five top-level GET/HEAD handoffs can be reviewed, one destination at a
time. Continue in the current tab or open an anonymous tab. Each HTTPS
destination has a fresh certificate/trust check. Query parameters and fragments
are removed, cookies are not carried over, and form POSTs are never replayed.
Saved-login forwarding requires its own separate settings and review; some
portal or SSO flows therefore still require manual sign-in.

If an HTTPS server temporarily redirects to HTTP, **Allow insecure redirects**
is a separate explicit exception. **Require HTTPS upstream** still blocks it.
No QuickConnect hostname receives an automatic exception. Prefer the secure
final DSM address when available.

These options are for **Website — DSM in browser**, not **Synology NAS API**.
Switching to API mode hides the website aliases without changing their saved
values. The native API client has its own anonymous QuickConnect resolver; it
does not follow the browser's reviewed multi-hop handoffs or inherit its login.

## DSM website sign-in

Choose **DSM website** and **Manual browsing** to sign in yourself without
providing saved credentials to the website proxy. Saved API credentials do not
become a website session, and website cookies do not sign the API view in.

For the reviewed DSM 7 desktop login, use an HTTPS address, save the website
username/password, and explicitly select **Automatic form login**. The app
fills the username and clicks Next, waits for the matching password panel, then
fills the password and clicks Sign in. Each credential is released to the page
once. It never fills the hidden password control on the username screen, selects
“remember me,” clicks Sign in twice, or retries a rejected password. Advanced
selector, timing, extra-field and fill-only overrides are not supported by this
fixed staged flow. Other DSM layouts remain manual.

For a **saved** QuickConnect connection using **Automatic form login**, the
original login can resume after approved same-NAS HTTPS handoffs. The native
proxy waits for matching NAS identity evidence and a successful primary DSM
login page before making that original form login available. QuickConnect
portals remain anonymous: the redirected connection does not receive a copied
password/profile, HTTP Authorization, or another origin's cookies. This is not
general saved-login forwarding, automatic 2FA consent, or proof of sign-in.

After updating the app, changing the original credentials or database/vault
access, or letting the attempt expire, **close the tab and reopen the original
saved connection**. Reloading the anonymous redirected tab does not recover an
expired or cancelled login intent. An unsaved connection must first be saved and
reopened before Automatic form login can continue across redirects.

### How the helper waits for DSM

DSM's sign-in page is a single-page app that keeps starting up after the browser
has loaded the document. The page helper therefore treats normal start-up
changes as waits, not failures:

- It starts once the document is interactive. A slow wallpaper or image that
  holds the browser's load event does not delay it.
- It acts only when the reviewed controls are visible, have a real size and are
  editable, and the login panel has not changed for 400 milliseconds. If the
  panel keeps changing while the same controls stay in place, it proceeds after
  3 seconds.
- It finds the controls again after every change instead of keeping the first
  ones it saw. When DSM re-renders or replaces the form, the helper uses the
  current controls and refills a dropped value, with at most three writes per
  field. A credential reply that arrives after a re-render is filled only into
  a current field that still matches the reviewed form, route and account.
- Route changes while DSM starts, such as `#/` to `#/signin`, are waits. The
  username step acts only on an empty, `#/` or `#/signin` route; the password
  step acts only on `#/signin/password`.
- A CAPTCHA stops the helper only when a visible CAPTCHA input or frame is
  inside the displayed DSM login form. Empty, hidden or unrelated elements
  elsewhere on the page are ignored.
- If DSM replaces Next before advancing and nothing happens for 8 seconds, the
  helper clicks Next once more. Sign in is never clicked twice.
- Typing, pasting or deleting in the login form before Sign in stops the helper
  so it never overwrites your input. Ticking a checkbox does not.

Security refusals still stop at once: a form that would send data to an
unreviewed action or target, and a password step whose account does not match
the saved username (compared trimmed and case-insensitively).

### Time limits

Each layer has its own limits, and the page helper's limits end before the
native grants they depend on. The helper's idle limit restarts whenever the
page makes progress: the document's load state or route changes, login controls
appear or change, or the next stage starts.

| Layer                | Limit                                                                                                                                    | Result when it runs out                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Embedded view        | 30 s for a page document to start                                                                                                        | Page-load error                                                                         |
| Embedded view        | 120 s from each document start, including each redirect or relay hop; 300 s in total for one load                                        | Page-load error, cleared automatically if that same page then finishes loading          |
| Page helper          | 60 s without progress, 240 s in total, until the login form is ready                                                                     | **page never became ready** or **login form never appeared**                            |
| Page helper          | 45 s after DSM loads or last changes while its login controls do not match                                                               | **login layout not recognized**                                                         |
| Page helper          | 30 s for each credential request                                                                                                         | **deadline reached**                                                                    |
| Page helper          | 85 s from the username reply to clicking Sign in                                                                                         | **Next did not advance**, **password step never appeared** or **Sign in never enabled** |
| Page helper          | 30 s watching the page after Sign in                                                                                                     | **reported submission**                                                                 |
| Page helper          | 20 s of a visible DSM desktop with no login form                                                                                         | **already signed in**                                                                   |
| Native, direct       | Username grant: 300 s from when each DSM page is served; never renewed                                                                   | Grant refused: **saved credentials unavailable**                                        |
| Native, QuickConnect | Routing intent: 120 s until the first verified NAS hop; each verified hop or reviewed handoff renews it to 300 s, at most 900 s in total | Native status **expired**                                                               |
| Native, QuickConnect | Username grant: 300 s from the latest DSM page, at most 600 s from the first                                                             | Native status **expired**                                                               |
| Native, both         | Password grant: 90 s from username release                                                                                               | Grant revoked; the page helper's 85-second limit ends first                             |

After a page-load error, a page that starts later is not adopted; reload the
tab. No app or native limit applies once the password has been released, so a
2FA or approval step after Sign in is not timed by the app.

### QuickConnect and direct addresses

Both paths release each credential once, and only to the DSM page the tab is
currently showing. Frames inside that page can neither use nor cancel its grant.

With a **direct address** (LAN, DDNS or a reverse-proxy root URL), each DSM page
the proxy serves before the username is released gets its own one-use username
grant for 300 seconds. Once the tab shows a newer DSM page, the previous page's
grant stops working. After the username is released, no new page receives a
grant, and the password is held for 90 seconds for the page that received the
username. Switching to a different page document, or accepting a reviewed
redirect, revokes it permanently.

With **QuickConnect**, the saved connection first holds a routing intent while
you review the handoffs. Each verified same-NAS hop renews it, so reviewing
redirects at your own pace does not use up the attempt. The first DSM login page
the app opens on the verified NAS binds the username grant. Until the username
is released, a reload or DSM's own follow-up page at `/` or `/webman/index.cgi`
on that NAS rebinds the attempt with a fresh grant, stops the old page's grant
and restarts the 300-second window, up to 600 seconds from the first bind. After
the username is released, moving to a different page document cancels the
attempt.

After the password is released, the native side no longer limits or cancels the
attempt, and the QuickConnect status reads **credentials released**. If DSM goes
straight from the username to Secure SignIn approval without a password step, a
QuickConnect status refresh reads **expired** 90 seconds after the username was
released. That describes only the unused password grant, not your DSM session.

### Auto-fill status

A saved Synology form login shows its status after **Connected to** in the
website connection bar. Hover it, or the account icon beside the address, for
details. Clicking either refreshes the native snapshot; it only reads native
state and does not restart a stopped login. Every status is advisory page or
native state, not proof of sign-in.

| Status                                                                                                           | Meaning                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Auto-fill: awaiting NAS**                                                                                      | QuickConnect is still reaching the verified NAS.                                                                           |
| **Auto-fill: page helper unconfirmed**                                                                           | The native attempt is waiting for the DSM form, but the page has not reported progress yet.                                |
| **Auto-fill: waiting for page**, **waiting for DSM**, **finding DSM**                                            | DSM is still loading or settling its route. This is not a failure.                                                         |
| **Auto-fill: finding login form**, **username not ready**, **checking login form**                               | The login controls are appearing or settling.                                                                              |
| **Auto-fill: requesting username**, **filling username**, **waiting for Next**                                   | The username step is in progress.                                                                                          |
| **Auto-fill: waiting for password step**, **requesting password**, **filling password**, **waiting for Sign in** | The password step is in progress.                                                                                          |
| **Auto-fill: signing in**                                                                                        | Sign in was clicked; the page is watched for up to 30 seconds.                                                             |
| **Auto-fill: signed in**                                                                                         | After Sign in, the login form went away and DSM left its sign-in routes.                                                   |
| **Auto-fill: already signed in**                                                                                 | DSM showed its desktop instead of a sign-in page. No credential was requested.                                             |
| **Auto-fill: filled — …**                                                                                        | DSM is asking for an interactive step; see [two-factor and Secure SignIn steps](#two-factor-and-secure-signin-steps).      |
| **Auto-fill: sign-in rejected — DSM showed an error**                                                            | DSM stayed on the password step with an error or a cleared password. Nothing was retried; check the saved password.        |
| **Auto-fill: reported submission**                                                                               | Sign in was clicked, but within 30 seconds the page neither left sign-in nor showed an error. Check the page.              |
| **Auto-fill: stopped — …**, **Auto-fill: timed out — …**                                                         | The attempt ended for the named reason; see [stop and timeout reasons](#stop-and-timeout-reasons).                         |
| **Auto-fill: cancelled**                                                                                         | The page closed or navigated away before Sign in.                                                                          |
| **Auto-fill: waiting for password**, **credentials released**, **expired**, **cancelled**                        | QuickConnect native snapshot. **Expired** and **cancelled** replace the page status; reopen the original saved connection. |
| **Auto-fill: details limited**                                                                                   | The page changed too often to report every step; the final result is still reported.                                       |
| **Auto-fill: access changed**                                                                                    | The original login access changed. Reopen the original saved connection.                                                   |

**Signed in** and **already signed in** are inferred from the page; they are not
native proof of authentication. **Signed in** is confirmed at once when the DSM
desktop appears, and otherwise only after the sign-in page has stayed gone for 2
seconds, so a splash re-render does not count. **Already signed in** needs a
visible DSM desktop with no login form for 20 seconds before any credential is
requested. A start-up splash or empty page is never taken as a session, so a
slow QuickConnect start keeps waiting. The desktop is recognized by best-effort
markers (`#sds-desktop`, `#sds-taskbar` and the matching classes) that were not
checked against a live NAS. If your DSM desktop has none of them, an already
signed-in tab ends as **timed out — page never became ready** instead. No
credential is requested in either case.

### Two-factor and Secure SignIn steps

With 2FA or Secure SignIn on, DSM's extra step is the normal path. The helper
therefore ends with a hand-off, not an error, as soon as DSM routes to that
step: after Next, during the password step or after Sign in. An unrecognized
`#/signin/…` step is handed off after 3 seconds.

| Status                                                     | What to do                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Auto-fill: filled — enter your 2FA code**                | Type the one-time code from your authenticator app on the page, or copy it from **2FA Codes** in the navigation bar.          |
| **Auto-fill: filled — Automatic 2FA is entering the code** | The same code step, with Automatic 2FA enabled for this connection. It enters the code separately; if not, use **2FA Codes**. |
| **Auto-fill: filled — approve sign-in in Secure SignIn**   | Approve the sign-in request in Synology Secure SignIn on your device.                                                         |
| **Auto-fill: filled — choose a sign-in method**            | Choose how DSM should verify this sign-in.                                                                                    |
| **Auto-fill: filled — use your passkey**                   | Use your passkey or hardware security key.                                                                                    |
| **Auto-fill: filled — finish sign-in on the page**         | Complete the remaining DSM step on the page.                                                                                  |

The tooltip says whether DSM asked after the username step, during the password
step or after Sign in. The DSM sign-in helper itself never enters a 2FA code,
approves a sign-in or uses a passkey, and typing your code after the hand-off
does not affect it.

Authenticator codes can be entered manually. To opt into automatic codes, add
the account's authenticator in the connection's 2FA settings, then select
**Automatic 2FA → DSM 7 verification code**, choose that authenticator, enable
codes for the displayed HTTPS origin, and save the connection. This is separate
consent: choosing DSM or enabling password login does not enable automatic 2FA.
The app sends at most one code to the reviewed OTP panel and never selects
“trust this device.” Submission is not proof of successful sign-in. The
**Automatic 2FA is entering the code** status reflects that this setting is on
and that DSM reached its code step; it does not confirm that a code was entered
or accepted.

CAPTCHA, Approve sign-in, security keys/passkeys, account recovery and password
changes remain interactive. Use the explicit original-origin browser action
when the embedded view cannot complete them. That browser has separate cookies
and does not sign in the embedded session. See Synology's
[two-factor authentication instructions](https://kb.synology.com/en-global/DSM/help/DSM/SecureSignIn/2factor_authentication?version=7).

### Stop and timeout reasons

Each status below begins with **Auto-fill:** and names its cause after the dash.
None of them retries a login. Unless the row says otherwise, finish signing in
on the page, or close the tab and reopen the original saved connection to start
a new attempt.

| Status (reason)                                                                | Cause and what to do                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **stopped — CAPTCHA required** (`captcha-required`)                            | DSM shows a CAPTCHA in the login form. Complete it and sign in on the page.                                                                                                                        |
| **stopped — manual input detected** (`user-input-detected`)                    | You typed in the login form before Sign in. Finish signing in yourself.                                                                                                                            |
| **stopped — unsafe form target** (`unsafe-form-target`)                        | The form would send data to an unreviewed action or target, so nothing was filled. Sign in manually and check for a customized login page.                                                         |
| **stopped — account mismatch** (`account-mismatch`)                            | The password step shows a different account from the saved username. Check the saved username.                                                                                                     |
| **stopped — left the login page** (`left-login-page`)                          | The address path, query or origin changed for 2 seconds before sign-in finished.                                                                                                                   |
| **stopped — page route changed** (`route-changed`)                             | DSM went back from the password step, or left its sign-in routes for 2 seconds after Next.                                                                                                         |
| **stopped — login layout not recognized** (`layout-unrecognized`)              | DSM loaded, but its login controls did not match the reviewed DSM 7 layout within 45 seconds. Sign in manually and share diagnostics.                                                              |
| **stopped — unsupported login path** (`unsupported-login-path`)                | The page opened on a path other than `/` or `/webman/index.cgi`, such as a reverse-proxy subpath or portal. Use the DSM root address.                                                              |
| **stopped — login form changed** (`form-changed`)                              | DSM kept dropping the filled value (more than three writes to one field), or the helper failed internally. Share diagnostics.                                                                      |
| **stopped — saved credentials unavailable** (`credentials-unavailable`)        | The native grant was refused, had expired or could not be reached. Reopen the original saved connection.                                                                                           |
| **stopped — invalid credential response** (`invalid-credential-response`)      | The credential response or page grant did not match the reviewed protocol, for example after an update. Restart the desktop app, then reopen the saved connection.                                 |
| **timed out — page never became ready** (`page-never-ready`)                   | No DSM login page appeared: 60 seconds passed without progress, or 240 seconds in total. Check that DSM loads in this tab; an already signed-in desktop without recognized markers also ends here. |
| **timed out — login form never appeared** (`login-form-never-appeared`)        | The DSM page loaded, but its login form never became visible and editable.                                                                                                                         |
| **timed out — Next did not advance** (`next-not-advanced`)                     | Next was clicked, at most twice, but DSM did not move on within 85 seconds of the username reply.                                                                                                  |
| **timed out — password step never appeared** (`password-panel-never-appeared`) | DSM moved on, but the password step never became ready within 85 seconds. Sign in was not clicked.                                                                                                 |
| **timed out — Sign in never enabled** (`signin-button-never-enabled`)          | The password was filled, but Sign in never became usable within 85 seconds. Sign in was not clicked.                                                                                               |
| **timed out — deadline reached** (`timeout`)                                   | A credential request took 30 seconds or longer. Check the network route, then reopen the saved connection.                                                                                         |

### Sharing diagnostics

When reporting a problem, include the status text and its details:

- **Tooltip.** Hover the status. After the native snapshot, it shows the page
  helper's `phase/reason` code with an explanation, up to eight
  **Recent page steps (ms since start)** and a **Page fingerprint**.
- **Action Log.** Turn on **Settings → Performance → Enable action logging**
  before reproducing, open **Action Log**, choose **Website auto-fill** in the
  source filter, and copy the attempt's entries. The final page entry adds the
  hand-off step, if any, and the page fingerprint.

The fingerprint only counts the matching DSM login elements (root, panel, form,
field and button, each capped at 9) and names the route class (such as `signin`,
`password` or `otp`), the document load state and the helper stage. Neither the
tooltip nor the Action Log includes usernames, passwords, grant tokens, 2FA
codes, host names, URLs or page text. Copied Action Log rows do include the
app's internal session, connection and database IDs.

### Reviewed layout and verification

The DOM contract was reviewed against DSM's public desktop Vue login assets:
`dsmAccountPanel.vue`, `dsmPasswordPanel.vue`, `otpPanel.vue` and `nextButton.vue`
as embedded in `webman/login/dist/dsm.login.bundle.js` (SHA-256
`4b75091b7f860b06ae37a7339d0fa067dd8c367664a4622262766348ae47e384`).
The route names for approval, method selection and passkey steps, the
post-submit error region and the DSM desktop markers are heuristics that were
not captured from a live NAS. A hand-off is recognized from DSM's `#/signin/…`
route; if DSM shows a step without changing route, the attempt ends as
**reported submission** instead. A changed layout stops with **login layout not
recognized** rather than guessing.

Regression coverage uses synthetic DSM pages and inputs only; it is not a live
NAS authentication test:

- `tests/protocol/synologyLoginTimeline.test.ts` replays named DSM start-up
  timelines against the production helper, including a slow QuickConnect splash,
  `#/` before `#/signin`, re-renders during a credential request, 2FA hand-offs
  and an already signed-in desktop.
- `node scripts/test-synology-login-browser.mjs` runs 37 of those scenarios in
  the installed Microsoft Edge (headless) with the production page scripts, a
  slow image holding the load event, and a local stand-in for the proxy that
  counts each one-use credential request. It needs Node 22.18 or later, and it
  neither builds the app nor contacts a NAS. Add `--list` to see the scenarios
  or `--only=name` to run some of them.
- `e2e/specs/26-synology/dsm-web-autofill.spec.ts` opens a saved direct-URL
  **Automatic form login** connection in the built desktop app against the
  synthetic DSM website in the Docker fixture service `test-dsm-web` (HTTPS on
  `127.0.0.1:8446`). Each case submits the username and password once: a normal
  start-up that ends **signed in**, a slow document followed by a 35-second `#/`
  splash that never shows a stopped or timed-out status, and a hand-off to
  **enter your 2FA code** after Sign in that sends no code.
  QuickConnect relays are not reproduced locally, and the suite is skipped when
  Docker is unavailable. Check the fixture itself with
  `npx vitest run -c e2e/vitest.fixtures.config.ts e2e/fixtures/synology-dsm-web/`.

## Native NAS API sign-in

**Synology NAS API** includes the **File Station** file-management section and
supported NAS administration tools such as system, storage, network, users and
packages. Individual operations depend on DSM version, installed packages and
account permissions; this is not coverage of every DSM API.

The sidebar checks every read of each section once per API session, with at
most three checks in flight. File Station stays usable as soon as its listing is
read; other sections are disabled only while their access check is pending.
Checks pause when the session tab or app is hidden. There is no access polling;
use **Recheck section access** after changing packages or permissions.

**Partial access** sections stay in the list. Sections with nothing readable
are grouped under **Needs more access** or **Not installed or not provided**,
with the reason. Restricted tables show a notice with **Recheck access**
instead of rows, and Refresh skips those reads. **Could not verify** is
different: a network, compatibility or checking error does not prove denial, so
you can still use that section or recheck. A successful read does not grant
permission to change NAS settings; each action retains its own server-side
permission check. See
[access checks and restricted data](synology-file-station.md#access-checks-and-restricted-data)
for every read state.

The API view uses the credentials saved in Application, without a second
username/password form in the session tab. A DSM two-factor challenge opens a
code dialog; see
[one-time codes and trusted devices](#one-time-codes-and-trusted-devices).
Browser cookies do not authenticate the API explorer.
The API uses the selected app-wide route: direct access or the configured
HTTP(S) proxy. The same route is retained through discovery, sign-in and later
API calls; no environment proxy or direct fallback is used. Per-connection
proxy/VPN/tunnel chains and browser certificate exceptions remain unsupported
and are refused. HTTPS always verifies the server certificate. Changing the
app-wide proxy requires reconnecting, not silently moving an active NAS session.

A reverse-proxy hostname is supported as the server address when it forwards
DSM's `/webapi/` routes. The native client requests DSM's session cookie and
keeps it in a private per-connection jar; it also sends SID/SynoToken parameters
and the CSRF token header, plus DSM's `X-SYNO-HASH` request signature after a
secure login handshake. These values never go in the request URL or browser
storage. The proxy must preserve session cookies and authentication headers and
route login and subsequent calls to the same DSM server. API reverse-proxy
access is different from configuring an outbound proxy/VPN inside this app.

Addresses may be hostnames, DNS subdomains, IP addresses, host:port pairs or
root HTTP(S) URLs. An explicit URL uses its own scheme and port (80/443 when
omitted). A plain host uses the configured port. URLs with credentials, query
strings or application paths cannot be used as API server addresses.

### Secure login handshake

DSM 7 can limit an API session that signs in from a remote address, including
through QuickConnect, without the secure login handshake DSM's own sign-in page
performs. In such a session File Station and basic system information still
work, but administration APIs answer code 105, even for an administrator.

When DSM advertises the handshake, the native client:

1. requests the NAS's login key on the same route and endpoint it signs in on,
   within 4 seconds;
2. sends the first handshake message with DSM's current sign-in request, using
   a new key for every attempt, including each one-time-code retry;
3. finishes the handshake from DSM's reply, then signs that session's
   administration requests. File Station requests, uploads and downloads are not
   signed.

Handshake keys and state stay in the desktop process. They are never logged,
shown, sent to the page or included in diagnostics. A missing, invalid or slow
login key, or an unfinished reply, never fails the sign-in: the session
continues unsigned, and **Login handshake** in the session panel records the
outcome.

| Login handshake                           | Meaning                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **DSM 7 secure (IK)**                     | The handshake finished; administration requests are signed.                                                           |
| **DSM 7 secure, incomplete**              | DSM accepted the sign-in without finishing the handshake. Requests are not signed, and DSM may limit the session.     |
| **legacy (secure handshake unavailable)** | DSM advertises the handshake, but its login key was missing, invalid or too slow, so the app signed in without it.    |
| **legacy**                                | This DSM does not offer the handshake (DSM 6 or an older DSM 7 release), so the app used the earlier sign-in request. |

Signed requests of one session are sent one at a time so that they reach DSM in
order. A slow administration request can therefore delay the next one in the
same session; File Station transfers are not affected.

### Session identity and reconnect

Under the section list, **NAS API session** shows who is signed in and how,
using only DSM's answers and the app's own record of the sign-in:

```text
Signed in as nas-admin · Administrator: yes · Session: FileStation · Login handshake: DSM 7 secure (IK) · Route: QuickConnect relay · 2FA: one-time code
```

- **Administrator** is **yes** or **no** as DSM reports it. When DSM does not
  report it, the panel shows **no (delegated administration)** if some
  administrator-only data is readable and some is not, **no** if none is, and
  otherwise **unknown (DSM did not report it)**.
- **Session** is **FileStation** for the normal API session, or
  **DSM desktop (webui)** after **Reconnect as DSM session**. It adds
  **(application portal)** when DSM says the sign-in came through an application
  portal port.
- **Login handshake** is described in
  [secure login handshake](#secure-login-handshake).
- **Route** is **Direct**, **HTTP proxy**, **QuickConnect relay** or
  **QuickConnect direct**, meaning a QuickConnect address that reached the NAS
  without the relay.
- **2FA** is **none**, **one-time code** or **trusted device**.

The panel header also shows **Signed in as** next to the NAS address, which
reveals a saved connection that uses an unexpected account. On narrow views the
details fold behind **Show session details**.

**Copy session diagnostics** (the **Copy diagnostics** button) copies these
lines, the authentication API version, and each checked section's status and
requirement with the DSM API names and states of its restricted reads. It never
includes explanations, hostnames, URLs, SIDs, tokens, handshake data or device
ids, so you can share it when reporting restricted data.

When DSM reports an administrator, or the session came through an application
portal, and some data is **Session restricted**, the panel becomes a warning
with an explanation and reconnect buttons. Restricted tables and section panels
offer the same buttons, except for a portal session.

- **Reconnect** releases this session, then signs in again once.
- **Reconnect as DSM session** does the same, but asks DSM for a DSM desktop
  (`webui`) session instead of a File Station session. It is offered only when
  the secure handshake finished, the session is not already a DSM desktop
  session, and it is not a portal session.

Each reconnect is one sign-in you started: a trusted device skips the code, a
selected vault authenticator is used at most once, and otherwise the code dialog
opens. The DSM session choice applies to that sign-in only, and nothing is
retried automatically. If DSM refuses a DSM desktop session for the account,
reconnect normally. The standalone window does not keep the password, so its
Reconnect asks you to enter it.

### Session restricted or requires administrator

Both come from DSM code 105, which DSM uses when the signed-in session lacks
permission. They differ in what DSM reports about the account:

- **Requires administrator**: DSM does not report the account as an
  administrator. Sign in with an administrator account, or give this account a
  DSM delegated administration role that covers the data. Reconnecting the same
  account does not help.
- **Session restricted**: DSM reports the account as an administrator, or the
  session came through an application portal, yet refused the data for this
  session. The explanation depends on the session:

| Session                                              | Why                                                                                                                                         | What to do                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Application portal                                   | The sign-in went through a DSM application portal port, which limits the session to that application.                                       | Edit the connection to use the DSM port (for example 5001). Reconnecting on the same port does not help. |
| Login handshake **legacy** or **incomplete**         | The session was signed in without DSM 7's secure login handshake, which DSM requires for full access over QuickConnect or remote addresses. | **Reconnect**. If the restriction remains, copy the session diagnostics.                                 |
| Handshake **DSM 7 secure (IK)**, session FileStation | DSM still refused the data for this API session.                                                                                            | **Reconnect as DSM session**, then **Recheck access**. If it remains, copy the session diagnostics.      |
| Handshake **DSM 7 secure (IK)**, DSM desktop session | DSM restricts the data even for a DSM desktop session.                                                                                      | Copy the session diagnostics and include them in your report.                                            |

### One-time codes and trusted devices

Codes, two-factor setup, unsupported methods and trusted devices are described
in
[sign in and two-factor authentication](synology-file-station.md#sign-in-and-two-factor-authentication).
Each code you submit starts a complete new sign-in with a fresh secure
handshake. DSM two-factor setup (code 406) shows no code field. Approve sign-in
and security keys cannot complete an API sign-in: use the **DSM website** view,
whose [two-factor and Secure SignIn steps](#two-factor-and-secure-signin-steps)
hand them to you on DSM's own page. Signing in on either surface does not
authenticate the other.

With [Trust this device](synology-file-station.md#trust-this-device), an opt-in
for vault-backed connections, later sign-ins from this computer skip the code
and the session panel shows **2FA: trusted device**. That device token is
separate from the DSM website's own "trust this device" option, which lives in
the website view's cookies and which the website sign-in helper never selects.

### QuickConnect API resolution

For a QuickConnect address, use the NAS alias, such as
`your-nas.quickconnect.to`. The native client contacts the provider anonymously,
then tests a bounded set of same-NAS HTTPS endpoints. It requires matching NAS
identity evidence and usable authentication/File Station API discovery before
sending the saved login. Resolution has a 120-second deadline and may request
one regional relay tunnel. An HTTP landing alias is only an identifier: its
resolution and selected NAS endpoint still use verified HTTPS.

Provider cookies stay in separate origin-specific jars. The selected NAS keeps
one private client and cookie jar from its identity probe through API discovery,
the secure login handshake, sign-in and subsequent operations; failed candidates
do not share that jar. Nothing imports the DSM website's cookies or credentials.
Unsupported endpoints, certificate failures and redirects do not authorize a
downgrade or an arbitrary destination. Synthetic CONNECT/TLS tests cover this
flow; a successful live NAS or QuickConnect sign-in is not inferred from those
fixtures.

Anonymous API discovery tries `/webapi/entry.cgi` first. A gateway compatibility
failure (HTTP 404/405, HTML, or DSM API code 102/103) permits one anonymous
`/webapi/query.cgi` request on that same endpoint and route. This is not a login
retry: passwords, one-time codes and authenticated file operations are never
automatically replayed. If resolution fails, check QuickConnect and the selected
network route, or explicitly choose a usable LAN/DDNS/reverse-proxy API address.

### Initialization status

Opening a saved API tab shows the app's configured loading element alongside
the current observed stage and elapsed time for that stage:

1. **Checking desktop capabilities** verifies native API availability before
   sending NAS credentials. A read-only transport-version check also requires
   the running backend to confirm HTTP proxy and QuickConnect support. If that
   marker is missing or outdated, restart/update the desktop app; refreshing its
   page or retrying credentials cannot upgrade an already-running native binary.
2. **Resolving the NAS and signing in** waits for one native request on the
   selected route. QuickConnect resolution, DSM discovery, the secure login
   handshake and authentication are not reported as separate backend events, so
   the app does not invent sub-stages or a percentage.
3. **Loading shared folders** starts only after an API session is established.
   Other administration data loads when its section is opened, except reads the
   access check has restricted.

Folder loading stays inside the file list: the toolbar, breadcrumbs, table
headers and footer remain visible. A new folder shows placeholder rows until
its response arrives, never the previous folder's files. Refreshing the same
folder keeps its existing rows read-only while the request is pending. Folder
navigation remains available; selection and file changes wait for the listing.

A requested one-time code remains an explicit dialog; its verification request
has its own status. Completed-stage labels only describe observed results.
Elapsed-time updates and the loader pause while the tab or app is hidden, and
stop when the request finishes or the view closes. Cancel connection keeps the
existing cancellation and late-session cleanup protections. An actual sign-in
or shared-folder error replaces loading with the error and an explicit retry
action; no password, OTP or file operation is automatically replayed.

When the native client can classify a failed HTTP response, **API failure details**
shows the failed step, HTTP status, response kind, content-type category, inspected
byte count and any bounded DSM error code. When DSM refuses an API whose access
class is known (code 105), a **Required access** row names **Administrator** or
**Application privilege**. HTML instead of JSON can indicate a
website login or portal rather than a usable API endpoint; HTTP 200 alone does
not prove API success. **Copy diagnostics** copies only these safe fields and a
fixed explanation, never response bodies, URLs, cookies, headers or credentials.
Inspected bytes are not necessarily the full response size; the response body is
not retained in the diagnostic. Older clients and
failures without response metadata keep their existing error message.

The NAS sections, folder navigation and selected file rows follow the app's
outlined accent styling. The file selection column stays compact while the
remaining columns retain horizontal scrolling on narrow views.

## Keeping an API session active

The desktop keeps each open API session alive with an authenticated, read-only
File Station information request every minute, including when its tab is in the
background. Network failures back off to at most five minutes. The status strip
shows degraded verification; hover for the last successful check. Closing the
session, replacing it, or locking its owning database ends the connection and
stops its worker. Native DSM session IDs and tokens are not sent to the page.

This helps avoid inactivity expiry, but cannot override a NAS administrator's
forced logout, absolute session lifetime, reboot, account policy or network
outage. The app never silently replays passwords, OTPs or failed file changes.
When DSM rejects the session, reconnect explicitly and inspect a destination
before repeating any operation whose result is uncertain.

## DSM code 119

Synology documents code 119 as **invalid session / SID not found**. It does not
by itself identify a bad password or TLS certificate failure. If it occurs just
after sign-in, verify that the login and subsequent API requests reach the same
DSM server. If it occurs later, reconnect to obtain a new session. Code 106 is
timeout, 107 is interruption by duplicate login, and 150 identifies a source-IP
mismatch. See the [official DSM login API guide](https://kb.synology.com/en-us/DG/DSM_Login_Web_API_Guide/2).
