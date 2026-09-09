---
title: Web viewer trust and authentication
eyebrow: Use the app
description: Understand certificate decisions, anonymous diagnostics, and authentication limits in the embedded HTTP viewer.
permalink: /http-viewer-trust/
---

The lean native certificate extractor returns a required SHA-256 fingerprint even when optional subject, issuer and validity display details are unavailable. Its chain DTO represents unavailable display fields as empty strings. A legitimate SAN-only certificate can also have an empty subject. The frontend previously required every chain display field to be nonempty and threw `Malformed bounded native trust identity` before consulting the native Trust Center. Missing/empty display details are now accepted; wrong types, NULs, excessive lengths, oversized chains and missing/malformed bounded fingerprints remain rejected.

Certificate inspection, certificate-identity validation, database trust verification and trust-decision persistence are separate stages. Their failure screens now identify the failing stage. A locked or unavailable database Trust Center is not reported as a failed TLS handshake. A failed trust write leaves the connection blocked. None of these errors silently disables verification.

After an HTTPS trust decision succeeds, the proxy receives the accepted leaf fingerprint and pins the outbound certificate. This remains true when ordinary CA/hostname verification (`httpVerifySsl`) is disabled: that setting does not discard an explicit certificate identity decision. HTTP without TLS does not receive a certificate pin. The native proxy enforces the pin; the frontend does not merely display it.

Deep diagnostics is a separate, read-only **anonymous** connectivity probe. It sends no saved origin credentials or browser cookies. Successful TCP/TLS followed by HTTP 401 can therefore be a normal authentication challenge, not proof that a saved password is wrong. Diagnostic output does not replace the actual navigation/trust error. Both navigation and diagnostics respect the configured outbound HTTP(S) proxy; an invalid enabled proxy refuses the probe instead of silently using a direct route.

Basic authentication uses dedicated Basic fields first, then legacy generic credentials when no dedicated pair is supplied. Omitted authentication type follows the HTTP editor/Quick Connect Basic default. A username with an empty password is a valid pair and is no longer ignored. Dedicated fields are not mixed with an unrelated generic password, and explicit Custom Headers or other non-Basic modes do not silently send generic Basic credentials.

Form auto-login is a separate per-connection opt-in. It reuses the resolved session username/password and optional saved CSS selectors; it is not arbitrary header authentication. The embedded HTTP surface is a retained DOM iframe behind the loopback mediator, not a separate native child WebView.

## Remaining authentication limits

Arbitrary `httpHeaders` are editable and preserved in connection data but are not currently transported by the embedded proxy. This fix does not implement that transport, its redirect/origin rules, or Digest authentication. A service requiring custom Authorization headers or Digest may therefore still need another supported client. A separate OS browser opened externally is outside the application's DOM access mask.

Regression checks use frontend command mocks, fixture certificate metadata and isolated loopback native TLS servers. No user endpoint, saved credential or user trust record is modified by those tests.
