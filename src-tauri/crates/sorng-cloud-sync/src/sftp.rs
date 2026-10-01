//! Pinned SSH application-data transport. SFTP v3 plus the explicit OpenSSH atomic
//! rename extension; never emulate replacement by deleting the destination.
use crate::types::{Blob, SyncError, Target, TransportOptions, Written};
use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
    Engine,
};
use russh::{
    client,
    keys::{self, PrivateKeyWithHashAlg},
    Disconnect,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    time::{timeout, Instant},
};

const FILE: &str = "application-data.v1.sorng";
const DEADLINE: Duration = Duration::from_secs(300);
const PACKET_LIMIT: usize = 64 * 1024;
const CHUNK: usize = 16 * 1024;

fn invalid() -> SyncError {
    SyncError::Invalid("Invalid SFTP configuration, path, key, or revision.".into())
}
fn transport() -> SyncError {
    SyncError::Transport("SFTP operation failed or timed out. An interrupted writer may leave a lock; do not remove it while another sync is running.".into())
}
fn conflict() -> SyncError {
    SyncError::Conflict("SFTP data changed or a cooperative writer lock is already held.".into())
}
fn trust() -> SyncError {
    SyncError::Trust("SFTP requires the configured server's verified SHA256 host-key fingerprint; the server key was not accepted.".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
    folder_path: String,
    auth_method: String,
    host_key_fingerprint: String,
}

impl Config {
    fn parse(target: &Target) -> Result<Self, SyncError> {
        if target.provider != "sftp" {
            return Err(invalid());
        }
        let value = target.sftp.as_ref().ok_or_else(invalid)?;
        let config: Self = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
        if config.host.is_empty()
            || config.host.len() > 253
            || config.port == 0
            || config.host.chars().any(|c| {
                c.is_whitespace() || c.is_control() || matches!(c, '/' | '\\' | '@' | '?' | '#')
            })
            || config.username.is_empty()
            || config.username.len() > 1024
            || config.username.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        folder(&config.folder_path)?;
        fingerprint(&config.host_key_fingerprint)?;
        match config.auth_method.as_str() {
            "password"
                if config
                    .password
                    .as_ref()
                    .is_some_and(|v| !v.is_empty() && v.len() <= 16_384) => {}
            "key"
                if config
                    .private_key
                    .as_ref()
                    .is_some_and(|v| !v.is_empty() && v.len() <= 65_536)
                    && config.passphrase.as_ref().is_none_or(|v| v.len() <= 16_384) => {}
            _ => return Err(invalid()),
        }
        Ok(config)
    }
}

fn fingerprint(value: &str) -> Result<[u8; 32], SyncError> {
    let text = value.strip_prefix("SHA256:").ok_or_else(trust)?;
    let bytes = STANDARD_NO_PAD.decode(text).map_err(|_| trust())?;
    let result: [u8; 32] = bytes.try_into().map_err(|_| trust())?;
    if STANDARD_NO_PAD.encode(result) != text {
        return Err(trust());
    }
    Ok(result)
}

fn folder(value: &str) -> Result<String, SyncError> {
    if value.len() > 4096 || value.chars().any(|c| c.is_control() || c == '\\') {
        return Err(invalid());
    }
    let trimmed = value.trim_matches('/');
    if !trimmed.is_empty()
        && trimmed
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(invalid());
    }
    if value.starts_with("//") || value.starts_with('~') {
        return Err(invalid());
    }
    if trimmed.is_empty() {
        return Ok(if value.starts_with('/') { "/" } else { "." }.into());
    }
    Ok(format!(
        "{}{trimmed}",
        if value.starts_with('/') { "/" } else { "" }
    ))
}

