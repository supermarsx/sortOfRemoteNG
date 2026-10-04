# Private auto-login modules

`autologin_asset.rs` embeds these files in manifest order inside the private
IIFE in `../autologin_client.js`. These are source fragments, not ES modules:
there are no imports, new global registries, runtime file requests or build
dependencies. Execute the assembled client, never the coordinator template.
`tests/helpers/autologinAsset.ts` mirrors the native manifest for JS fixtures.

- Coordinator: idempotent installation, one-shot nonce redemption, closed flow
  dispatch, cancellation and transport-secret cleanup.
- `common/dom.js`: native setters, events, visibility and selector utilities.
- `common/guards.js`: shared target/action/method/origin validation and guarded
  submission. These protections apply to every ordinary form profile.
- `forms/generic.js`: conservative discovery, ordinary fill and submission.
- `forms/options.js`, `advanced.js`, `readiness.js`: option validation, bounded
  scheduling, explicit-selector readiness and per-run credential ownership.
- `apps/cpanel.js`: AJAX/session navigation, settle policy, readiness observers,
  cleanup and control-fingerprint state. Scheduler branches intentionally only
  choose this lifecycle, enforce the common origin/one-submit guard, schedule
  retries, and dispose application state with the run.
- `apps/porkbun.js`: reviewed custom-widget discovery and validation.
- `apps/joomla.js`: administrator form recognition and manual combined MFA.
- `apps/exchange_ecp.js`: shared on-premises Exchange forms authentication;
  distinct ECP/OWA selectors constrain the return destination to the selected
  application. Validates the POST and clicks the site's sign-in handler once.
- `apps/freepbx.js`: reviewed launcher navigation; `openFreepbxAdmin(ov)` uses
  shared `stopped`/`isVisible`, owns its attempt state and receives no secrets.

Bitwarden, Synology, Google, Cloudflare and Yealink retain their dedicated
staged clients, installed before the coordinator in the existing order.
Selector-only applications (including Nginx Proxy Manager) remain in the
reviewed profile catalog: they use common readiness/discovery rather than a
duplicate application selector catalog or invented application behavior.

Explicit selectors remain authoritative: a missing match never enables a
heuristic fallback. Unknown response flows or a response contradicting the
injected flow are rejected, as are missing adapter methods. Legacy staged
Bitwarden/Synology responses without an injected hint remain supported.
The scheduler alone owns its private credential copy until finish/cancel;
transport credentials, continuation tokens and extra-field values are cleared
in the coordinator's `finally`. Application lifecycle helpers must not copy
or retain those secrets. Nonces are redeemed once, same-origin and no-store.
