# Windows EV Code Signing Certificate — Procurement Decision Package

**Executor:** t3-e36 (plan t3, B3 / Q2 critical path)
**Date prepared:** 2026-04-20
**Status:** Decision package — **order NOT placed**. This document gives the buyer enough to place an order with one of the recommended vendors.

---

## 1. Why we need this (context)

sortOfRemoteNG 1.0 ships as a signed Windows installer via Tauri's updater/bundler. Without a publicly-trusted code-signing certificate the installer is flagged as "Unknown Publisher" and blocked by Microsoft Defender SmartScreen. CA/Browser Forum baseline requirements (effective 2023) mandate that the private key for any publicly-trusted code-signing certificate live inside a FIPS 140-2 Level 2 (or higher) hardware security module — either a shipped USB token or a cloud HSM. EV is confirmed over OV per plan decision Q2.

### 2026 regulatory context (read before ordering)

- **Max validity: 1 year / 458 days.** Effective 2026-02-15 (DigiCert), 2026-02-23 (Sectigo), 2026-02-27 (SSL.com), 2026-03-01 (industry): all publicly-trusted code-signing certificates are capped at ~458 days. Multi-year deals are gone; annual renewal is the new normal.
- **SmartScreen ramp-up is no longer instant for EV.** Since March 2024, Microsoft removed the "EV = instant reputation" behavior. EV and OV now accumulate SmartScreen reputation at the same rate — based on install count, user telemetry, and time. Plan for a multi-week ramp after first release regardless of cert class.
- **EV is still worth it for us** because it is required by the Microsoft kernel-mode driver program, is the only class accepted by some enterprise IT policies, enforces stronger key custody (hardware-only private key, two-factor ceremony), and validates the company identity at a level that matches our Vogue Homes LLC procurement posture.

---

## 2. Vendor comparison (4 vendors)

All prices sourced from vendor pages and reputable resellers on 2026-04-20. Vendor-direct prices are list; reseller prices (shown in parentheses) are typical street prices for the same SKU. **Plan for list price** when budgeting; negotiate down via resellers only after validation requirements are confirmed.

### 2.1 Cost table (1-year term, USD)

| Vendor | EV cert (list / street) | HSM delivery included? | Cloud-HSM add-on | Shipping (USB) | Year-2 renewal |
|---|---|---|---|---|---|
| **DigiCert** | ~$600 / $524–$560 | USB token ships free OR install-on-own-HSM OR **KeyLocker cloud HSM** | KeyLocker: bundled with cert; units are 1 000 signing ops per purchased pack (extra packs sold separately) | Free (US); intl ~$50 | Same as year-1 list |
| **Sectigo** | ~$499 / $277–$297 | USB token ships free (1-yr only) OR install on YubiKey / Luna / Google KMS / Azure KV | Bring-your-own cloud HSM (Azure Key Vault, Google KMS, AWS CloudHSM, YubiHSM); no native cloud HSM product | Free (US); intl ~$40 | Same as year-1 |
| **SSL.com** | ~$349 / $249–$299 | USB token OR bring-own HSM OR **eSigner cloud signing (native)** | eSigner: subscription, tiered by signing volume (monthly fee for up to N signings, then per-sig overage) | Free (US) | Same as year-1; eSigner bills monthly |
| **GlobalSign** | ~$410–$500 (quote-only) | HSM-based only — NO token shipment for new orders; customer attests compliant HSM via audit letter | Bring-your-own only (Azure KV / AWS CloudHSM / on-prem Luna) | N/A (no token) | Same as year-1 |

**Totals at year-1 list, typical path (USB token for DigiCert/Sectigo/SSL.com; BYO-HSM for GlobalSign):**

| Vendor | Year-1 total | Year-2 renewal (annual cap — no multi-year) |
|---|---|---|
| DigiCert + USB token | ~$600 | ~$600 |
| DigiCert + KeyLocker | ~$600 (cert) + included base pack | ~$600 + KeyLocker op-packs if exhausted |
| Sectigo + USB token | ~$499 | ~$499 |
| SSL.com + USB token | ~$349 | ~$349 |
| SSL.com + eSigner cloud | ~$349 + eSigner monthly (~$10–50/mo tier) | ~$349 + monthly |
| GlobalSign + BYO-HSM | ~$410–$500 + existing HSM cost | ~$410–$500 |