fn path(directory: &str, name: &str) -> String {
    format!("{}/{name}", directory.trim_end_matches('/'))
}
fn revision(data: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(data)))
}
fn validate_revision(value: Option<&str>) -> Result<(), SyncError> {
    if value.is_some_and(|v| {
        !v.strip_prefix("sha256:").is_some_and(|h| {
            h.len() == 64
                && h.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    }) {
        return Err(invalid());
    }
    Ok(())
}
fn compare_revision(actual: Option<&[u8]>, expected: Option<&str>) -> Result<(), SyncError> {
    match (actual, expected) {
        (None, None) => Ok(()),
        (Some(data), Some(expected)) if revision(data) == expected => Ok(()),
        _ => Err(conflict()),
    }
}

struct HostKey {
    expected: [u8; 32],
    rejected: Arc<AtomicBool>,
}
impl client::Handler for HostKey {
    type Error = russh::Error;
    async fn check_server_key(&mut self, key: &keys::PublicKey) -> Result<bool, Self::Error> {
        let actual = fingerprint(&key.fingerprint(keys::HashAlg::Sha256).to_string());
        let accepted = actual.is_ok_and(|v| {
            v.iter()
                .zip(self.expected)
                .fold(0u8, |a, (x, y)| a | (*x ^ y))
                == 0
        });
        if !accepted {
            self.rejected.store(true, Ordering::Relaxed);
        }
        Ok(accepted)
    }
}

// Bound encrypted OpenSSH bcrypt work before sending it to a blocking worker.
// Other encrypted containers are rejected rather than accepting unbounded KDF costs.
fn validate_key_work(key: &str) -> Result<(), SyncError> {
    if key.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
        let encoded: String = key
            .lines()
            .filter(|line| !line.starts_with("-----"))
            .collect();
        let decoded = STANDARD.decode(encoded).map_err(|_| invalid())?;
        let rest = decoded
            .strip_prefix(b"openssh-key-v1\0")
            .ok_or_else(invalid)?;
        let mut cursor = Cursor(rest);
        let cipher = cursor.string()?;
        let kdf = cursor.string()?;
        let options = cursor.string()?;
        match (cipher, kdf) {
            (b"none", b"none") if options.is_empty() => {}
            (_, b"bcrypt") => {
                let mut opts = Cursor(options);
                let salt = opts.string()?;
                let rounds = opts.u32()?;
                if !(16..=64).contains(&salt.len())
                    || !(1..=128).contains(&rounds)
                    || !opts.0.is_empty()
                {
                    return Err(invalid());
                }
            }
            _ => return Err(invalid()),
        }
    } else if !(key.starts_with("-----BEGIN PRIVATE KEY-----")
        || key.starts_with("-----BEGIN RSA PRIVATE KEY-----")
        || key.starts_with("-----BEGIN EC PRIVATE KEY-----"))
        || key.contains("ENCRYPTED")
    {
        return Err(SyncError::Invalid("Use an OpenSSH private key (optionally passphrase-encrypted) or an unencrypted PEM private key.".into()));
    }
    Ok(())
}

async fn connect(
    config: Config,
) -> Result<
    (
        client::Handle<HostKey>,
        Wire<impl AsyncRead + AsyncWrite + Unpin>,
    ),
    SyncError,
> {
    let expected = fingerprint(&config.host_key_fingerprint)?;
    let key = if config.auth_method == "key" {
        let text = config.private_key.ok_or_else(invalid)?;
        validate_key_work(&text)?;
        let passphrase = if text.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
            config.passphrase
        } else {
            // PEM is supported only unencrypted; never invoke an unbounded
            // PKCS#8 KDF hidden beneath an unencrypted-looking PEM label.
            None
        };
        Some(
            tokio::task::spawn_blocking(move || {
                keys::decode_secret_key(&text, passphrase.as_deref()).map_err(|_| {
                    SyncError::Authentication(
                        "SFTP private key or passphrase was not accepted.".into(),
                    )
                })
            })
            .await
            .map_err(|_| transport())??,
        )
    } else {
        None
    };
    let rejected = Arc::new(AtomicBool::new(false));
    let client_config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(30)),
        keepalive_interval: Some(Duration::from_secs(10)),
        keepalive_max: 2,
        channel_buffer_size: 4,
        window_size: 128 * 1024,
        nodelay: true,
        ..Default::default()
    });
    let mut session = client::connect(
        client_config,
        (config.host.as_str(), config.port),
        HostKey {
            expected,
            rejected: rejected.clone(),
        },
    )
    .await
    .map_err(|_| {
        if rejected.load(Ordering::Relaxed) {
            trust()
        } else {
            transport()
        }
    })?;
    let auth = if let Some(key) = key {
        let hash = session
            .best_supported_rsa_hash()
            .await
            .map_err(|_| transport())?
            .flatten();
        session
            .authenticate_publickey(
                config.username,
                PrivateKeyWithHashAlg::new(Arc::new(key), hash),
            )
            .await
    } else {
        session
            .authenticate_password(config.username, config.password.ok_or_else(invalid)?)
            .await
    }
    .map_err(|_| SyncError::Authentication("SFTP authentication failed.".into()))?;
    if !auth.success() {
        return Err(SyncError::Authentication(
            "SFTP authentication was not completed; interactive authentication is unsupported."
                .into(),
        ));
    }
    let channel = session
        .channel_open_session()
        .await
        .map_err(|_| transport())?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|_| transport())?;
    let wire = Wire::new(channel.into_stream()).await?;
    Ok((session, wire))
}

struct Cursor<'a>(&'a [u8]);
impl<'a> Cursor<'a> {
    fn take(&mut self, size: usize) -> Result<&'a [u8], SyncError> {
        if size > self.0.len() {
            return Err(transport());
        }
        let (value, rest) = self.0.split_at(size);
        self.0 = rest;
        Ok(value)
    }
    fn u32(&mut self) -> Result<u32, SyncError> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().map_err(|_| transport())?,
        ))
    }
    fn u64(&mut self) -> Result<u64, SyncError> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().map_err(|_| transport())?,
        ))
    }
    fn string(&mut self) -> Result<&'a [u8], SyncError> {
        let size = self.u32()? as usize;
        self.take(size)
    }
}
fn string(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value);
}

#[derive(PartialEq)]
struct Attributes {
    size: Option<u64>,
    mode: Option<u32>,
    modified: Option<u32>,
}
impl Attributes {
    fn parse(value: &[u8]) -> Result<Self, SyncError> {
        let mut cursor = Cursor(value);
        let flags = cursor.u32()?;
        if flags & !15 != 0 {
            return Err(transport());
        }
        let size = if flags & 1 != 0 {
            Some(cursor.u64()?)
        } else {
            None
        };
        if flags & 2 != 0 {
            cursor.take(8)?;
        }
        let mode = if flags & 4 != 0 {
            Some(cursor.u32()?)
        } else {
            None
        };
        let modified = if flags & 8 != 0 {
            cursor.u32()?;
            Some(cursor.u32()?)
        } else {
            None
        };
        if !cursor.0.is_empty() {
            return Err(transport());
        }
        Ok(Self {
            size,
            mode,
            modified,
        })
    }
    fn regular(&self, limit: usize) -> Result<(), SyncError> {
        if self.mode.map(|v| v & 0o170000) != Some(0o100000)
            || self.size.is_none_or(|v| v > limit as u64)
        {
            return Err(invalid());
        }
        Ok(())
    }
}

