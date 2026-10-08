# Disposable HTTPS authentication acceptance fixture

This is a loopback-only synthetic target for the production native browser's
live acceptance run. It does **not** launch the app, automate its UI, install a
certificate, touch a database, or contact a provider. Only new files in this
directory are needed. Node 24 and OpenSSL are required; the tests also use the
repository's existing `jsdom` installation.

## Start and validate

From the repository root:

```powershell
node --test tests/e2e-native-auth/fixture.node-test.mjs
node tests/e2e-native-auth/fixture.mjs --port 18443
# If OpenSSL is not on PATH:
# node tests/e2e-native-auth/fixture.mjs --port 18443 --openssl C:/msys64/mingw64/bin/openssl.exe
```

The server binds **127.0.0.1 only**, defaults to `https://127.0.0.1:18443`, and
stops after 15 minutes or Ctrl+C. Startup prints only the origin, public
certificate path/SHA-256, configuration-file path, and sanitized report URL.
It creates a fresh one-day self-signed server certificate in an OS temporary
directory. There are no persistent accounts, access logs, request-body logs,
credential logs, console key events, or third-party assets. All supplied secrets
below are public test vectors, never real credentials. Do not replace them with
real account information.

Graceful shutdown removes the exact generated temporary directory and clears
in-memory runs. After a forced process kill, remove only the exact printed
`sorng-native-auth-*` directory after checking its resolved path; do not use a
wildcard cleanup. Every restart produces a different certificate.

## Disposable certificate trust — no OS/browser-wide exception

1. Use a new, empty disposable application database for saved-login acceptance.
   Do not import these profiles into a production database.
2. Keep **Verify SSL enabled**. Set this connection's HTTPS trust policy to
   **Always ask** (`httpsTrustPolicy: "always-ask"`).
3. At the native certificate dialog, check the exact loopback origin/port and
   match its SHA-256 with the startup fingerprint (ignore colon/case formatting).
   Choose **Allow this connection**, not **Trust and remember**. Repeat if another
   handshake prompts. This choice does not write the trust store.
4. Cancel any mismatched certificate. Do not use `always-trust`, certificate-ignore
   flags, `NODE_TLS_REJECT_UNAUTHORIZED=0`, or OS root-store imports.
5. Close fixture tabs before stopping the server. Discard the disposable saved
   connection/database when finished. A reconnect/new certificate must be reviewed
   again. Quick Connect is suitable for manual input, not the saved-login/MFA tests.

The Node tests trust only the generated certificate via the request-local `ca`
option and also assert that default certificate validation rejects it.

## Exact UI connection configuration

Use **HTTPS**, host **127.0.0.1**, port **18443**, Verify SSL **on**, HTTPS trust
**Always ask**, cookies and website/application extensions **enabled**. For the
automatic flows, turn **manual form submit off**. Use the actual
printed port if starting with `--port 0` or another port. No HTTP Basic auth is
needed: these are website form credentials. No proxy/VPN override is required;
the native browser must retain the app's normal private proxy route to loopback.

Public fixture values:

| Setting                     | Value                              |
| --------------------------- | ---------------------------------- |
| Username/email              | `synthetic@example.test`           |
| Password                    | `local-only-not-a-real-password`   |
| Authenticator secret        | `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` |
| Algorithm / digits / period | SHA-1 / 6 / 30 seconds             |
| Local TOTP config ID        | `local-auth-fixture`               |

Use TOTP issuer `Disposable local acceptance` and account `synthetic@example.test`.

Startup writes `connection-configs.json` alongside the temporary certificate.
It contains exact **saved-connection field fragments**, not a standalone database
import format. Main may apply them through its existing fixture database tooling;
this harness does not write the app database. Leave dedicated HTTP Basic username/
password fields empty when using the top-level username/password fields.

### A. Three-stage manual trusted-input baseline

- Initial URL/host field: `https://127.0.0.1:18443/staged`.
- Application: Custom application; login mode **manual**; automatic login off.
- Type email, Continue; type password, Continue; type the authenticator code,
  Verify. Use the public seed in the app's disposable TOTP entry to obtain the
  current code. The fixture accepts the current or adjacent 30-second window.
- Do not paste: this acceptance specifically requires typed trusted key/input
  events. Keep the browser focused while typing.

### B. Supported custom modular form

- Initial URL/host field: `https://127.0.0.1:18443/modular`.
- Application **Custom application**, login mode **form**, automatic login on.
- Username selector `#user_name`; password `#password`; submit `#continue`.
- Form automation: version 1, form selector `#login`, fill delay **750 ms**, submit
  delay **750 ms**, detection timeout **30000 ms**, submit **true**, extra fields `[]`.
- The first document contains email and password together; the next is a manual
  authenticator challenge. Generic/custom automation does **not** grant arbitrary
  MFA authority. Leave `httpAutoMfa` absent.

### C. Reviewed local Gitea-shaped form plus automatic TOTP

- Host **127.0.0.1**, port **18443**; application **Gitea**, login mode **form**,
  automatic login on. Its reviewed initial path is `/user/login`.
- Use the same public credentials and timing; leave custom selector overrides
  unset. Enable website/application extensions.
- Add/select the synthetic authenticator listed above. Explicit Automatic 2FA:
  `version: 1`, `enabled: true`, `totpConfigId: "local-auth-fixture"`,
  `challengeId: "gitea-totp"`, `origin: "https://127.0.0.1:18443"`.
- Email/password POST form selectors and `/user/two_factor` match the checked-in
  Gitea and TOTP catalogs. This is a fixture reproducing the reviewed DOM contract,
  **not acceptance against a real Gitea installation**.

## Evidence and auth-agent handoff

The result page and `GET /report` expose only bounded counters/booleans and flow
names. Inputs and event `key`/`data` are never included. Each field must have trusted
keydown, keyup, beforeinput and input counts at least equal to its expected length;
untrusted events, non-`insertText` events and unfocused events must all be zero.
The server independently checks the synthetic credentials and current TOTP.
Submit trust is reported separately: a trusted submit alone proves nothing about
how the credentials were entered.

- `functionalAcceptance`: correct values reached all required stages.
- `trustedInputAcceptance`: functional completion plus the trusted-input,
  secure-context, top-level and absent-Tauri-bridge assertions passed.
- DOM assignment/synthetic events can yield functional success but **must not**
  pass trusted-input acceptance. Current modular password filling may still use
  that path: this fixture deliberately exposes it rather than relaxing assertions.
- Native input integration must deliver paced CEF key events to the exact focused
  field. The fixture does not auto-focus, type, submit, or bypass MFA for the agent.
- `/staged` is a manual baseline; generic identifier-only/password-only automatic
  progression is not presently a supported custom modular contract. Do not claim it
  passed automatically and do not spoof a hosted Google origin to make it pass.
- Test blur/close/reconnect while input is pending in separate runs: no later
  successful stage should appear for the cancelled run. Native lifecycle ownership
  and authorization still need the auth agent's independent evidence.
- For automatic runs, keep hands off the keyboard/mouse and record that fact.
  Page-observed `isTrusted` cannot distinguish a person typing from CEF input, and
  an arbitrary forged POST can fabricate a receipt. This is a controlled acceptance
  fixture, not a security attestation against malicious page code.

The Node suite validates HTTPS, selectors, stage/nonce checks, report redaction,
synthetic-event rejection and cleanup. Positive receipts in Node tests are
explicit **models**, not live CEF evidence. Only main's later native run can establish
trusted-input acceptance. No app has been launched by creating/running this harness.
