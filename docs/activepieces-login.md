---
title: Activepieces website login
eyebrow: Use the app
description: Cloud and self-hosted Activepieces connections, password assistance and interactive authentication.
permalink: /activepieces-login/
---

Choose **Business applications → Activepieces Cloud** or **Activepieces (self-hosted)** in the HTTP/HTTPS Application settings. Selection starts in Manual browsing. The Cloud preset fills a blank connection with `cloud.activepieces.com` on HTTPS port 443; an existing address is preserved and must match the Cloud origin before connecting. The self-hosted preset uses your website URL, hostname or IP address and configured port. A bare host starts at `/sign-in`; a supplied self-hosted URL retains its path, query and fragment.

The [official single-container example](https://www.activepieces.com/docs/install/options/docker) publishes HTTP port 8080. Enter that port explicitly for such an installation; selecting the preset does not assume it or change an existing destination. Use the website address configured by your administrator, not an API endpoint. Activepieces has no default account: first-user registration is interactive.

Select **Automatic form login** separately to use connection-local or database-vault website email and password. This uses the existing native browser credential authority on the exact saved origin (Cloud is pinned to `https://cloud.activepieces.com`). It fills only the reviewed password sign-in controls on `/sign-in` and clicks once when automatic submission is enabled. Fill-only mode leaves submission to you. API keys are not website passwords.

If Activepieces presents email-code login, choose **Use password** on the website before starting automatic login. If the attempt has already stopped, retry after the password form is visible. Email codes, Google/SAML SSO, CAPTCHA, MFA, device approval, invitations, signup and recovery remain interactive. Administrators can disable password login; use the website's enabled method in that case. No authenticator-code automation or identity-provider credential grant is added.

The presets retain normal browser defaults, website script controls and explicit domain restrictions. Requests continue through the existing application proxy; native session ownership and credential consent remain separate from resource permissions. The suggested Activepieces icon is optional and never replaces an existing icon automatically.

The [published sign-in form](https://github.com/activepieces/activepieces/blob/5da73236367bf9bfb16279ecb060c50300354201/packages/web/src/features/authentication/components/sign-in-form.tsx) and [method selection](https://github.com/activepieces/activepieces/blob/5da73236367bf9bfb16279ecb060c50300354201/packages/web/src/features/authentication/components/auth-landing/auth-drawer-body.tsx) were reviewed on 2026-10-22. Tests use synthetic fixtures and the native-login harness. They establish selector and consent behavior, not successful authentication against a real account or every deployed Activepieces version.
