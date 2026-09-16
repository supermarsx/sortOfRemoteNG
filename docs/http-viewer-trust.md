---
title: Web viewer trust and authentication
eyebrow: Use the app
description: Understand certificate decisions, anonymous diagnostics, and authentication limits in the embedded HTTP viewer.
permalink: /http-viewer-trust/
---

## Organize saved certificates and SSH identities

In the Trust Center's **Certificates & host keys** tab, use the tags icon beside
an identity to **Edit tags and description**. Tags and descriptions are searchable;
the table shows a short preview and a tooltip for the complete text. Save updates
both fields together only if the original identity, security decision and prior
metadata still match. It never approves a certificate, changes a fingerprint,
reinstates a revoked identity or changes verification policy. A database switch
closes the old editor; a rejected save retains its draft for review.

Descriptions support up to 4096 UTF-8 bytes. Clearing a field removes that
metadata. Existing display labels and reviewed bulk tag replacement remain
available. Tags and descriptions travel with identity JSON imports/exports, so
avoid putting passwords, private keys or other secrets in them. Redirect
destinations use a separate model and do not have these metadata fields.

## HTTPS certificate approval preference

Open **Settings → Trust Center → HTTPS trusted-CA certificates**:

- **Accept certificates verified by trusted CAs** (default) accepts a newly
  encountered HTTPS certificate only after the native backend verifies its
  certificate chain, hostname and validity on the configured outbound route,
  and the owning database's Trust Center permits the decision. It does not save
  a permanent leaf pin, so an ordinary CA-valid renewal does not itself create a
  saved-pin mismatch.
- **Review new HTTPS certificates** asks for approval instead. This is not an
  every-session prompt: an existing exact approved pin still works normally.

CA-based automatic acceptance never overrides explicit Always Ask or Strict
policies, host-specific policies, existing pins, revocations, expired approvals
or Forget requirements. The pre-existing **Always Trust** policy is a separate
unsafe override for a directly opened connection: this CA/review preference is
inactive under it. Choose TOFU for CA-or-review behavior, or a restrictive policy
for manual approval. Redirected tabs cannot inherit Always Trust. Unverified,
self-signed, expired or hostname-mismatched new certificates are not silently
accepted or automatically pinned through legacy TOFU. The new preference affects
HTTPS only, not SSH host keys or RDP certificates. Missing older preferences
default to CA validation; malformed preferences conservatively require review.
The preference is included in settings save/export/import; importing a connection
or vault archive does not relax its explicit review policy.

Each redirected HTTPS origin gets a fresh inspection on its own route; a source
certificate, CA proof or unsafe Always Trust bypass is not transferred. Explicit
restrictive source policies survive the handoff. Changing this preference or an
effective HTTPS policy stops an open protected session and cancels outstanding
decisions; reload to apply it. An unavailable or locked owning database remains
a blocker, even for a publicly CA-valid certificate.

Native proof is short-lived and bound to the exact endpoint, route and observed
fingerprint. The actual HTTP/WebSocket client then enforces both normal CA
validation and that leaf fingerprint. An issuer's display name or frontend
boolean is not authority. This requires the matching desktop backend; an older
backend cannot silently fall back to unverified automatic acceptance. The padlock
shows native CA verification **at inspection** separately from stored approval;
an Unknown stored-trust badge can be correct when no permanent pin was saved.
This native-root validation does not fetch missing intermediates or enable
online OCSP/CRL revocation checks. Trust Center revocations above are local saved
decisions, not a claim of online certificate-authority revocation coverage.

Certificate inspection now parses X.509 details in every build, including lean. Previously, lean builds captured fingerprints but omitted diagnostic metadata, and the frontend rejected those empty fields with `Malformed bounded native trust identity`. A legitimate SAN-only certificate can still have an empty subject. Missing optional display details are accepted; malformed identities and fingerprints remain rejected.

The live padlock inspector receives the actual peer-presented chain, including full distinguished names, typed alternative names, validity, serial/version, signature and public-key information, fingerprints, extension bytes and original DER/PEM. This is captured information, not proof of approval: the persisted trust identity and accepted leaf pin remain separate. The inspector does not fetch missing roots or claim that the server sent a complete certification path. Parsing warnings preserve the original certificate instead of inventing metadata or silently dropping a chain entry.

Open the padlock to inspect the captured leaf and expand individual peer certificates, name attributes, extensions or raw PEM/DER. Sizes are human-readable; hover or focus the size for the exact byte count. Older backends explicitly report when full capture details are unavailable. Navigating or changing the connection clears the previous capture, and a delayed response cannot replace a newer inspection.

The stored-trust badge is read from the current database for the canonical endpoint. It distinguishes revoked or expired trust from an approved or merely remembered identity. A connection can inherit a database-wide decision only when the native trust rules allow it; editing an inherited nickname still targets that database-wide record. Forget requires a fresh explicit approval on the next verification even under TOFU. Unseen HTTPS certificates use the CA-or-review preference above, not automatic unverified pinning. An unavailable Trust Center is shown as unavailable, never inferred trusted from a stale cached record.

