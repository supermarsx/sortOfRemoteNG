# Restore connections and website sign-in

Enable **Settings → Startup → Reconnect previous sessions on startup**. Enable
**Restore previously open databases** as well to reopen their saved database set.
Protected databases still require their configured unlock method.

Startup reconnect uses the durable list of open connection tabs, including web
tabs and multiple tabs for one connection. It adopts surviving supported backend
sessions and otherwise connects afresh. The startup setting also permits older
snapshots; ordinary reload recovery retains its short freshness limit. Internal
tool tabs are excluded. Safe mode suspends automatic restoration.

For CEF form sign-in, save an automatic form login profile and its credentials in
the connection's authentication settings. Enable **Automatically submit sign-in**
there for submission as well as filling. This is an explicit per-connection
browser override; existing manual-submit choices remain in effect until changed.
Each reopened native tab obtains fresh consent from the saved connection and
unlocked database. Redirect destinations do not inherit credential permission.
Verification challenges require interaction unless supported automatic 2FA has
been configured and authorized for that destination.

Opening a connection tab and successful authentication are separate outcomes.
Unavailable servers, expired credentials and unsupported site login flows can
still prevent a successful connection. The automated checks cover restoration
and saved submission policy, not a live login to every website.