struct Reply {
    kind: u8,
    payload: Vec<u8>,
}
impl Reply {
    fn code(&self) -> Result<u32, SyncError> {
        if self.kind != 101 {
            return Err(transport());
        }
        Cursor(&self.payload).u32()
    }
    fn success(self) -> Result<(), SyncError> {
        match self.code()? {
            0 => Ok(()),
            3 => Err(SyncError::Authentication(
                "SFTP file access was denied.".into(),
            )),
            _ => Err(transport()),
        }
    }
}

struct Wire<S> {
    stream: S,
    id: u32,
    atomic_rename: bool,
}
impl<S: AsyncRead + AsyncWrite + Unpin> Wire<S> {
    async fn new(stream: S) -> Result<Self, SyncError> {
        let mut wire = Self {
            stream,
            id: 0,
            atomic_rename: false,
        };
        wire.send(&[1, 0, 0, 0, 3]).await?;
        let packet = wire.receive().await?;
        let mut cursor = Cursor(&packet);
        if cursor.take(1)? != [2] || cursor.u32()? != 3 {
            return Err(transport());
        }
        while !cursor.0.is_empty() {
            let name = cursor.string()?;
            let version = cursor.string()?;
            if name == b"posix-rename@openssh.com" && version == b"1" {
                wire.atomic_rename = true;
            }
        }
        Ok(wire)
    }
    async fn send(&mut self, packet: &[u8]) -> Result<(), SyncError> {
        if packet.is_empty() || packet.len() > PACKET_LIMIT {
            return Err(transport());
        }
        self.stream
            .write_u32(packet.len() as u32)
            .await
            .map_err(|_| transport())?;
        self.stream
            .write_all(packet)
            .await
            .map_err(|_| transport())?;
        self.stream.flush().await.map_err(|_| transport())
    }
    async fn receive(&mut self) -> Result<Vec<u8>, SyncError> {
        let length = self.stream.read_u32().await.map_err(|_| transport())? as usize;
        if length == 0 || length > PACKET_LIMIT {
            return Err(transport());
        }
        let mut packet = vec![0; length];
        self.stream
            .read_exact(&mut packet)
            .await
            .map_err(|_| transport())?;
        Ok(packet)
    }
    async fn request(&mut self, kind: u8, payload: &[u8]) -> Result<Reply, SyncError> {
        self.id = self.id.checked_add(1).ok_or_else(transport)?;
        let mut packet = vec![kind];
        packet.extend_from_slice(&self.id.to_be_bytes());
        packet.extend_from_slice(payload);
        self.send(&packet).await?;
        let packet = self.receive().await?;
        let mut cursor = Cursor(&packet);
        let kind = cursor.take(1)?[0];
        if cursor.u32()? != self.id {
            return Err(transport());
        }
        Ok(Reply {
            kind,
            payload: cursor.0.to_vec(),
        })
    }
    async fn stat(&mut self, path: &str) -> Result<Option<Attributes>, SyncError> {
        let mut payload = Vec::new();
        string(&mut payload, path.as_bytes());
        let reply = self.request(7, &payload).await?; // LSTAT: never deliberately follow a symlink.
        if reply.kind == 105 {
            return Ok(Some(Attributes::parse(&reply.payload)?));
        }
        if reply.code()? == 2 {
            return Ok(None);
        }
        reply.success()?;
        Err(transport())
    }
    async fn directory(&mut self, directory: &str, create: bool) -> Result<bool, SyncError> {
        let mut current = if directory.starts_with('/') {
            String::new()
        } else {
            ".".to_owned()
        };
        if directory == "/" {
            current = "/".into();
        }
        let components: Vec<&str> = if directory == "." || directory == "/" {
            vec![""]
        } else {
            directory.trim_matches('/').split('/').collect()
        };
        for component in components {
            if !component.is_empty() {
                current.push('/');
                current.push_str(component);
            }
            let attrs = match self.stat(&current).await? {
                Some(attrs) => attrs,
                None if create && !component.is_empty() => {
                    let mut payload = Vec::new();
                    string(&mut payload, current.as_bytes());
                    payload.extend_from_slice(&4u32.to_be_bytes());
                    payload.extend_from_slice(&0o700u32.to_be_bytes());
                    let response = self.request(14, &payload).await?;
                    // A concurrent mkdir is harmless only if LSTAT proves a directory.
                    if response.code()? != 0 && self.stat(&current).await?.is_none() {
                        response.success()?;
                    }
                    self.stat(&current).await?.ok_or_else(transport)?
                }
                None => return Ok(false),
            };
            if attrs.mode.map(|v| v & 0o170000) != Some(0o040000) {
                return Err(invalid());
            }
        }
        Ok(true)
    }
    async fn open(&mut self, path: &str, exclusive: bool) -> Result<Vec<u8>, SyncError> {
        let mut payload = Vec::new();
        string(&mut payload, path.as_bytes());
        payload.extend_from_slice(&(if exclusive { 2u32 | 8 | 32 } else { 1u32 }).to_be_bytes());
        payload.extend_from_slice(&4u32.to_be_bytes());
        payload.extend_from_slice(&0o600u32.to_be_bytes());
        let reply = self.request(3, &payload).await?;
        if reply.kind != 102 {
            reply.success()?;
            return Err(transport());
        }
        let mut cursor = Cursor(&reply.payload);
        let handle = cursor.string()?.to_vec();
        if handle.is_empty() || handle.len() > 1024 || !cursor.0.is_empty() {
            return Err(transport());
        }
        Ok(handle)
    }
    async fn close(&mut self, handle: &[u8]) -> Result<(), SyncError> {
        let mut payload = Vec::new();
        string(&mut payload, handle);
        self.request(4, &payload).await?.success()
    }
    async fn remove(&mut self, path: &str) -> Result<(), SyncError> {
        let mut payload = Vec::new();
        string(&mut payload, path.as_bytes());
        self.request(13, &payload).await?.success()
    }
    async fn read(
        &mut self,
        path: &str,
        options: &TransportOptions,
    ) -> Result<Option<Vec<u8>>, SyncError> {
        let Some(before) = self.stat(path).await? else {
            return Ok(None);
        };
        before.regular(options.max_bytes)?;
        let handle = self.open(path, false).await?;
        let result = self.read_handle(&handle, options).await;
        let closed = self.close(&handle).await;
        let data = result?;
        closed?;
        let after = self.stat(path).await?.ok_or_else(conflict)?;
        if before != after || before.size != Some(data.len() as u64) {
            return Err(conflict());
        }
        Ok(Some(data))
    }
    async fn read_handle(
        &mut self,
        handle: &[u8],
        options: &TransportOptions,
    ) -> Result<Vec<u8>, SyncError> {
        let mut data = Vec::new();
        let start = Instant::now();
        loop {
            let mut payload = Vec::new();
            string(&mut payload, handle);
            payload.extend_from_slice(&(data.len() as u64).to_be_bytes());
            let wanted = CHUNK.min(options.max_bytes.saturating_sub(data.len()) + 1);
            payload.extend_from_slice(&(wanted as u32).to_be_bytes());
            let reply = self.request(5, &payload).await?;
            if reply.kind == 101 {
                if reply.code()? == 1 {
                    break;
                }
                reply.success()?;
                return Err(transport());
            }
            if reply.kind != 103 {
                return Err(transport());
            }
            let mut cursor = Cursor(&reply.payload);
            let bytes = cursor.string()?;
            if bytes.is_empty()
                || bytes.len() > wanted
                || bytes.len() > options.max_bytes.saturating_sub(data.len())
                || !cursor.0.is_empty()
            {
                return Err(invalid());
            }
            data.extend_from_slice(bytes);
            pace(start, data.len(), options.download_limit_kbs).await;
        }
        Ok(data)
    }
    async fn upload(&mut self, path: &str, data: &[u8], rate: u64) -> Result<(), SyncError> {
        let handle = self.open(path, true).await?;
        let result = async {
            let start = Instant::now();
            for (index, chunk) in data.chunks(CHUNK).enumerate() {
                pace(start, index * CHUNK + chunk.len(), rate).await;
                let mut payload = Vec::new();
                string(&mut payload, &handle);
                payload.extend_from_slice(&((index * CHUNK) as u64).to_be_bytes());
                string(&mut payload, chunk);
                self.request(6, &payload).await?.success()?;
            }
            Ok::<(), SyncError>(())
        }
        .await;
        let closed = self.close(&handle).await;
        // We own this exclusive temporary file; clean up a definitive server error.
        // An uncertain protocol/transport failure must leave the lock for recovery.
        if result.is_err() && !matches!(&result, Err(SyncError::Transport(_))) && closed.is_ok() {
            self.remove(path).await?;
        }
        result?;
        closed
    }
    async fn rename(&mut self, from: &str, to: &str) -> Result<(), SyncError> {
        if !self.atomic_rename {
            return Err(SyncError::Invalid(
                "SFTP atomic writes require posix-rename@openssh.com version 1.".into(),
            ));
        }
        let mut payload = Vec::new();
        string(&mut payload, b"posix-rename@openssh.com");
        string(&mut payload, from.as_bytes());
        string(&mut payload, to.as_bytes());
        self.request(200, &payload).await?.success()
    }
    async fn write(
        &mut self,
        destination: &str,
        data: &[u8],
        expected: Option<&str>,
        options: &TransportOptions,
    ) -> Result<Written, SyncError> {
        if !self.atomic_rename {
            return Err(SyncError::Invalid(
                "SFTP atomic writes require posix-rename@openssh.com version 1.".into(),
            ));
        }
        validate_revision(expected)?;
        if data.len() > options.max_bytes {
            return Err(invalid());
        }
        let lock = format!("{destination}.lock");
        // EXCL creates the lock atomically. Never steal an existing/stale lock.
        if self.stat(&lock).await?.is_some() {
            return Err(conflict());
        }
        let lock_handle = self.open(&lock, true).await.map_err(|_| conflict())?;
        self.close(&lock_handle).await?;
        let temporary = format!("{destination}.{}.tmp", uuid::Uuid::new_v4());
        let mut temporary_created = false;
        let result = async {
            let before = self.read(destination, options).await?;
            compare_revision(before.as_deref(), expected)?;
            // Generated sibling name, EXCL, mode 0600. No local private-key files.
            // On an uncertain upload, preserve lock and temp rather than guessing ownership.
            self.upload(&temporary, data, options.upload_limit_kbs)
                .await?;
            temporary_created = true;
            let uploaded = self
                .read(&temporary, options)
                .await?
                .ok_or_else(transport)?;
            if uploaded != data {
                return Err(conflict());
            }
            let current = self.read(destination, options).await?;
            compare_revision(current.as_deref(), expected)?;
            self.rename(&temporary, destination).await?;
            temporary_created = false;
            let actual = self
                .read(destination, options)
                .await?
                .ok_or_else(transport)?;
            if actual != data {
                return Err(conflict());
            }
            Ok(Written {
                revision: revision(&actual),
            })
        }
        .await;
        if matches!(&result, Err(SyncError::Transport(_))) {
            return result;
        }
        if temporary_created {
            self.remove(&temporary).await?;
        }
        self.remove(&lock).await?;
        result
    }