Capture is bounded to 32 certificates, 256 KiB per certificate and 2 MiB of total DER. A separate 2 MiB serialized-response limit includes base64/PEM and metadata; a chain may reach that limit before the DER limit. Oversized captures fail explicitly. Display fields, distinguished-name attributes, alternative names and extensions also have bounded limits; unsupported or excessive display metadata produces a warning with the original certificate retained.

Certificate inspection, certificate-identity validation, database trust verification and trust-decision persistence are separate stages. Their failure screens identify the failing stage. An inspection failure is further classified by the network step that stopped it, so an unreachable host or a failed proxy route is no longer reported as a certificate problem; see [Before an HTTPS page loads](#before-an-https-page-loads). A locked or unavailable database Trust Center is not reported as a failed TLS handshake. If the configured proxy route changes while the certificate is being checked, the navigation stops with **HTTPS route changed** rather than a Trust Center failure; reload to check it on the current route. A failed trust write leaves the connection blocked. None of these errors silently disables verification.

After an HTTPS trust decision succeeds, the proxy receives the accepted leaf fingerprint and pins the outbound certificate. This remains true when ordinary CA/hostname verification (`httpVerifySsl`) is disabled: that setting does not discard an explicit certificate identity decision. HTTP without TLS does not receive a certificate pin. The native proxy enforces the pin; the frontend does not merely display it.

Deep diagnostics is a separate, read-only **anonymous** connectivity probe. It sends no saved origin credentials or browser cookies. Successful TCP/TLS followed by HTTP 401 can therefore be a normal authentication challenge, not proof that a saved password is wrong. Diagnostic output does not replace the actual navigation/trust error. Both navigation and diagnostics respect the configured outbound HTTP(S) proxy; an invalid enabled proxy refuses the probe instead of silently using a direct route.

Diagnostics run only when you select **Deep diagnostics**. The probe starts its own clock and uses **Settings → Diagnostics → Protocol Diagnostic Timeout** (15 s by default) as its TCP connect timeout, so its timings are not the page load's timings. A diagnostic TCP connect that waits 15 s beside a certificate check that stopped after 10 s is expected. While the probe runs, the panel shows **Testing each connection stage… N s (TCP connect waits up to N s)**; the finished report is headed **Separate probe · took N ms**. A report belongs to the failure it was started from: after Retry or a newer failure, a late report is discarded instead of being attached to the new page.

## Before an HTTPS page loads

An HTTPS tab checks the server certificate natively before it loads anything. Nothing loads until that check passes: the page proxy is not started, and no HTTP request, saved credential or cookie is sent. The check itself only opens a TCP connection and a TLS handshake to read the certificate. With a configured proxy it goes through the proxy's CONNECT tunnel, never falls back to a direct connection and does not resolve the website's name locally.

Each step has its own fixed limit:

- **Name resolution:** 10 s.
- **TCP connect:** 10 s, split evenly across the resolved addresses, which are tried in order (at least 3 s each, at most 16 addresses). A dual-stack host whose IPv6 address silently drops connections therefore falls back to IPv4 after about 5 s.
- **Proxy:** 10 s each to look up and connect to the proxy, 10 s for the proxy's own TLS handshake when it is an HTTPS proxy, and 10 s for the CONNECT tunnel.
- **TLS handshake with the website:** 10 s.
- **Whole check:** 25 s. If this runs out first, the page reports the step that was still running.

The operating system can end a connect attempt sooner; the page then shows the time actually taken. After the first second, a caption such as **Checking the HTTPS certificate for 10.1.180.11:443 · 4 s** counts up (**… through the configured proxy …** on a proxy route) until the check passes, fails or asks for a trust decision. The count starts when the tab began the check, so a tab opened or restored in the background can already show time that passed before you switched to it.

If the check fails, the headline names the step that stopped it. Every one of these pages ends by stating that the trust check could not run, so the page was not opened and nothing was sent.

| Headline                           | What it means                                                                                                                                                                                                                 | What to check                                                                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name resolution failed**         | The hostname could not be resolved.                                                                                                                                                                                           | The spelling of the saved hostname, and the DNS server or VPN for this network.                                                                                                                                                    |
| **Host unreachable**               | Nothing answered the TCP connect within its limit, or the network reported no route to the host.                                                                                                                              | That the device is on and reachable (network, VPN, routing), that the saved port is right, and firewalls that silently drop connections. If a browser on this computer opens the address, check rules that apply only to this app. |
| **Service refused the connection** | The host answered, but nothing accepted connections on that port.                                                                                                                                                             | That the web service runs on the saved port, and that HTTP versus HTTPS matches the service.                                                                                                                                       |
| **Connection failed**              | The TCP connection failed for another reason.                                                                                                                                                                                 | The host, port, VPN, firewall and routes. Deep diagnostics shows which step fails.                                                                                                                                                 |
| **Proxy route failed**             | The configured proxy could not be reached, failed TLS verification, rejected its credentials (HTTP 407), could not open a tunnel, did not answer in time or sent an invalid response. The website was not contacted directly. | The global HTTP(S) proxy address and credentials in Settings. HTTP 502 or 504 from the proxy means the proxy could not reach the website. Correct or disable the proxy to connect directly.                                        |
| **TLS handshake failed**           | TCP connected, but TLS did not complete: it timed out, the port answered with data that is not TLS (often plain HTTP), the server closed the connection, or it sent a TLS alert.                                              | That the port serves HTTPS and which TLS versions the server supports. Deep diagnostics shows whether TCP succeeds and where TLS stops.                                                                                            |
| **Certificate check unavailable**  | The app's local certificate verifier could not start. TLS verification was not bypassed.                                                                                                                                      | Restart the app and retry, and check that the Windows trusted root certificate store is available.                                                                                                                                 |
| **Secure connection failed**       | The certificate itself failed: it was rejected during the handshake, could not be read, or its identity details are invalid. Inspection errors the app cannot interpret are also shown here.                                  | That the certificate is valid for this hostname, its expiry date and its issuing chain. Only change certificate verification after confirming the server identity.                                                                 |

An invalid saved address or proxy setting is shown as **The address could not be used**.

Below the headline, **Connection timeline** shows the failed attempt. Its header names the route (**Direct connection** or **Through the configured proxy**) and reads, for example, **Attempt started 14:02:11 · failed after 10.0 s**, measured from when the tab started loading. The steps follow in order. A direct route lists **Resolve address**, **TCP connect**, **TLS handshake**, **Read certificate**, **Certificate trust check** and **Open page**. A proxy route starts with **Connect to proxy**, **Proxy TLS** (HTTPS proxies only) and **Proxy tunnel** instead of the first two. A check mark with a duration is a step that finished in that time. A passed step without a duration finished but was not timed separately. The failed step shows a short reason and, when measured, its time, such as "no response from 10.1.180.11:443 after 10.0 s". Later steps show **Not started**, so the page never implies that the certificate trust check ran. If the app cannot read the failure details, only the start time and total are shown.

The certificate is checked on the port the page actually loads from. Previously, a saved connection with an empty Port field and a port in its hostname, such as `nas.example:5001`, was checked and pinned on port 443. It is now checked on its real port, so it may ask for one fresh trust decision there. Any earlier record for port 443 stays in the Trust Center until you remove it.

Support for older devices that only offer outdated SSL/TLS versions is planned as a follow-up. Until then, such devices usually fail with **TLS handshake failed**, and the app does not relax TLS to reach them.

## Loading, bookmarks and history

Pages stay visible and interactive while loading. After a 200 ms grace period, a thin line at the top moves and pulses; fast bookmark clicks do not flash a loader. Reduced-motion settings show a static line. The toolbar's **Stop loading** button cancels the navigation; it becomes Refresh again afterward. A certificate decision still blocks page interaction until you approve or decline, and time spent reviewing that decision does not consume the navigation deadline.

The line follows document loads from the address bar, bookmarks, in-page links, submitted forms and full-page redirects. A report bound to the current proxy session and document stops it when the document becomes ready, without waiting for every image or other resource. Readiness does **not** mean successful sign-in, completed MFA or approved certificate trust. Older backends and non-HTML documents fall back to the iframe's load event, without the early per-document readiness signal. A local readiness deadline is reported separately from an actual upstream network timeout; a successful anonymous diagnostic does not prove that the browser document or login finished. Optional HTTP recording cannot delay presenting the page.

Back and Forward each have a history dropdown with nearest entries first, step counts and full-URL tooltips. Select an entry to jump directly; jumping or refreshing keeps the forward branch until a genuinely new navigation replaces it. History stays in the tab's memory, up to 200 entries, and ends when the tab closes. This is URL/document history, not saved SPA application-state snapshots or replay of submitted form bodies.

The native mediator decodes supported gzip/deflate HTML, CSS and JavaScript before rewriting or injecting helpers, and removes headers that describe the original compressed bytes. Editable documents are bounded to 32 MiB before and after decoding; unsupported, corrupt or oversized encodings fail explicitly. Opaque resources keep their original bytes and encoding. This avoids treating compressed page bytes as text while preserving the configured route, TLS checks and accepted certificate pin.

Basic authentication uses dedicated Basic fields first, then legacy generic credentials when no dedicated pair is supplied. Omitted authentication type follows the HTTP editor/Quick Connect Basic default. A username with an empty password is a valid pair and is no longer ignored. Dedicated fields are not mixed with an unrelated generic password, and explicit Custom Headers or other non-Basic modes do not silently send generic Basic credentials.

Form auto-login is a separate per-connection opt-in. It reuses the resolved session username/password and optional saved CSS selectors; it is not arbitrary header authentication. The embedded HTTP surface is a retained DOM iframe behind the loopback mediator, not a separate native child WebView.

## Remaining authentication limits

Arbitrary `httpHeaders` are editable and preserved in connection data but are not currently transported by the embedded proxy. This fix does not implement that transport, its redirect/origin rules, or Digest authentication. A service requiring custom Authorization headers or Digest may therefore still need another supported client. A separate OS browser opened externally is outside the application's DOM access mask.

Regression checks use frontend command mocks, fixture certificate metadata and isolated loopback native TLS servers. No user endpoint, saved credential or user trust record is modified by those tests.
