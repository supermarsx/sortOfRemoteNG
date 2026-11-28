# SSH connection overrides and handshake evidence

The connection editor separates connection timing, TCP and protocol options from
credentials. SSH panels in the subtabs stay open. Protocol → Security exposes
ordered lists for key exchange, ciphers, MACs and host-key signatures. Complete
algorithm names are retained; names that differ after `@` remain distinct.

Unchecked controls inherit the global value. Enabling an override copies that
value into the connection. Resetting a field removes both the new override and
its older terminal/flat representation. Existing terminal protocol overrides
are read until changed or reset; unrelated terminal appearance is preserved.
An explicit empty algorithm override selects the library default list. Where
no global protocol algorithm list was chosen, the older global terminal list
continues to supply the inherited algorithms.

Terminal connections now pass the effective protocol settings to `connect_ssh`,
including timeout, SSH keepalive, TCP options and all four algorithm families.
Zero SSH keepalive disables it. Strict Trust Center policy still requires host
verification even when another legacy verification toggle is disabled. The
ssh2/libssh2 backend supports SSH-2; Auto also uses SSH-2. Requests for other
protocol versions fail explicitly.

A handshake failure records evidence from the actual routed connection, before
authentication: UTC time, stage or hop, native code and message, server banner,
configured preferences, algorithms supported by this client build, unsupported
configured names and partial selected methods. Selected methods after failure
are not proof of encryption or verified server identity. A wholly unsupported
algorithm family is rejected before handshake; no preference fallback is added.
Connection tests apply the same algorithm preferences as real connections.

The API does not expose the complete server proposal or the crypto provider's
internal failure. Generic KEX errors therefore remain undetermined. Correlate
the recorded time with server SSH logs for the server-side reason. These details
use the existing failure UI and copying path; credentials, private keys and
packet traces are not collected. Standalone diagnostic probes remain separate
and do not establish production route parity.