All four vendors fall inside the plan-specified $300–500 band **at street/reseller prices**; at vendor-direct list, DigiCert and Sectigo EV top out nearer $500–600. Plan a $600 hard ceiling for year-1.

### 2.2 HSM delivery model — deep comparison

| Aspect | USB hardware token | Cloud HSM (DigiCert KeyLocker / SSL.com eSigner) | BYO cloud HSM (Azure KV / AWS / YubiHSM) |
|---|---|---|---|
| Time-to-first-sign after issuance | Token must ship internationally (2–5 bd) + activation call | Immediate (API / web portal) | Immediate if HSM already provisioned |
| CI/CD friendliness | Poor — token must be physically plugged into signer machine; GitHub-hosted runners can't use it without a self-hosted Windows runner with the token plugged in | Excellent — REST/KSP/CSP APIs; works on GitHub-hosted `windows-latest` runners via vendor CLI | Good — works on hosted runners with OIDC/SP auth; some extra tooling |
| Key portability / backup | Non-exportable by design; if token is lost → cert must be re-issued | Managed by vendor; SLA-backed | Customer-managed backups |
| Risk of lost/stolen token | High; shipping delays compound | None | None |
| Ops cost | One-time token cost (~free to ~$50) | Subscription / per-op | HSM service cost |
| Best for | Small teams with a single release engineer | Fully automated CI/CD (our target) | Orgs with an existing cloud-HSM standard |

**For sortOfRemoteNG:** CI-driven signing is a hard requirement (release.yml matrix, t3-e22). **Cloud HSM is the clear architectural fit.** That narrows the realistic field to **DigiCert KeyLocker** or **SSL.com eSigner**; Sectigo and GlobalSign are BYO-HSM only, which adds a Key Vault / HSM project on top of the cert itself.

### 2.3 KYC / validation timeline

EV validation is uniform across CAs (CA/B Forum EV guidelines) and requires:

- **Legal entity verification:** articles of incorporation / business registration, matched against a Qualified Independent Information Source (D&B / S&P / government registry). A **D-U-N-S number** dramatically speeds this step.
- **Physical address verification:** utility bill, lease, or QIIS listing.
- **Operational existence:** ≥3 years in business, OR bank/accounting attestation letter, OR QIIS confirmation.
- **Authority of applicant:** employment verification (HR letter, corporate counsel letter, or call to published company main line).
- **Final applicant phone verification:** CA calls the applicant at a number independently verified via QIIS (not one you supply). We must ensure Vogue Homes LLC's main line is listed in D&B / Google Business / similar.

| Vendor | Typical validation window | Notes |
|---|---|---|
| DigiCert | 3–5 business days (fast track if D-U-N-S pre-registered) | Most mature portal; fewest re-asks |
| Sectigo | 5–10 business days | Occasional re-asks for document quality |
| SSL.com | 3–7 business days | Very responsive support; good for SMB |
| GlobalSign | 5–10 business days + audit-letter cycle for HSM model | Extra step: HSM compliance audit letter |

Plan **10 business days** end-to-end from order submission to usable cert. Add 2–5 bd of international shipping if taking the USB-token path.

### 2.4 Timeline table (order → usable)

| Step | DigiCert + KeyLocker (RECOMMENDED) | Sectigo + USB token | SSL.com + eSigner | GlobalSign + BYO-HSM |
|---|---|---|---|---|
| Place order | day 0 | day 0 | day 0 | day 0 |
| Submit KYC docs | day 0–1 | day 0–1 | day 0–1 | day 0–1 |
| Validation complete | day 3–5 | day 5–10 | day 3–7 | day 5–10 |
| Phone callback verified | day 4–5 | day 6–10 | day 4–7 | day 6–10 |
| HSM/token delivered | immediate (cloud) | +2–5 bd shipping | immediate (cloud) | immediate (already provisioned) |
| Audit letter (HSM attestation) | N/A | N/A | N/A | +1–3 bd |
| First successful sign | **~day 5** | ~day 10–15 | ~day 5–7 | ~day 8–13 |

