---
title: Web viewer trust and authentication
eyebrow: Use the app
description: Understand certificate decisions, anonymous diagnostics, and authentication limits in the embedded HTTP viewer.
permalink: /http-viewer-trust/
---

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

Certificate inspection, certificate-identity validation, database trust verification and trust-decision persistence are separate stages. Their failure screens now identify the failing stage. A locked or unavailable database Trust Center is not reported as a failed TLS handshake. A failed trust write leaves the connection blocked. None of these errors silently disables verification.

After an HTTPS trust decision succeeds, the proxy receives the accepted leaf fingerprint and pins the outbound certificate. This remains true when ordinary CA/hostname verification (`httpVerifySsl`) is disabled: that setting does not discard an explicit certificate identity decision. HTTP without TLS does not receive a certificate pin. The native proxy enforces the pin; the frontend does not merely display it.

Deep diagnostics is a separate, read-only **anonymous** connectivity probe. It sends no saved origin credentials or browser cookies. Successful TCP/TLS followed by HTTP 401 can therefore be a normal authentication challenge, not proof that a saved password is wrong. Diagnostic output does not replace the actual navigation/trust error. Both navigation and diagnostics respect the configured outbound HTTP(S) proxy; an invalid enabled proxy refuses the probe instead of silently using a direct route.

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
