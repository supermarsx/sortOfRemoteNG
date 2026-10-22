---
title: Windmill application
eyebrow: Use the app
description: Windmill Cloud and self-hosted workflow application connections.
permalink: /windmill-application/
---

Choose **Business applications → Windmill** for the developer automation platform
at `https://app.windmill.dev/user/login`, or **Windmill (self-hosted)** for your own
instance. Cloud fills a blank address with its official HTTPS host and port 443;
an existing address is preserved until you use the explicit login-address action.
Self-hosted connections accept a hostname, IP address, or full HTTP(S) URL and
your deployment's port. A bare host opens `/user/login`; a full self-hosted URL
retains its path, query, and fragment. The official Docker Compose deployment
exposes HTTP on port 80 through Caddy; use the port and TLS termination actually
configured for your instance, rather than assuming the backend's port 8000.

Both presets start in **Manual browsing**. Select **Automatic form login** to
use the saved website email and password, including the existing credential-vault
selection. If the site shows SSO choices, open **Log in without third-party**
yourself to reveal the password form. The native login plan fills that reviewed
form on `/user/login` and presses Enter once when automatic submission is enabled.
With automatic submission disabled it only fills the fields. Windmill Cloud's
password option is available only for accounts enabled by Windmill; its public
login interface directs users to contact Windmill for password credentials.

OAuth/SSO, SAML, MFA, approval, signup, initial administrator setup, and password
reset remain interactive. An API token is not a website password. No identity
provider receives the saved Windmill credentials. A completed login plan means
that the input steps ran, not that Windmill accepted the account. The legacy
browser does not run these native login plans.

The presets use the normal browser script and request permissions. Existing
connection restrictions and proxy routing still apply. Selecting a preset never
changes a saved password, TLS policy, or icon. **Use suggested icon** explicitly
applies Windmill's publisher SVG mark.

The password controls and keyboard handler were reviewed in the official
[Login component](https://github.com/windmill-labs/windmill/blob/9202a74071ba424ad6cfc1cfded518ee7db002dc/frontend/src/lib/components/Login.svelte)
and [login route](https://github.com/windmill-labs/windmill/blob/9202a74071ba424ad6cfc1cfded518ee7db002dc/frontend/src/routes/%28root%29/%28logged%29/user/%28user%29/login/+page.svelte).
See also Windmill's [self-hosting guide](https://www.windmill.dev/docs/advanced/self_host)
and [authentication guide](https://www.windmill.dev/docs/core_concepts/authentication).
Validation uses synthetic fixtures and the native login client harness; no real
account or production-profile application was opened.