    async fn probe(&mut self, probe: &str, options: &TransportOptions) -> Result<(), SyncError> {
        let result = async {
            let written = self.write(probe, b"1", None, options).await?;
            self.write(probe, b"2", Some(&written.revision), options)
                .await?;
            Ok::<(), SyncError>(())
        }
        .await;
        if matches!(&result, Err(SyncError::Transport(_))) {
            return result;
        }
        if self.read(probe, options).await?.is_some() {
            self.remove(probe).await?;
        }
        result
    }
}

async fn pace(start: Instant, bytes: usize, rate: u64) {
    if rate != 0 {
        tokio::time::sleep_until(
            start + Duration::from_secs_f64(bytes as f64 / (rate as f64 * 1024.0)),
        )
        .await;
    }
}
enum Operation {
    Read,
    Write(Vec<u8>, Option<String>),
    Test,
}
enum Output {
    Read(Blob),
    Write(Written),
    Test,
}

async fn execute(
    target: &Target,
    options: &TransportOptions,
    operation: Operation,
) -> Result<Output, SyncError> {
    options.validate()?;
    let config = Config::parse(target)?;
    let directory = folder(&config.folder_path)?;
    let (session, mut wire) = timeout(Duration::from_secs(30), connect(config))
        .await
        .map_err(|_| transport())??;
    let result = timeout(DEADLINE, async {
        let exists = wire
            .directory(&directory, !matches!(&operation, Operation::Read))
            .await?;
        if !exists {
            return match operation {
                Operation::Read => Ok(Output::Read(Blob {
                    data: None,
                    revision: None,
                })),
                _ => Err(invalid()),
            };
        }
        match operation {
            Operation::Read => Ok(Output::Read(
                match wire.read(&path(&directory, FILE), options).await? {
                    Some(data) => Blob {
                        revision: Some(revision(&data)),
                        data: Some(STANDARD.encode(data)),
                    },
                    None => Blob {
                        data: None,
                        revision: None,
                    },
                },
            )),
            Operation::Write(data, expected) => Ok(Output::Write(
                wire.write(&path(&directory, FILE), &data, expected.as_deref(), options)
                    .await?,
            )),
            Operation::Test => {
                let probe = path(
                    &directory,
                    &format!(".sorng-probe-{}.tmp", uuid::Uuid::new_v4()),
                );
                wire.probe(&probe, options).await?;
                Ok(Output::Test)
            }
        }
    })
    .await
    .map_err(|_| transport())
    .and_then(|v| v);
    // Drop the channel after any cancellation; never reuse a partially read protocol stream.
    drop(wire);
    let _ = timeout(
        Duration::from_secs(2),
        session.disconnect(Disconnect::ByApplication, "", ""),
    )
    .await;
    result
}