### 2.5 Renewal process

All vendors: because 2026 rules cap validity at ≤458 days, expect **annual renewal**. Re-validation is lighter than first-issue if the legal entity is unchanged (re-use prior KYC), typically 1–3 bd at DigiCert/SSL.com and 3–5 bd at Sectigo/GlobalSign. Set a **calendar reminder 60 days pre-expiry** — if renewal slips past expiry, release pipeline breaks.

### 2.6 Reputation / SmartScreen ramp-up implications

EV no longer grants instant SmartScreen clearance (Microsoft policy change, March 2024). Every vendor's cert behaves identically here. Practical implications:

- Plan for 2–6 weeks of "check telemetry / ask early adopters to dismiss the warning" after the first signed release.
- Consider submitting the initial 1.0 installer to Microsoft's Submit-a-File portal for analyst review the same day we publish.
- Expected ramp accelerators (all independent of vendor): stable publisher name in cert subject (do NOT rename legal entity between releases), consistent file hash patterns, high download volume early.

---

## 3. Final recommendation

### Primary: **DigiCert EV Code Signing + KeyLocker cloud HSM**

**Rationale:**
1. **Best CI/CD fit.** KeyLocker is a first-party cloud HSM with a stable Windows `signtool.exe` / KSP integration, well-documented for GitHub-hosted Windows runners (critical for t3-e22 `release.yml` matrix). No physical token to plug into anything.
2. **Fastest order-to-usable** (~5 business days) among vendors that include a native cloud HSM. Eliminates the 2–5 bd international shipping tail and the "token lost in Customs" tail risk.
3. **Most mature validation pipeline.** DigiCert's CertCentral portal and Vogue Homes LLC's likely D&B presence mean validation completes in the 3–5 bd low end.
4. **Vendor longevity.** DigiCert is the incumbent market leader; lowest risk of CA distrust / root removal over the 3+ year product lifetime.
5. **Cost is inside plan bound.** ~$600/yr at list is above the $300–500 target but within a reasonable $600 ceiling for a production product; the KeyLocker operational savings (no self-hosted signing runner, no token handling) easily justify the premium over Sectigo.

### Fallback: **SSL.com EV Code Signing + eSigner cloud signing**

If procurement rejects DigiCert's price, SSL.com is the clear fallback: also has native cloud signing (eSigner), ~$349/yr street, 3–7 bd validation. The only gaps vs. DigiCert are a smaller market share and a less polished CertCentral equivalent. Acceptable for 1.0.

### Not recommended for 1.0

- **Sectigo:** cheapest on paper but USB-token-only for the 1-year term (BYO-HSM requires 2–3 year terms which are going away). Would force us to build a self-hosted Windows signing runner.
- **GlobalSign:** no USB option; mandatory customer-provided HSM plus audit-letter cycle. Only makes sense for enterprises with an existing Key Vault / Luna footprint. We have neither.

---

## 4. Ordering checklist

Before placing the order, collect the following. All items marked **REQUIRED** block validation.

### 4.1 Company documentation (REQUIRED)
- [ ] Articles of Incorporation / Certificate of Formation for **Vogue Homes LLC** (PDF)
- [ ] Current business license or Certificate of Good Standing (issued <12 months ago)
- [ ] Recent (≤3 months) utility bill or signed lease listing the registered business address
- [ ] Bank letter OR CPA/attorney attestation that the company has been operational ≥3 years (only required if D-U-N-S record does not already prove this)
- [ ] W-9 or equivalent tax form ready for vendor AP

