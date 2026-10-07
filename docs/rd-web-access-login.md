# RD Web Access / RemoteApp portal

The `rdweb` application preset supports optional **classic RD Web Access form login**. Manual login remains the default. It is not a universal Remote Desktop authentication adapter and signing into the portal does not launch a RemoteApp or native RDP connection.

## Configuration

Select **Windows RemoteApp / RD Web Access** for an HTTPS website connection. Use the organization's RDWeb server address; `/RDWeb/` lets the server choose its installed locale. An explicitly entered localized login path can also be retained. Do not replace the server address with an identity-provider address.

For automatic login, select **Automatic form login** and provide the website credentials, either locally on the connection or through its owning database credential vault. Enter the exact username accepted by the server, such as `DOMAIN\username` or `user@example.com`. The preset neither appends a domain nor repurposes the RDP domain setting. Do not use HTTP Basic or Digest as a substitute for forms authentication.

Manual mode does not retrieve or send the saved password. Form mode retains the existing consent, proxy-session and one-shot credential-delivery controls; the preset does not grant cross-origin destinations or create a direct-network fallback.

## Supported contract

The reviewed classic page has a POST form named and identified as `FrmLogin`, a text input `DomainUserName`, a password input `UserPass`, and an input submit button `btnSignIn`. Its action is the localized `login.aspx`, often with a server-provided `ReturnUrl` query. Matching uses these field names and IDs, not translated button text.

The existing form client waits for the selected controls to be visible before retrieving credentials. It fills them and clicks the page's own submit control once. That invokes the site's `onLoginFormSubmit` validation and hidden-state preparation; it does not manufacture an authentication POST or call `form.submit()` directly. The original action, return URL, hidden state and public/private computer selection are preserved. A submission result means the click was dispatched, not that the server accepted the credentials.

The preset refuses GET/missing-method forms, external actions, submit destination/method overrides, other form targets, disabled/readonly fields, password-change controls and the explicitly recognized challenge markers. Existing shared guards also reject a destination changed during filling. Cancellation stops a waiting attempt; failure does not cause a credential retry loop.

HTML5 Remote Desktop web clients, Entra/ADFS preauthentication, Windows-integrated authentication, passkeys, MFA and modified forms remain interactive. The preset adds no MFA selector or fallback heuristic. Unrecognized custom identity-provider controls are not supported. Explicit Advanced selector overrides are user-authored behavior, not part of this reviewed contract.

## Source evidence and limits

- [Microsoft's RDWeb troubleshooting documentation](https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/remote-desktop-web-access-troubleshooting) distinguishes portal login, password changes, public/private computer choices and RemoteApp launch.
- [Microsoft's RDWeb customization article](https://techcommunity.microsoft.com/blog/askperf/modifying-the-default-rdwebaccess-web-page-for-fun-and-profit/374837) identifies the localized classic pages and notes that installations can customize their forms.
- The exact controls and handler are supported by the [firsthand Server 2016 HTML and POST trace in the IBM Verify discussion](https://community.ibm.com/community/user/discussion/forms-based-sso-credential-pass-through), including the subsequent IBM specialist's RDWeb reproduction. This is historical primary implementation evidence, **not** a Microsoft guarantee that every RDWeb version, customization or MFA extension shares that DOM.

Tests use synthetic credential-free fixtures and the actual assembled auto-login client. They cover localized pages, exact domain/UPN account preservation, site submit-handler invocation, retained hidden fields, same-origin proxy-rewritten actions, hidden-page readiness, unsupported/unsafe forms, mutation, cancellation, user edits during a submit delay and one-shot behavior. No authenticated customer RDWeb server was exercised; successful live login still requires validation against the deployed server.

The URL-rewriting proxy currently injects the form client into document responses with `Content-Type: text/html`. Raw XML/XSL RDWeb responses are not covered by these HTML fixtures and need separate transport support/verification before automatic login can be claimed for that deployment. Changing the content-type label alone is not a safe substitute for correctly handling the document transformation. This is separate from the tested form selector and submission contract.

## Icon and central registration

`RD_WEB_APPLICATION_ICONS` exports the `rd-web-access` catalog entry: an app-authored browser window, remote screen and launch chevron. It uses `currentColor`, supports the existing theme and sizing controls, and is not an official Microsoft logo.

Integration points (owned by the central integration lane):

1. Import `RD_WEB_PROFILE` from `src/utils/connection/rdWebProfile.ts` and replace the inline manual `rdweb` entry in `HTTP_APPLICATION_PROFILES`. Keep the persisted ID `rdweb` unchanged.
2. Spread `RD_WEB_APPLICATION_ICONS` into `src/utils/icons/catalog/webApplications.ts`; set the `rdweb` application icon suggestion to `rd-web-access`. Preserve user-selected icon overrides.
3. Update the known-form expectation in `tests/utils/httpApplicationProfiles.test.ts`; update `tests/protocol/httpApplicationExternal.test.ts` so explicit `rdweb` form mode resolves the reviewed selectors while manual mode remains credential-free.
4. `tests/connectionEditor/RdWebApplication.test.tsx` verifies actual registry normalization, local/vault credential resolution, HTTPS target validation, the registered icon and editor opt-in. HTML form login needs no new backend application marker, staged flow, broad script permission or cross-origin credential grant; the XML/XSL limitation above is a separate transport concern.

Focused fixtures:

```powershell
npx vitest run tests/utils/rdWebProfile.test.ts tests/protocol/rdWebLoginClient.test.ts tests/icons/rdWebIcon.test.tsx tests/connectionEditor/RdWebApplication.test.tsx
```
