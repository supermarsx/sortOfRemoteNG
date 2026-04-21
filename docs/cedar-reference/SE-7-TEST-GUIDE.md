# SE-7 End-to-End Test Guide

This guide is for the **SE-7 executor** (or any engineer running SoftEther
e2e tests against our Rust port). It explains how to stand up a local
SoftEther VPN server, verify it is healthy, and structure the test
scenarios SE-7 needs to cover.

SE-7 is about testing the **sorng-vpn** Rust port against a real upstream
SoftEther implementation. The port lives in
`src-tauri/crates/sorng-vpn/src/softether.rs` (and whatever submodules
SE-5 / SE-6 add). The server below is the **target**, not the port.

## 1. Start the server

```bash
cd docs/cedar-reference
docker compose -f docker-compose.softether-test.yml up -d
docker compose -f docker-compose.softether-test.yml ps
```

Expected: one running container `sorng-softether-test` with state
`healthy` within ~30 s (the healthcheck probes TCP/5555 locally).

First-time boot will create `vpn_server.config` inside the named volume
`sorng_softether_test_config`. Subsequent `up -d` calls reuse it.

## 2. Verify health

### TCP reachability

```bash
# PowerShell or bash — both work
nc -z -v 127.0.0.1 443
nc -z -v 127.0.0.1 5555
nc -z -v 127.0.0.1 992
```

### TLS handshake

```bash
openssl s_client -connect 127.0.0.1:5555 -servername vpn </dev/null 2>&1 \
  | grep -E "Verify return code|subject=|Cipher"
```

SoftEther ships with a self-signed cert by default. You'll see
`verify error:num=18:self-signed certificate` — that's expected. Cipher
should be something in the TLS1.2/1.3 modern set.

### Server logs

```bash
docker logs sorng-softether-test --tail 50
```

Look for `SoftEther VPN Server started` and the hub creation lines.

### Manage via vpncmd (optional)

```bash
docker exec -it sorng-softether-test vpncmd /server 127.0.0.1 \
  /password:test-admin-pwd-CHANGE-ME /adminhub:DEFAULT
```

Useful subcommands inside the shell: `HubList`, `UserList`, `SessionList`.

## 3. Test scenarios for SE-7

SE-7 should drive the Rust port's `SoftEtherService::connect(...)` against
the server above and assert wire-level correctness. Minimum suggested
matrix:

| # | Scenario                     | What it exercises                                                 |
|---|------------------------------|-------------------------------------------------------------------|
| 1 | Anonymous auth to DEFAULT    | Watermark handshake + PACK `hello` + trivial auth                 |
| 2 | Password auth as `testuser`  | SE-3's upper-case-username + Sha0(password + upper(user)) hash    |
| 3 | Cipher RC4 variant           | Legacy cipher path; asserts the port can fall through negotiation |
| 4 | Cipher AES128/256 variant    | Modern cipher; this is the default path                           |
| 5 | Small frame round-trip       | Send one ICMP-sized payload; assert echo/Hub loopback             |
| 6 | Keepalive after 30 s idle    | SE-5's `ConnectionSend` heartbeat timing (`KEEP_INTERVAL_*`)      |
| 7 | Disconnect + reconnect       | `CiReconnect` semantics; session reuse if applicable              |
| 8 | UDP-accel channel (SE-6)     | Falls back to TCP if UDP NAT blocked; assert both paths           |

Tests should be tagged `#[ignore]` by default (they require Docker) and
opt-in via `cargo test -- --ignored softether_e2e`. CI should gate them
behind a `--features e2e-docker` workspace feature.

### Recommended test scaffolding

Create `src-tauri/crates/sorng-vpn/tests/softether_e2e.rs`. Use
`tokio::test` + `reqwest` only for the pre-flight health probe; the
actual VPN handshake should use the port's own public API so the test
is hermetic to what SE-5/SE-6 landed.

Before every test run, reset server state:

```bash
docker compose -f docker-compose.softether-test.yml down -v
docker compose -f docker-compose.softether-test.yml up -d
```

The `-v` flag drops the `sorng_softether_test_config` volume so each CI
run starts from a known clean config.

## 4. Known Docker networking quirks

### Windows + WSL2

The Docker Desktop WSL2 backend binds published ports on the Windows
host network, not the WSL distro. If you run `cargo test` **inside** a
WSL shell, `127.0.0.1:5555` resolves inside the WSL network namespace
and the VPN container isn't there. Fixes:

- Use the WSL host IP: `cat /etc/resolv.conf | grep nameserver` gives
  the host gateway; or use `host.docker.internal` which Docker Desktop
  routes correctly from both WSL and Windows.
- Or run `cargo test` from a native Windows PowerShell — then
  `127.0.0.1:5555` works.

### Windows firewall

Docker Desktop normally adds rules automatically, but corporate group
policy sometimes overrides them. If the healthcheck passes but the Rust
port can't connect from outside the container, check:

```powershell
Get-NetFirewallRule -DisplayName "*Docker*" | Select-Object DisplayName, Enabled, Action
```

### macOS

Docker Desktop's VM has no kernel TAP/TUN, which only affects the **L2TP
UDP** ports — irrelevant for SE-5..SE-7 (we're testing the TLS-VPN path
on 443/992/5555).

## 5. Fallback: manual build

If `siomiz/softethervpn` ever falls behind upstream or becomes
unavailable:

1. Launch a plain `ubuntu:22.04` container with `--cap-add NET_ADMIN`.
2. Install build deps:
   `apt-get update && apt-get install -y gcc make libssl-dev libreadline-dev libncurses-dev zlib1g-dev`
3. Clone upstream:
   `git clone https://github.com/SoftEtherVPN/SoftEtherVPN_Stable.git`
4. `cd SoftEtherVPN_Stable && make && make install`
5. Run `vpnserver start` and configure via `vpncmd`.

This is slower (~3 min build) but unblocks SE-7 regardless of image
supply-chain state.

## 6. Teardown

```bash
docker compose -f docker-compose.softether-test.yml down -v
```

The `-v` removes the named volume. Omit it to preserve state across
invocations while iterating on a specific scenario.
