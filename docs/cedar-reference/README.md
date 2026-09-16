# Cedar / Mayaqua Reference Source

## Purpose

This directory holds a **reference-only** snapshot of the relevant C source
files from [SoftEtherVPN_Stable][upstream] that the SE-5..SE-7 executors need
in order to clean-room port the SoftEther protocol data-plane into the
`sorng-vpn` crate's `softether` module (`src-tauri/crates/sorng-vpn/src/softether/`).

**This is NOT a build dependency.** Nothing in the Rust workspace links to,
includes, or compiles any file under this directory. It exists purely so
that a human (or model) writing Rust code can consult the exact upstream C
for wire-format details, loop structure, watermark contents, and the
password-hash construction.

Clean-room porting guidelines: read the reference to understand the protocol,
then write Rust from scratch using idiomatic types (`tokio`, `bytes`, `ring`,
etc.). Do not mechanically translate line-for-line; do not copy comments
verbatim into the Rust file.

## Upstream snapshot

| Field       | Value                                                                     |
|-------------|---------------------------------------------------------------------------|
| Repository  | <https://github.com/SoftEtherVPN/SoftEtherVPN_Stable>                     |
| Commit SHA  | `ed17437af9719ac66acab30faa29e375d613c35f`                                |
| Tag         | `v4.44-9807-rtm` (2025-04-16)                                             |
| Fetched via | `raw.githubusercontent.com/.../<SHA>/src/<path>` (per-file, no git clone) |

## License

SoftEtherVPN_Stable is distributed under the **Apache License 2.0** (see
upstream `LICENSE` file, archived here as `LICENSE-UPSTREAM.txt`). Apache-2.0
is compatible with the host project's MIT license for reference/reading
purposes. No Apache-2.0 source is redistributed as part of a sortOfRemoteNG
binary artifact — these files are committed only as documentation to the
repository tree.

Attribution preserved: every file retains its original upstream header
comment (`// SoftEther VPN Source Code ...` + copyright block).

## File inventory

### `Cedar/` — VPN protocol layer
- `Connection.c` / `Connection.h` — main connection state machine,
  `ConnectionSend`, `ConnectionReceive`, `ConnectionAccept`, watermark
  handshake framing, keepalive, payload multiplexing.
- `Session.c` / `Session.h` — session lifecycle, `ClientThread`,
  reconnect / retry logic, session capabilities.
- `Protocol.c` / `Protocol.h` — already partially consumed by SE-1
  (PACK codec); re-snapshotted for alignment with the other files.
- `WaterMark.c` — the 1411-byte magic blob sent during handshake (used
  by SE-2; kept here so it tracks Connection.c).
- `UdpAccel.c` / `UdpAccel.h` — R-UDP acceleration channel (SE-6).
- `Client.c` / `Client.h` — `CiReconnect`, client-side account/config
  state, cipher negotiation hooks (SE-6).
- `Listener.c` / `Listener.h` — server-side accept loop; included for
  *reading* the other side of the protocol, not for porting.

### `Mayaqua/` — platform + utility layer
- `Encrypt.c` / `Encrypt.h` — **Sha0**, HashSha1, Md5, cipher setup.
  SoftEther's password-hashing "bug" (uppercased username +
  password + Sha0) lives here and is highly load-bearing for SE-3.
- `Pack.c` / `Pack.h` — PACK wire codec (was listed as `Cedar/Pack.*`
  in the original brief; actually lives under Mayaqua upstream).
- `Network.c` / `Network.h` — socket wrapping for **reference only**
  (our Rust port uses `tokio` — see framing patterns like `SendAll`,
  `RecvAll`, length-prefixed reads).
- `Str.c` / `Str.h` — `StrUpper`, `Trim`, `Format`. Relevant to SE-3
  (password hash uses `StrUpper` on the username!).
- `Memory.c` / `Memory.h` — `Buf` functions (`NewBuf`, `WriteBuf`,
  `ReadBuf`), the backing store for PACK marshaling.
- `Table.h` — header only, for constant sanity.

### Corrections vs original brief
The original t2 plan listed `Cedar/Pack.c`, `Cedar/Pack.h`, `Cedar/Encrypt.c`,
`Cedar/Encrypt.h`. Upstream has never shipped those files in `Cedar/` — PACK
and Encrypt are Mayaqua-layer utilities. The snapshot corrects this by
fetching `Mayaqua/Pack.*` and `Mayaqua/Encrypt.*`.

## Update procedure

To refresh against a newer upstream release:

1. Fetch the current `master` commit SHA:
   `curl -s https://api.github.com/repos/SoftEtherVPN/SoftEtherVPN_Stable/commits/master | jq -r .sha`
2. Re-run the `cedar-ref` executor with the new SHA.
3. Re-record the SHA and tag name in the table above.
4. Re-read SE-5's port for any upstream API breaks.

Do **not** hand-edit files here. If an upstream file changes and the port
needs to follow, update the port, not this snapshot.

[upstream]: https://github.com/SoftEtherVPN/SoftEtherVPN_Stable
