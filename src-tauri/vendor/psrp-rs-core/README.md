# psrp-rs

> **Vendored core note:** this is the upstream 1.0.0 README retained for
> attribution and API context. The local core fork excludes the upstream SSH
> adapter and makes WinRM optional. See [PATCHES.md](PATCHES.md) before using
> any transport examples below.

Async [PowerShell Remoting Protocol (MS-PSRP)](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-psrp/) client for Rust.

[![Crates.io](https://img.shields.io/crates/v/psrp-rs.svg)](https://crates.io/crates/psrp-rs)
[![docs.rs](https://img.shields.io/docsrs/psrp-rs)](https://docs.rs/psrp-rs)
[![License](https://img.shields.io/crates/l/psrp-rs.svg)](LICENSE-MIT)
[![MSRV](https://img.shields.io/badge/MSRV-1.94-blue.svg)](https://blog.rust-lang.org/2026/03/20/Rust-1.94.0.html)

```rust
use psrp_rs::{RunspacePool, WinrmPsrpTransport};
use winrm_rs::{WinrmClient, WinrmConfig, WinrmCredentials};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = WinrmClient::new(
        WinrmConfig::default(),
        WinrmCredentials::new("administrator", "secret", ""),
    )?;

    let (rpid, creation) = RunspacePool::<WinrmPsrpTransport>::build_creation_fragments(1, 1)?;
    let transport = WinrmPsrpTransport::open(&client, "win-server", &creation).await?;
    let mut pool = RunspacePool::open_from_transport(transport, rpid, 1, 1).await?;

    let objects = pool.run_script("Get-Process | Select-Object -First 5 Name, Id").await?;
    for obj in objects {
        println!("{obj:?}");
    }

    pool.close().await?;
    Ok(())
}
```

## Features

- **Typed PowerShell objects** -- Output stream returns `PsValue` / `PsObject` with properties, not raw strings
- **All 7 PSRP streams** -- Output, Error, Warning, Verbose, Debug, Information, Progress, each isolated
- **Pipeline builder** -- compose multi-command pipelines with named parameters, positional arguments, and switches
- **Persistent runspace pool** -- keeps a `powershell.exe` process alive across many pipelines
- **Cancellation** -- `CancellationToken`-based abort for long-running scripts
- **Session-key cryptography** -- RSA key exchange + AES-256-CBC for `SecureString` encrypt/decrypt
- **Host call dispatch** -- pluggable `PsHost` trait for interactive prompts (`Read-Host`, `Write-Host`, etc.)
- **Command metadata** -- `Get-Command` introspection via `get_command_metadata`
- **Shared pool** -- `SharedRunspacePool` for multi-task access behind `Arc<Mutex<_>>`
- **Blocking wrapper** -- synchronous API for CLI tools and scripts
- **SSH transport** -- feature-gated (`--features ssh`) alternative to WinRM via `russh`
- **Pure Rust** -- no C dependencies, `#![forbid(unsafe_code)]`

## Installation

```sh
cargo add psrp-rs

# For SSH transport:
cargo add psrp-rs --features ssh

# For serde support on PsValue/PsObject:
cargo add psrp-rs --features serde
```

## Usage

### Run a script and collect output

```rust
use psrp_rs::{RunspacePool, WinrmPsrpTransport};
use winrm_rs::{AuthMethod, WinrmClient, WinrmConfig, WinrmCredentials};

let client = WinrmClient::new(
    WinrmConfig {
        auth_method: AuthMethod::Ntlm,
        ..Default::default()
    },
    WinrmCredentials::new("administrator", "Passw0rd!", "MYDOMAIN"),
)?;

let (rpid, creation) = RunspacePool::<WinrmPsrpTransport>::build_creation_fragments(1, 1)?;
let transport = WinrmPsrpTransport::open(&client, "win-server", &creation).await?;
let mut pool = RunspacePool::open_from_transport(transport, rpid, 1, 1).await?;

let objects = pool
    .run_script("Get-Process | Select-Object -First 5 Name, Id")
    .await?;

for obj in objects {
    println!("{obj:?}");
}

pool.close().await?;
```

### Pipeline builder with parameters

```rust
use psrp_rs::{Command, Pipeline, PsValue};

let result = Pipeline::empty()
    .add_command(
        Command::new("Get-Service")
            .with_parameter("Name", PsValue::String("WinRM".into()))
    )
    .add_command(
        Command::new("Select-Object")
            .with_parameter("Property", PsValue::String("Status,Name,DisplayName".into()))
    )
    .run_all_streams(&mut pool)
    .await?;

for obj in &result.output {
    println!("{obj:?}");
}
for err in result.typed_errors() {
    eprintln!("ERROR: {:?}", err.exception);
}
for warn in result.typed_warnings() {
    eprintln!("WARN: {}", warn.message);
}
```

### Capture all streams

```rust
use psrp_rs::Pipeline;

let result = Pipeline::new("Write-Warning 'careful'; Write-Output 42")
    .run_all_streams(&mut pool)
    .await?;

println!("Output:   {:?}", result.output);
println!("Warnings: {:?}", result.warnings);
println!("Errors:   {:?}", result.errors);
println!("Verbose:  {:?}", result.verbose);
println!("Debug:    {:?}", result.debug);
println!("Info:     {:?}", result.information);
println!("Progress: {:?}", result.progress);
```

### Cancel a long-running script

```rust
use tokio_util::sync::CancellationToken;
use psrp_rs::PsrpError;

let cancel = CancellationToken::new();
let token = cancel.clone();

tokio::spawn(async move {
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    token.cancel();
});

match pool.run_script_with_cancel("Start-Sleep -Seconds 300", cancel).await {
    Err(PsrpError::Cancelled) => println!("Script was cancelled"),
    other => println!("{other:?}"),
}
```

### Blocking API

```rust
use psrp_rs::blocking;
use winrm_rs::{WinrmClient, WinrmConfig, WinrmCredentials};

let client = WinrmClient::new(
    WinrmConfig::default(),
    WinrmCredentials::new("admin", "password", ""),
)?;

let objects = blocking::run_script(&client, "win-server", "hostname")?;
println!("{objects:?}");
```

### SSH transport

```rust
// Requires: cargo add psrp-rs --features ssh
use psrp_rs::{RunspacePool, SshConfig, SshAuth, SshPsrpTransport};

let transport = SshPsrpTransport::connect(SshConfig {
    host: "win-server".into(),
    port: 22,
    username: "admin".into(),
    auth: SshAuth::Password("Passw0rd!".into()),
    ..Default::default()
}).await?;

let mut pool = RunspacePool::open_with_transport(transport).await?;
let result = pool.run_script("$PSVersionTable").await?;
pool.close().await?;
```

### Shared pool for concurrent tasks

```rust
use psrp_rs::SharedRunspacePool;

let shared = SharedRunspacePool::new(pool);

let s1 = shared.clone();
let t1 = tokio::spawn(async move { s1.run_script("Get-Date").await });

let s2 = shared.clone();
let t2 = tokio::spawn(async move { s2.run_script("hostname").await });

let (r1, r2) = tokio::join!(t1, t2);
shared.close().await?;
```

## Configuration

`psrp-rs` reuses [`WinrmConfig`](https://docs.rs/winrm-rs/latest/winrm_rs/struct.WinrmConfig.html)
from `winrm-rs` for transport-level settings (auth method, TLS, timeouts, proxy).
See the [winrm-rs documentation](https://docs.rs/winrm-rs) for the full list of config fields.

Pool-level parameters:

| Parameter | Default | Description |
|---|---|---|
| `min_runspaces` | `1` | Minimum number of runspaces the server should maintain |
| `max_runspaces` | `1` | Maximum concurrent runspaces (controls server-side parallelism) |

Set via `RunspacePool::open_with_options(transport, min, max)` or
`build_creation_fragments(min, max)` + `open_from_transport(...)`.

## Roadmap

| Version | Milestone | Status |
|---|---|---|
| **v1.0** | Full PSRP: CLIXML, fragments, runspace pool, pipeline builder, all 7 streams, typed records, host calls, session-key crypto, SSH transport, blocking API, shared pool, cancellation | **Current** |
| **v1.x** | Pipeline input streaming, disconnect/reconnect pool, CLIXML `<Ref>` round-tripping | Planned |

## Comparison

| | **psrp-rs** | **pypsrp** (Python) | **PowerShell SDK** (.NET) |
|---|---|---|---|
| Language | Rust | Python | C# |
| Async | native async/await | no | `Task`-based |
| Typed output | `PsValue` / `PsObject` | dict-based | `PSObject` |
| All 7 streams | yes | yes | yes |
| Pipeline builder | yes | yes | yes |
| Host callbacks | pluggable `PsHost` trait | no | `PSHost` |
| Session-key crypto | RSA + AES (pure Rust) | yes | built-in |
| SSH transport | `russh` (feature-gated) | yes | built-in |
| Auth methods | NTLMv2, Basic, Kerberos, Certificate (via winrm-rs) | NTLM, Basic, Kerberos, CredSSP | all |
| TLS backend | rustls (pure Rust) | OpenSSL | SChannel / OpenSSL |
| Binary size | single static binary | interpreter | runtime |
| C dependencies | none | OpenSSL | CLR |

## Contributing

Contributions are welcome. Please open an issue to discuss larger changes before submitting a PR.

```sh
cargo test --lib         # run unit tests
cargo clippy --all-targets  # lint
cargo fmt --check        # format check
```

## Integration tests

Unit tests and end-to-end tests run against a mock transport and need no
external setup. The file [`tests/integration_real.rs`](tests/integration_real.rs)
targets a real Windows host and is ignored by default. To run it, set the
following environment variables and use `--ignored`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PSRP_INTEGRATION_HOST` | yes | -- | Hostname or IP of the target Windows box |
| `PSRP_INTEGRATION_USER` | no | `vagrant` | Username |
| `PSRP_INTEGRATION_PASS` | no | `vagrant` | Password |

A [`Vagrantfile`](Vagrantfile) is provided to spin up a disposable Windows
Server 2025 Hyper-V VM with WinRM + PSRP pre-configured:

```sh
vagrant.exe up --provider=hyperv
vagrant.exe ssh -c "ipconfig"     # grab the VM IP

PSRP_INTEGRATION_HOST=<ip> \
PSRP_INTEGRATION_USER=vagrant \
PSRP_INTEGRATION_PASS=vagrant \
  cargo test --test integration_real -- --ignored
```

## Cargo features

| Feature | Default | Description |
|---|---|---|
| *(default)* | -- | WinRM transport with NTLMv2/Basic/Kerberos/Certificate auth (via winrm-rs) |
| `ssh` | no | SSH transport via `russh` |
| `serde` | no | `Serialize`/`Deserialize` derives on `PsValue` / `PsObject` |

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT License](LICENSE-MIT) at your option.