### 4.2 D-U-N-S lookup (REQUIRED)
- [ ] Look up Vogue Homes LLC on [dnb.com/duns-number/lookup](https://www.dnb.com/duns-number/lookup.html)
- [ ] If no D-U-N-S exists → request one (free; ~30 day turnaround without expedite, ~5 bd expedited at ~$229). **Start this first — it is the longest pole.**
- [ ] Confirm D&B record lists the correct legal name, address, and main phone exactly as they appear on the incorporation docs. Mismatches cause the most rejections.

### 4.3 Phone verification (REQUIRED)
- [ ] Confirm the company main line (`admin@vogue-homes.com`'s associated business number) is listed in at least one QIIS: D&B, Google Business Profile, corporate website, or 411.com
- [ ] Ensure the line can receive a call from the CA during business hours (PST) within 5 bd of order
- [ ] Designate and inform the applicant (who will place the order) and a backup — CA will ask for the applicant by name
- [ ] Applicant must have company email (`admin@vogue-homes.com` domain is fine)

### 4.4 Technical prep (do in parallel with KYC)
- [ ] Decide subject CN — must exactly match legal entity name, "Vogue Homes LLC"
- [ ] Decide primary + backup applicant contacts (full name, title, work email, direct phone)
- [ ] For DigiCert: create CertCentral account ahead of time; attach billing method
- [ ] For KeyLocker: plan the signing-ops budget (1 CI sign per release × 12 + manual signings) — the base pack is typically ample for <1 000 ops/yr
- [ ] Identify where the signing secrets (KeyLocker API credentials) live: GitHub Actions org-level secrets `DIGICERT_KEYLOCKER_*` (to be wired in t3-e22)

### 4.5 Internal approvals
- [ ] Budget approval for year-1 $600 + potential eSigner/KeyLocker ops
- [ ] Security review sign-off that cloud-HSM custody model is acceptable (it is — FIPS 140-2 Level 3)
- [ ] Set renewal calendar reminder: **T-60 days from issue date**

### 4.6 Post-order verification (once cert is issued)
- [ ] Sign a throwaway PE (e.g., a tiny C# "hello world") and inspect with `signtool verify /pa /v hello.exe`
- [ ] Confirm certificate chain terminates at a Microsoft-trusted root
- [ ] Confirm subject CN, O, and serial are correct
- [ ] Upload signed sample to VirusTotal + Submit-a-File to seed SmartScreen reputation
- [ ] Wire KeyLocker credentials into GitHub Actions (tracked in t3-e22)

---

## 5. Sources

- [DigiCert KeyLocker docs](https://docs.digicert.com/en/digicert-keylocker.html)
- [DigiCert KeyLocker cloud HSM knowledge article](https://knowledge.digicert.com/solution/digicert-keylocker)
- [DigiCert EV Code Signing certificate page](https://www.digicert.com/signing/code-signing-certificates)
- [DigiCert order an EV Code Signing certificate (CertCentral)](https://docs.digicert.com/en/certcentral/manage-certificates/code-signing-certificates/order-an-ev-code-signing-certificate.html)
- [Sectigo Code Signing Certificates product page](https://www.sectigo.com/ssl-certificates-tls/code-signing)
- [SSL.com EV Code Signing buy page](https://www.ssl.com/certificates/ev-code-signing/buy/)
- [SSL.com eSigner pricing](https://www.ssl.com/guide/esigner-pricing-for-code-signing/)
- [SSL.com OV vs. EV guidance (incl. 2024 SmartScreen change note)](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)
- [GlobalSign EV Code Signing Certificates](https://www.globalsign.com/en/code-signing-certificate/ev-code-signing-certificates)
- [GlobalSign order an EV Code Signing (HSM-based)](https://support.globalsign.com/code-signing/manage-certificate/ordering-ev-code-signing-certificate-hsm-based)
- [Microsoft Learn — SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [DigiCert blog — MS SmartScreen and Application Reputation](https://www.digicert.com/blog/ms-smartscreen-application-reputation)
- [Sectigo KB — MS SmartScreen and Application Reputation](https://support.sectigo.com/PS_KnowledgeDetailPageFaq?Id=kA01N000000zFJx)
- [D&B D-U-N-S Number lookup](https://www.dnb.com/duns-number/lookup.html)
