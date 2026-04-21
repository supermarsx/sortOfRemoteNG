# Apple Developer Program Enrollment — Action Package (t3-e37, B3/Q3)

_Status: DECISION + ACTION package. Produced 2026-04-20. Does **not** enroll._
_Owner: release engineering. Consumers: release CI (t3-e22 `release.yml`), macOS notarization pipeline._
_Primary source: <https://developer.apple.com/programs/enroll/> (fetched 2026-04-20)._

---

## 1. Why we need this (critical path summary)

The macOS `.dmg` / `.app` artifacts produced by `tauri-action` must be:

1. Signed with a **Developer ID Application** certificate (Apple-issued, requires a paid Apple Developer Program membership).
2. Notarized via `xcrun notarytool submit …` (Apple's current pipeline — `altool` is deprecated and hard-removed from recent Xcode).
3. Stapled via `xcrun stapler staple` so the installed `.app` launches offline without Gatekeeper nagging.

Without enrollment we cannot produce step (1) — which blocks (2) and (3) — which blocks v1.0 macOS ship. This doc is the purchasing + CI-wiring checklist so the membership can be ordered the day Q3 is green-lit.

---

## 2. Individual vs Organization — recommendation

| Axis | Individual | Organization |
|---|---|---|
| Cost | $99 USD / yr | $99 USD / yr |
| Requires D-U-N-S | No | **Yes** (9-digit Dun & Bradstreet number) |
| Publisher name on Gatekeeper dialogs | Your legal personal name | Legal entity name |
| Team ID tied to | A person | The legal entity |
| Time-to-approval (typical) | Hours–2 days | **2–4 weeks** (D-U-N-S verification, legal-entity + domain checks, possible Apple callback) |
| Multiple engineers can sign | No (cert bound to the individual) | Yes (roles: Account Holder, Admin, Developer, App Manager, Marketing) |
| Transfers if owner leaves company | **Painful** (re-sign + re-notarize under new Team ID; users see new publisher) | Clean (reassign roles) |
| Fee waiver possible | No | Yes, for qualifying non-profits / educational / government |

### Recommendation

**Organization enrollment** is the correct choice for a shipping product like sortOfRemoteNG. Individual enrollment should only be used if:

- You're a sole proprietor with no plan to add signing engineers, **and**
- You accept that moving off the individual cert later forces a publisher-name change visible to every installed user.

If the project is already a registered legal entity, start organization enrollment **today** — the 2–4 week D-U-N-S / verification window is the single largest schedule risk on Q3's critical path. If the entity isn't registered yet, register first (LLC/company formation typically 1–5 business days in most US states; varies elsewhere).

### Pre-flight checklist before clicking "Enroll"

- [ ] Apple Account (formerly "Apple ID") created with **2FA enabled** on a phone you control.
- [ ] Legal name / legal entity name confirmed exactly as on government registration (no DBAs, no trade names).
- [ ] Physical address (**no P.O. boxes** — Apple will reject).
- [ ] **Organization only**: D-U-N-S number in hand. Check <https://developer.apple.com/enroll/duns-lookup/> — request a new one for free if missing (Dun & Bradstreet free issuance is 5 business days; paid expedite available).
- [ ] **Organization only**: work email on the org's domain (not gmail.com / hotmail.com).
- [ ] **Organization only**: public website live on the same domain with matching legal-entity name in footer / about page.
- [ ] **Organization only**: the Apple Account holder is an authorised legal signatory (owner, executive, senior project lead, or has explicit written authority).
- [ ] Payment method (credit card) ready — $99 USD/yr charged immediately after verification completes.

---

## 3. Enrollment walkthrough

1. Browse <https://developer.apple.com/programs/enroll/>, click **Start Your Enrollment**.
2. Sign in with the 2FA-enabled Apple Account.
3. Select entity type: **Individual / Sole Proprietor** OR **Organization** OR **Government**.
4. Enter legal info (name / entity / D-U-N-S / address / phone / website).
5. Apple sends verification email; click through.
6. Apple may call the phone number on file to verify identity (organizations — plan for this; missed call = days of delay).
7. Once verified, e-sign the **Apple Developer Program License Agreement**.
8. Pay $99 USD. Membership activates immediately on successful payment.
9. Navigate to <https://developer.apple.com/account/> → **Membership details** — copy the **Team ID** (10-character alphanumeric, e.g. `K36BKF7T3D`). Store it as the `APPLE_TEAM_ID` CI secret.

---

## 4. Retrieving the Team ID (two methods)

### Method A — web portal

1. Sign in at <https://developer.apple.com/account/>.
2. Sidebar → **Membership details** (or **Membership** on older UI).
3. **Team ID** is listed next to **Team Name**.

### Method B — from an existing signing identity (post-cert)

```bash
security find-identity -v -p codesigning
# Output lines look like:
#  1) 9F83...AB12 "Developer ID Application: ACME Corp (K36BKF7T3D)"
#                                                         ^^^^^^^^^^
#                                                         Team ID
```

---

## 5. Creating the Developer ID Application certificate

Two supported paths; pick **Path A (portal)** for CI — it gives a plain `.cer` + `.p12` export we can base64-stuff into a GitHub Actions secret.

### Path A — developer portal (recommended for CI)

1. On a Mac (needed for Keychain Access), open **Keychain Access** → **Certificate Assistant** → **Request a Certificate From a Certificate Authority…**
2. Enter the Apple-Account email, pick **Saved to disk**, tick **Let me specify key pair information**. Save the `.certSigningRequest` (CSR) file.
3. Web: <https://developer.apple.com/account/resources/certificates/list> → **+** → select **Developer ID Application** → Continue.
   - _Note: only Account Holders can create Developer ID certs; Admins cannot._
4. Upload the CSR from step 2. Download the issued `developerID_application.cer`.
5. Double-click the `.cer` to import into **login** keychain.
6. In Keychain Access, find **Developer ID Application: `<Team Name>` (`<Team ID>`)**, right-click → **Export…** → save as `DeveloperID_Application.p12`, set a strong export password (save this — it becomes the `APPLE_CERT_PASSWORD` secret).
7. Base64-encode for CI transport:

   ```bash
   base64 -i DeveloperID_Application.p12 -o DeveloperID_Application.p12.base64
   # (Linux: base64 -w0 DeveloperID_Application.p12 > DeveloperID_Application.p12.base64)
   ```

   Paste the file contents into the `APPLE_CERT_P12_BASE64` GitHub secret.

### Path B — Xcode automatic (developer-workstation only)

`Xcode → Settings → Accounts → Manage Certificates… → +` → **Developer ID Application**. Fine for local signing; **not** what CI should consume because Xcode installs it into the login keychain without giving you a portable `.p12` — you'd still need the export step above.

### Certificate lifetime

Developer ID Application certs are valid for **5 years**. Calendar a renewal reminder at **year 4, month 9** to avoid the "signed-but-cert-expired → Gatekeeper blocks" cliff for users.

---

## 6. App-Specific Password for `notarytool`

`notarytool` accepts three auth modes; App-Specific Password is the simplest and the one we use.

1. Sign in at <https://account.apple.com/> (formerly <https://appleid.apple.com>).
2. **Sign-In and Security** → **App-Specific Passwords** → **+**.
3. Label it `sortofremoteng-notarytool-ci`.
4. Apple displays a one-time password in the form `abcd-efgh-ijkl-mnop` (4 × 4 alpha groups). **Copy it now** — you cannot retrieve it later, only revoke + regenerate.
5. Store as `APPLE_PASSWORD` in GitHub Actions secrets.

**Scope**: app-specific passwords are bound to the individual Apple Account, not the team. If the Account Holder leaves, the password stops working — plan a rotation hook in runbook.

---

## 7. Required GitHub Actions secrets

Configure in **GitHub → repo → Settings → Secrets and variables → Actions**:

| Secret name | Example (placeholder) value | Source |
|---|---|---|
| `APPLE_ID` | `releases@example.com` | The Apple Account email used at enrollment. |
| `APPLE_PASSWORD` | `abcd-efgh-ijkl-mnop` | App-Specific Password from §6. |
| `APPLE_TEAM_ID` | `K36BKF7T3D` | 10-char Team ID from §4. |
| `APPLE_CERT_P12_BASE64` | `MIIK...base64...==` (multi-KB) | base64 of `.p12` from §5 step 7. |
| `APPLE_CERT_PASSWORD` | `s3cret-p12-export-pw` | The `.p12` export password set in §5 step 6. |

All five are referenced by the release workflow (t3-e22). Rotating `APPLE_PASSWORD` or `APPLE_CERT_P12_BASE64` requires a re-run of the workflow to pick up new values.

Optional but recommended companion secret for `keychain import` (see §8):

| `APPLE_KEYCHAIN_PASSWORD` | `random-32-byte-hex` | Throwaway password for the ephemeral CI build keychain. |

---

## 8. Keychain import on a macOS CI runner

GitHub-hosted `macos-latest` runners start with a login keychain but no Developer ID identity. The release workflow must materialize the `.p12` into an ephemeral keychain, import it, and unlock it before `codesign` / `tauri build` runs. Skeleton step:

```yaml
- name: Import Developer ID cert into ephemeral keychain
  env:
    APPLE_CERT_P12_BASE64: ${{ secrets.APPLE_CERT_P12_BASE64 }}
    APPLE_CERT_PASSWORD:  ${{ secrets.APPLE_CERT_PASSWORD }}
    KEYCHAIN_PASSWORD:    ${{ secrets.APPLE_KEYCHAIN_PASSWORD }}
  run: |
    set -euo pipefail
    KEYCHAIN_PATH="$RUNNER_TEMP/build.keychain-db"
    CERT_PATH="$RUNNER_TEMP/cert.p12"

    echo "$APPLE_CERT_P12_BASE64" | base64 --decode > "$CERT_PATH"

    security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

    security import "$CERT_PATH" \
      -P "$APPLE_CERT_PASSWORD" \
      -A -t cert -f pkcs12 \
      -k "$KEYCHAIN_PATH"

    # Allow codesign to use the key without interactive prompt
    security set-key-partition-list \
      -S apple-tool:,apple:,codesign: \
      -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

    # Prepend ephemeral keychain to search list (keeps login keychain available)
    security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | tr -d '"')

    # Sanity: cert should be visible to codesign
    security find-identity -v -p codesigning "$KEYCHAIN_PATH"

- name: Store notarytool credentials
  env:
    APPLE_ID:       ${{ secrets.APPLE_ID }}
    APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
    APPLE_TEAM_ID:  ${{ secrets.APPLE_TEAM_ID }}
  run: |
    xcrun notarytool store-credentials "sortofremoteng-notary" \
      --apple-id     "$APPLE_ID" \
      --team-id      "$APPLE_TEAM_ID" \
      --password     "$APPLE_PASSWORD" \
      --keychain     "$RUNNER_TEMP/build.keychain-db"

- name: Post-job cleanup (always)
  if: always()
  run: |
    security delete-keychain "$RUNNER_TEMP/build.keychain-db" || true
    rm -f "$RUNNER_TEMP/cert.p12" || true
```

Then notarize later in the same job:

```bash
xcrun notarytool submit "target/release/bundle/dmg/sortOfRemoteNG.dmg" \
  --keychain-profile "sortofremoteng-notary" \
  --keychain "$RUNNER_TEMP/build.keychain-db" \
  --wait

xcrun stapler staple "target/release/bundle/dmg/sortOfRemoteNG.dmg"
xcrun stapler validate "target/release/bundle/dmg/sortOfRemoteNG.dmg"
```

Notes:

- Use `$RUNNER_TEMP` (auto-cleaned) over `/tmp` so the keychain and cert don't survive the job.
- `set-key-partition-list` is the step most commonly forgotten — without it, `codesign` will hang prompting for a password.
- If `tauri-action` is used instead of raw `codesign`, the same keychain + the env vars `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` are picked up automatically — but the keychain-setup step above still runs first.

---

## 9. Post-enrollment verification (run these on a Mac once the cert is installed)

Run each and confirm clean output before handing over to t3-e22.

```bash
# (1) Team ID + cert presence
security find-identity -v -p codesigning
# Expect a line: "Developer ID Application: <Team Name> (<TEAM_ID>)"

# (2) notarytool can authenticate (stores creds in default keychain)
xcrun notarytool store-credentials "sortofremoteng-local" \
  --apple-id "releases@example.com" \
  --team-id  "K36BKF7T3D"
# It will prompt for the App-Specific Password interactively.

# (3) Round-trip: submit a trivially-signed throwaway .zip to confirm auth works end-to-end
#     (Apple accepts even tiny signed bundles for notarization.)
xcrun notarytool history --keychain-profile "sortofremoteng-local"
# Expect: empty or a list of previous submissions, no auth error.

# (4) Confirm altool is no longer needed / not being shadowed
xcrun --find notarytool
# Expect a path like /Applications/Xcode.app/Contents/Developer/usr/bin/notarytool

# (5) On a real signed artifact, full smoke test:
xcrun notarytool submit build.dmg --keychain-profile "sortofremoteng-local" --wait
xcrun stapler staple build.dmg
spctl --assess --type execute --verbose=4 /Volumes/sortOfRemoteNG/sortOfRemoteNG.app
# Expect: "source=Notarized Developer ID"
```

If any of (1)-(4) fail, do **not** proceed to CI wiring — fix the local path first.

---

## 10. Timeline (from kickoff, assuming organization enrollment)

| Day | Activity |
|---|---|
| D+0 | Submit enrollment form, pay $99, request/attach D-U-N-S if needed. |
| D+1 to D+5 | D-U-N-S issuance (if new). |
| D+3 to D+21 | Apple verification (email + possible phone call-back). **Watch the phone.** Plan budget: **2–4 weeks**. |
| D+(approval) | Create Developer ID Application cert, export `.p12`, generate App-Specific Password, populate 5 GitHub secrets. |
| D+(approval)+1 | Run §9 verification locally. |
| D+(approval)+2 | Wire into t3-e22 `release.yml`; dry-run on a throwaway tag. |

**Blocking risk**: if the org isn't registered yet, add 1–5 business days (US) or longer (EU / APAC) before D+0.

---

## 11. Runbook references (for successor executors)

- t3-e22 `release.yml` consumes all five secrets from §7. Keep secret names stable.
- t3-e24 `SECURITY.md` should cross-link this file as the source of signing-identity provenance.
- Calendar entry: Developer ID Application cert **expires 5 years** after issuance. Set a reminder at year 4, month 9.
- Calendar entry: App-Specific Password — **rotate yearly** or on Account Holder change. Revoke at <https://account.apple.com/> → Sign-In and Security.

---

_End of action package. Enrollment is the user's manual step; everything downstream (CI wiring, notarization step, stapler validation) is mechanical once §7 secrets are populated._