pub async fn read(target: &Target, options: &TransportOptions) -> Result<Blob, SyncError> {
    match execute(target, options, Operation::Read).await? {
        Output::Read(blob) => Ok(blob),
        _ => Err(transport()),
    }
}
pub async fn write(
    target: &Target,
    data: &[u8],
    expected_revision: Option<&str>,
    options: &TransportOptions,
) -> Result<Written, SyncError> {
    options.validate()?;
    validate_revision(expected_revision)?;
    if data.len() > options.max_bytes {
        return Err(invalid());
    }
    match execute(
        target,
        options,
        Operation::Write(data.to_vec(), expected_revision.map(str::to_owned)),
    )
    .await?
    {
        Output::Write(written) => Ok(written),
        _ => Err(transport()),
    }
}
pub async fn test(target: &Target, options: &TransportOptions) -> Result<(), SyncError> {
    match execute(target, options, Operation::Test).await? {
        Output::Test => Ok(()),
        _ => Err(transport()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    struct Store {
        files: HashMap<String, Vec<u8>>,
        requests: Vec<(u8, String)>,
        corrupt_upload: bool,
    }

    // In-memory wire peer: exercises the actual framing, offsets, EXCL lock,
    // content CAS, atomic rename and readback code without an SSH server/account.
    async fn peer(mut stream: tokio::io::DuplexStream, mut store: Store) -> Store {
        let mut handles: HashMap<Vec<u8>, String> = HashMap::new();
        let mut handle_id = 0u32;
        while let Ok(length) = stream.read_u32().await {
            assert!((1..=PACKET_LIMIT as u32).contains(&length));
            let mut packet = vec![0; length as usize];
            stream.read_exact(&mut packet).await.unwrap();
            let mut cursor = Cursor(&packet);
            let kind = cursor.take(1).unwrap()[0];
            if kind == 1 {
                assert_eq!(cursor.u32().unwrap(), 3);
                let mut response = vec![2, 0, 0, 0, 3];
                string(&mut response, b"posix-rename@openssh.com");
                string(&mut response, b"1");
                stream.write_u32(response.len() as u32).await.unwrap();
                stream.write_all(&response).await.unwrap();
                continue;
            }
            let id = cursor.u32().unwrap();
            let argument = cursor.string().unwrap().to_vec();
            let name = String::from_utf8_lossy(&argument).into_owned();
            store.requests.push((kind, name.clone()));
            let mut payload = Vec::new();
            let mut response_kind = 101;
            let code = match kind {
                7 => match store.files.get(&name) {
                    Some(data) => {
                        response_kind = 105;
                        payload.extend_from_slice(&5u32.to_be_bytes());
                        payload.extend_from_slice(&(data.len() as u64).to_be_bytes());
                        payload.extend_from_slice(&0o100600u32.to_be_bytes());
                        0
                    }
                    None => 2,
                },
                3 => {
                    let flags = cursor.u32().unwrap();
                    assert_eq!(cursor.u32().unwrap(), 4);
                    assert_eq!(cursor.u32().unwrap(), 0o600);
                    if flags == 42 && store.files.contains_key(&name) {
                        4
                    } else if flags == 1 && !store.files.contains_key(&name) {
                        2
                    } else {
                        assert!(flags == 42 || flags == 1);
                        if flags == 42 {
                            store.files.insert(name.clone(), Vec::new());
                        }
                        handle_id += 1;
                        let handle = handle_id.to_be_bytes().to_vec();
                        handles.insert(handle.clone(), name);
                        response_kind = 102;
                        string(&mut payload, &handle);
                        0
                    }
                }
                4 => {
                    assert!(handles.remove(&argument).is_some());
                    0
                }
                5 => {
                    let name = handles.get(&argument).unwrap();
                    let data = store.files.get(name).unwrap();
                    let offset = cursor.u64().unwrap() as usize;
                    let length = cursor.u32().unwrap() as usize;
                    if offset >= data.len() {
                        1
                    } else {
                        response_kind = 103;
                        string(
                            &mut payload,
                            &data[offset..(offset + length).min(data.len())],
                        );
                        0
                    }
                }
                6 => {
                    let name = handles.get(&argument).unwrap();
                    let data = store.files.get_mut(name).unwrap();
                    let offset = cursor.u64().unwrap() as usize;
                    let bytes = cursor.string().unwrap();
                    assert_eq!(offset, data.len());
                    data.extend_from_slice(bytes);
                    if store.corrupt_upload && !data.is_empty() {
                        data[0] ^= 1;
                    }
                    0
                }
                13 => {
                    if store.files.remove(&name).is_some() {
                        0
                    } else {
                        2
                    }
                }
                200 => {
                    assert_eq!(name, "posix-rename@openssh.com");
                    let from = String::from_utf8(cursor.string().unwrap().to_vec()).unwrap();
                    let to = String::from_utf8(cursor.string().unwrap().to_vec()).unwrap();
                    let bytes = store
                        .files
                        .remove(&from)
                        .expect("rename must refer to owned temp");
                    store.files.insert(to, bytes);
                    0
                }
                _ => panic!("unexpected SFTP operation {kind}"),
            };
            if response_kind == 101 {
                payload.extend_from_slice(&(code as u32).to_be_bytes());
                string(&mut payload, b"fixture");
                string(&mut payload, b"");
            }
            let mut response = vec![response_kind];
            response.extend_from_slice(&id.to_be_bytes());
            response.extend_from_slice(&payload);
            stream.write_u32(response.len() as u32).await.unwrap();
            stream.write_all(&response).await.unwrap();
        }
        store
    }

    async fn fixture(
        initial: &[(&str, &[u8])],
        corrupt: bool,
    ) -> (
        Wire<tokio::io::DuplexStream>,
        tokio::task::JoinHandle<Store>,
    ) {
        let (client, server) = tokio::io::duplex(128 * 1024);
        let store = Store {
            files: initial
                .iter()
                .map(|(p, d)| (p.to_string(), d.to_vec()))
                .collect(),
            requests: Vec::new(),
            corrupt_upload: corrupt,
        };
        let task = tokio::spawn(peer(server, store));
        (Wire::new(client).await.unwrap(), task)
    }
    fn options() -> TransportOptions {
        TransportOptions {
            max_bytes: 128 * 1024,
            upload_limit_kbs: 0,
            download_limit_kbs: 0,
        }
    }

    #[tokio::test]
    async fn wire_create_update_cas_uses_exclusive_lock_and_atomic_rename() {
        let (mut wire, server) = fixture(&[], false).await;
        let first = wire.write(FILE, b"old", None, &options()).await.unwrap();
        assert_eq!(first.revision, revision(b"old"));
        assert!(matches!(
            wire.write(FILE, b"wrong", None, &options()).await,
            Err(SyncError::Conflict(_))
        ));
        assert!(matches!(
            wire.write(FILE, b"wrong", Some(&revision(b"stale")), &options())
                .await,
            Err(SyncError::Conflict(_))
        ));
        let second = wire
            .write(FILE, b"new", Some(&first.revision), &options())
            .await
            .unwrap();
        assert_eq!(second.revision, revision(b"new"));
        assert_eq!(wire.read(FILE, &options()).await.unwrap().unwrap(), b"new");
        drop(wire);
        let store = server.await.unwrap();
        assert_eq!(store.files.len(), 1);
        assert_eq!(store.files[FILE], b"new");
        assert_eq!(
            store
                .requests
                .iter()
                .filter(|(kind, _)| *kind == 200)
                .count(),
            2
        );
        assert!(!store
            .requests
            .iter()
            .any(|(kind, name)| *kind == 13 && name == FILE));
    }

    #[tokio::test]
    async fn wire_existing_writer_lock_is_never_removed_or_stolen() {
        let lock = format!("{FILE}.lock");
        let (mut wire, server) = fixture(&[(FILE, b"old"), (&lock, b"")], false).await;
        assert!(matches!(
            wire.write(FILE, b"new", Some(&revision(b"old")), &options())
                .await,
            Err(SyncError::Conflict(_))
        ));
        drop(wire);
        let store = server.await.unwrap();
        assert_eq!(store.files[FILE], b"old");
        assert!(store.files.contains_key(&lock));
        assert!(!store
            .requests
            .iter()
            .any(|(kind, _)| matches!(*kind, 3 | 6 | 13 | 200)));
    }

    #[tokio::test]
    async fn wire_readback_corruption_never_replaces_existing_blob() {
        let (mut wire, server) = fixture(&[(FILE, b"old")], true).await;
        assert!(wire
            .write(FILE, b"new", Some(&revision(b"old")), &options())
            .await
            .is_err());
        drop(wire);
        let store = server.await.unwrap();
        assert_eq!(store.files[FILE], b"old");
        assert_eq!(store.files.len(), 1);
        assert!(!store.requests.iter().any(|(kind, _)| *kind == 200));
    }

    #[tokio::test]
    async fn wire_probe_cleans_own_files_without_touching_production() {
        let (mut wire, server) = fixture(&[(FILE, b"production")], false).await;
        wire.probe(".sorng-probe-synthetic.tmp", &options())
            .await
            .unwrap();
        drop(wire);
        let store = server.await.unwrap();
        assert_eq!(store.files.len(), 1);
        assert_eq!(store.files[FILE], b"production");
        assert!(!store.requests.iter().any(|(_, name)| name == FILE));
    }

    #[tokio::test]
    async fn wire_multiple_chunks_and_limit_are_enforced() {
        let data = vec![42; CHUNK * 2 + 3];
        let (mut wire, server) = fixture(&[], false).await;
        wire.write(FILE, &data, None, &options()).await.unwrap();
        assert_eq!(wire.read(FILE, &options()).await.unwrap().unwrap(), data);
        let mut opts = options();
        opts.max_bytes = 2;
        assert!(wire.read(FILE, &opts).await.is_err());
        drop(wire);
        let store = server.await.unwrap();
        assert_eq!(store.files[FILE], data);
    }
    fn config() -> Target {
        serde_json::from_value(json!({"id":"test", "provider":"sftp", "sftp": {"host":"host.test", "port":22, "username":"user", "password":"secret", "authMethod":"password", "folderPath":"/data", "hostKeyFingerprint":format!("SHA256:{}", STANDARD_NO_PAD.encode([1;32]))}})).unwrap()
    }
    #[test]
    fn fingerprint_is_required_sha256_and_canonical() {
        assert_eq!(
            fingerprint(&format!("SHA256:{}", STANDARD_NO_PAD.encode([1; 32]))).unwrap(),
            [1; 32]
        );
        for v in [
            "",
            "MD5:ab:cd",
            "SHA256:abc",
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        ] {
            assert!(fingerprint(v).is_err());
        }
        let mut target = config();
        target.sftp.as_mut().unwrap()["hostKeyFingerprint"] = json!("");
        assert!(Config::parse(&target).is_err());
    }

    #[tokio::test]
    async fn ssh_host_key_callback_accepts_only_the_exact_pin() {
        use russh::client::Handler;
        let mut blob = Vec::new();
        string(&mut blob, b"ssh-ed25519");
        string(&mut blob, &[1u8; 32]);
        let key = keys::PublicKey::from_bytes(&blob).unwrap();
        let expected = fingerprint(&key.fingerprint(keys::HashAlg::Sha256).to_string()).unwrap();
        let rejected = Arc::new(AtomicBool::new(false));
        let mut handler = HostKey {
            expected,
            rejected: rejected.clone(),
        };
        assert!(handler.check_server_key(&key).await.unwrap());
        assert!(!rejected.load(Ordering::Relaxed));
        handler.expected[0] ^= 1;
        assert!(!handler.check_server_key(&key).await.unwrap());
        assert!(rejected.load(Ordering::Relaxed));
    }

    #[test]
    fn encrypted_key_kdf_is_bounded_before_blocking_decode() {
        for rounds in [0, 1, 128, 129, u32::MAX] {
            let mut decoded = b"openssh-key-v1\0".to_vec();
            string(&mut decoded, b"aes256-ctr");
            string(&mut decoded, b"bcrypt");
            let mut kdf = Vec::new();
            string(&mut kdf, &[1; 16]);
            kdf.extend_from_slice(&rounds.to_be_bytes());
            string(&mut decoded, &kdf);
            let key = format!(
                "-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----",
                STANDARD.encode(decoded)
            );
            assert_eq!(validate_key_work(&key).is_ok(), (1..=128).contains(&rounds));
        }
        assert!(validate_key_work("-----BEGIN ENCRYPTED PRIVATE KEY-----\ninvalid\n").is_err());
    }

    #[tokio::test]
    async fn no_atomic_extension_means_no_lock_or_upload_is_started() {
        let (stream, mut peer) = tokio::io::duplex(128);
        let mut wire = Wire {
            stream,
            id: 0,
            atomic_rename: false,
        };
        assert!(wire.write(FILE, b"new", None, &options()).await.is_err());
        drop(wire);
        let mut bytes = Vec::new();
        peer.read_to_end(&mut bytes).await.unwrap();
        assert!(bytes.is_empty());
    }
    #[test]
    fn paths_are_literal_and_no_shell_or_traversal() {
        assert_eq!(
            path(&folder("/data/a %20").unwrap(), FILE),
            "/data/a %20/application-data.v1.sorng"
        );
        for v in [
            "../data", "a/../b", "a/./b", "a\\b", "a//b", "//server", "~/data", "a\0b",
        ] {
            assert!(folder(v).is_err(), "{v}");
        }
        assert_eq!(
            path(&folder("").unwrap(), FILE),
            "./application-data.v1.sorng"
        );
    }
    #[test]
    fn absent_revision_is_create_only_and_hash_revision_is_exact() {
        assert!(compare_revision(None, None).is_ok());
        assert!(compare_revision(Some(b"old"), None).is_err());
        assert!(compare_revision(None, Some(&revision(b"old"))).is_err());
        assert!(compare_revision(Some(b"old"), Some(&revision(b"old"))).is_ok());
        assert!(compare_revision(Some(b"new"), Some(&revision(b"old"))).is_err());
        for v in ["*", "", "sha256:abc", "SHA256:abc"] {
            assert!(validate_revision(Some(v)).is_err());
        }
    }
    #[test]
    fn malformed_configs_fail_before_network() {
        for (field, value) in [
            ("port", json!(0)),
            ("authMethod", json!("agent")),
            ("password", json!(null)),
            ("host", json!("user@host")),
            ("folderPath", json!(["folder"])),
        ] {
            let mut target = config();
            target.sftp.as_mut().unwrap()[field] = value;
            assert!(Config::parse(&target).is_err());
        }
    }
    #[tokio::test]
    async fn negotiated_extension_is_required_not_assumed() {
        for advertise in [false, true] {
            let (client, mut server) = tokio::io::duplex(4096);
            let task = tokio::spawn(async move {
                assert_eq!(server.read_u32().await.unwrap(), 5);
                let mut init = [0u8; 5];
                server.read_exact(&mut init).await.unwrap();
                assert_eq!(init, [1, 0, 0, 0, 3]);
                let mut reply = vec![2, 0, 0, 0, 3];
                if advertise {
                    string(&mut reply, b"posix-rename@openssh.com");
                    string(&mut reply, b"1");
                }
                server.write_u32(reply.len() as u32).await.unwrap();
                server.write_all(&reply).await.unwrap();
            });
            let wire = Wire::new(client).await.unwrap();
            assert_eq!(wire.atomic_rename, advertise);
            task.await.unwrap();
        }
    }
    #[tokio::test]
    async fn rejects_oversized_packets_before_allocation() {
        let (client, mut server) = tokio::io::duplex(64);
        server.write_u32((PACKET_LIMIT + 1) as u32).await.unwrap();
        let mut wire = Wire {
            stream: client,
            id: 0,
            atomic_rename: false,
        };
        assert!(wire.receive().await.is_err());
    }
    #[tokio::test]
    async fn rejects_wrong_reply_id() {
        let (client, mut server) = tokio::io::duplex(128);
        let task = tokio::spawn(async move {
            let len = server.read_u32().await.unwrap();
            let mut data = vec![0; len as usize];
            server.read_exact(&mut data).await.unwrap();
            let packet = [101, 0, 0, 0, 99, 0, 0, 0, 0];
            server.write_u32(packet.len() as u32).await.unwrap();
            server.write_all(&packet).await.unwrap();
        });
        let mut wire = Wire {
            stream: client,
            id: 0,
            atomic_rename: true,
        };
        assert!(wire.remove("only-a-probe").await.is_err());
        task.await.unwrap();
    }
    #[test]
    fn symlinks_missing_metadata_and_oversized_files_fail_closed() {
        assert!(Attributes {
            size: Some(10),
            mode: Some(0o100600),
            modified: None
        }
        .regular(10)
        .is_ok());
        for mode in [None, Some(0o120777), Some(0o040700)] {
            assert!(Attributes {
                size: Some(1),
                mode,
                modified: None
            }
            .regular(10)
            .is_err());
        }
        assert!(Attributes {
            size: Some(11),
            mode: Some(0o100600),
            modified: None
        }
        .regular(10)
        .is_err());
    }
}
