# Vodafone Smart Router 3

In an HTTP/HTTPS connection, select **Vodafone Smart Router 3** under
**Website application**. Keep your router's own address, port and login path;
the profile never substitutes the My Vodafone customer portal or a default IP.
The **Vodafone router** icon is available in the icon picker and as a suggested
application icon. Existing custom icons are preserved.

Manual browsing is the default. To use saved connection or database-vault
credentials, explicitly choose **Automatic form login**. Prefer HTTPS when the
router supports it; HTTP remains unencrypted on the connection to the router.
Selecting this profile does not disable certificate verification or change
proxy routing or credential consent.

## Supported login layout

The adapter follows the supplied Smart Router 3 markup: `#mainbody #logindiv`
contains `input#username`, `input#userpwd[type=password]` and
`input#loginbtn[type=button][name=login]` with `onclick="SubmitForm();"`.
No enclosing form is assumed. The adapter waits for enabled, visible controls
and the site's own handler before requesting credentials, then clicks that
button once. The router retains responsibility for password processing and
its authentication requests; no guessed POST endpoint or hashing is used.

Duplicate controls, unexpected form associations, a visible login error,
missing/blocked handlers or changes during filling stop the attempt. A failed
password is not automatically retried. Firmware with a different layout can
still be used manually. If the site's inline handler is blocked by an existing
script policy, review that connection's script permissions; the profile does
not silently broaden them.

Fixture tests exercise the supplied DOM, handler readiness, one-shot
submission, cancellation, credential refusal and changed-control guards.
Live authenticated login on a physical router has not been verified.
