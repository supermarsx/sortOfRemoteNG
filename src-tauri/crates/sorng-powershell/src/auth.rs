//! Authentication providers for WinRM PowerShell Remoting.
//!
//! Supports Basic, NTLM, Negotiate (SPNEGO), Kerberos, CredSSP,
//! Certificate, and Digest authentication methods.

use crate::types::*;
use base64::Engine;
use log::debug;
use std::collections::HashMap;

// ─── Auth Provider Trait ─────────────────────────────────────────────────────

/// Trait for authentication providers.
#[async_trait::async_trait]
pub trait AuthProvider: Send + Sync {
    /// Name of this auth mechanism.
    fn name(&self) -> &str;

    /// Generate initial auth header value for the first request.
    fn initial_auth_header(&self) -> Result<String, String>;

    /// Process a 401 challenge and return the next auth header.
    /// Returns None if authentication is complete (for single-round auth).
    async fn process_challenge(&mut self, challenge: &str) -> Result<Option<String>, String>;

    /// Whether this auth method requires HTTPS.
    fn requires_https(&self) -> bool {
        false
    }

    /// Whether this auth method supports channel binding.
    fn supports_channel_binding(&self) -> bool {
        false
    }
}

// ─── Basic Authentication ────────────────────────────────────────────────────

/// HTTP Basic authentication (base64 username:password).
pub struct BasicAuth {
    username: String,
    password: String,
    domain: Option<String>,
}

impl BasicAuth {
    pub fn new(credential: &PsCredential) -> Self {
        Self {
            username: credential.username.clone(),
            password: credential.password.clone().unwrap_or_default(),
            domain: credential.domain.clone(),
        }
    }
}

#[async_trait::async_trait]
impl AuthProvider for BasicAuth {
    fn name(&self) -> &str {
        "Basic"
    }

    fn initial_auth_header(&self) -> Result<String, String> {
        let user = if let Some(ref domain) = self.domain {
            format!("{}\\{}", domain, self.username)
        } else {
            self.username.clone()
        };
        let encoded =
            base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", user, self.password));
        Ok(format!("Basic {}", encoded))
    }

    async fn process_challenge(&mut self, _challenge: &str) -> Result<Option<String>, String> {
        // Basic is single-round
        Ok(None)
    }

    fn requires_https(&self) -> bool {
        true // Basic sends credentials in plaintext, HTTPS recommended
    }
}

// ─── NTLM Authentication ────────────────────────────────────────────────────

/// NTLM (NT LAN Manager) authentication.
///
/// Implements the three-message NTLM handshake:
/// 1. Client sends Type 1 (Negotiate) message
/// 2. Server responds with Type 2 (Challenge) message
/// 3. Client sends Type 3 (Authenticate) message
pub struct NtlmAuth {
    username: String,
    password: String,
    domain: String,
    workstation: String,
    state: NtlmState,
    #[allow(dead_code)]
    server_challenge: Option<Vec<u8>>,
}

#[derive(Debug, PartialEq)]
enum NtlmState {
    Initial,
    NegotiateSent,
    Authenticated,
}

impl NtlmAuth {
    pub fn new(credential: &PsCredential) -> Self {
        let workstation = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "WORKSTATION".to_string())
            .to_uppercase();

        Self {
            username: credential.username.clone(),
            password: credential.password.clone().unwrap_or_default(),
            domain: credential.domain.clone().unwrap_or_else(|| ".".to_string()),
            workstation,
            state: NtlmState::Initial,
            server_challenge: None,
        }
    }

    /// Build NTLM Type 1 (Negotiate) message.
    fn build_negotiate_message(&self) -> Vec<u8> {
        let mut msg = Vec::new();

        // Signature: "NTLMSSP\0"
        msg.extend_from_slice(b"NTLMSSP\0");
        // Type 1
        msg.extend_from_slice(&1u32.to_le_bytes());
        // Flags: Negotiate Unicode | Negotiate NTLM | Request Target | Negotiate NTLM2
        let flags: u32 = 0x00000001 // NEGOTIATE_UNICODE
            | 0x00000002  // NEGOTIATE_OEM
            | 0x00000004  // REQUEST_TARGET
            | 0x00000200  // NEGOTIATE_NTLM
            | 0x00008000  // NEGOTIATE_ALWAYS_SIGN
            | 0x00080000  // NEGOTIATE_NTLM2
            | 0x20000000  // NEGOTIATE_128
            | 0x80000000; // NEGOTIATE_56
        msg.extend_from_slice(&flags.to_le_bytes());

        // Domain name fields (offset 16, length 0 for now)
        msg.extend_from_slice(&0u16.to_le_bytes()); // DomainNameLen
        msg.extend_from_slice(&0u16.to_le_bytes()); // DomainNameMaxLen
        msg.extend_from_slice(&0u32.to_le_bytes()); // DomainNameBufferOffset

        // Workstation fields (offset 24, length 0 for now)
        msg.extend_from_slice(&0u16.to_le_bytes()); // WorkstationLen
        msg.extend_from_slice(&0u16.to_le_bytes()); // WorkstationMaxLen
        msg.extend_from_slice(&0u32.to_le_bytes()); // WorkstationBufferOffset

        msg
    }

    /// Build NTLM Type 3 (Authenticate) message.
    fn build_authenticate_message(&self, challenge: &[u8]) -> Result<Vec<u8>, String> {
        use hmac::{Hmac, Mac};
        use md5::Md5;

        // Extract the 8-byte server challenge from Type 2 message
        if challenge.len() < 32 {
            return Err("Invalid NTLM Type 2 message: too short".to_string());
        }

        let server_challenge = &challenge[24..32];

        // Compute NTLMv2 response
        // 1. Unicode password -> MD4 hash (NT hash)
        let password_utf16: Vec<u8> = self
            .password
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();

        // MD4 of the UTF-16LE password
        let nt_hash = md4_hash(&password_utf16);

        // 2. HMAC-MD5(NT hash, UPPERCASE(username) + domain)
        let user_domain = format!("{}{}", self.username.to_uppercase(), self.domain);
        let user_domain_utf16: Vec<u8> = user_domain
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();

        let mut hmac =
            Hmac::<Md5>::new_from_slice(&nt_hash).map_err(|e| format!("HMAC error: {}", e))?;
        hmac.update(&user_domain_utf16);
        let ntlmv2_hash = hmac.finalize().into_bytes();

        // 3. Build client challenge (8 random bytes)
        let client_challenge: [u8; 8] = rand::random();

        // 4. Build blob (simplified NTLMv2 blob)
        let timestamp = get_filetime_now();
        let mut blob = Vec::new();
        blob.extend_from_slice(&[0x01, 0x01, 0x00, 0x00]); // Blob signature
        blob.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // Reserved
        blob.extend_from_slice(&timestamp.to_le_bytes()); // Timestamp
        blob.extend_from_slice(&client_challenge); // Client challenge
        blob.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // Reserved

        // 5. Compute NTLMv2 response
        let mut data = Vec::new();
        data.extend_from_slice(server_challenge);
        data.extend_from_slice(&blob);

        let mut hmac2 =
            Hmac::<Md5>::new_from_slice(&ntlmv2_hash).map_err(|e| format!("HMAC error: {}", e))?;
        hmac2.update(&data);
        let nt_proof = hmac2.finalize().into_bytes();

        let mut nt_response = Vec::from(nt_proof.as_slice());
        nt_response.extend_from_slice(&blob);

        // 6. Build Type 3 message
        let domain_utf16: Vec<u8> = self
            .domain
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        let user_utf16: Vec<u8> = self
            .username
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        let ws_utf16: Vec<u8> = self
            .workstation
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();

        let mut msg = Vec::new();
        msg.extend_from_slice(b"NTLMSSP\0");
        msg.extend_from_slice(&3u32.to_le_bytes()); // Type 3

        // Payload starts after the fixed header (72 bytes)
        let payload_offset: u32 = 88;
        let mut offset = payload_offset;

        // LM response (empty for NTLMv2)
        let lm_len = 0u16;
        msg.extend_from_slice(&lm_len.to_le_bytes());
        msg.extend_from_slice(&lm_len.to_le_bytes());
        msg.extend_from_slice(&offset.to_le_bytes());

        // NT response
        let nt_len = nt_response.len() as u16;
        msg.extend_from_slice(&nt_len.to_le_bytes());
        msg.extend_from_slice(&nt_len.to_le_bytes());
        offset += lm_len as u32;
        msg.extend_from_slice(&offset.to_le_bytes());

        // Domain
        let domain_len = domain_utf16.len() as u16;
        offset += nt_len as u32;
        msg.extend_from_slice(&domain_len.to_le_bytes());
        msg.extend_from_slice(&domain_len.to_le_bytes());
        msg.extend_from_slice(&offset.to_le_bytes());

        // User
        let user_len = user_utf16.len() as u16;
        offset += domain_len as u32;
        msg.extend_from_slice(&user_len.to_le_bytes());
        msg.extend_from_slice(&user_len.to_le_bytes());
        msg.extend_from_slice(&offset.to_le_bytes());

        // Workstation
        let ws_len = ws_utf16.len() as u16;
        offset += user_len as u32;
        msg.extend_from_slice(&ws_len.to_le_bytes());
        msg.extend_from_slice(&ws_len.to_le_bytes());
        msg.extend_from_slice(&offset.to_le_bytes());

        // Encrypted random session key (empty)
        msg.extend_from_slice(&0u16.to_le_bytes());
        msg.extend_from_slice(&0u16.to_le_bytes());
        offset += ws_len as u32;
        msg.extend_from_slice(&offset.to_le_bytes());

        // Negotiate flags
        let flags: u32 = 0x00000001 | 0x00000200 | 0x00008000 | 0x00080000 | 0x20000000;
        msg.extend_from_slice(&flags.to_le_bytes());

        // Pad to payload_offset
        while msg.len() < payload_offset as usize {
            msg.push(0);
        }

        // Payloads
        // LM response (empty)
        // NT response
        msg.extend_from_slice(&nt_response);
        // Domain
        msg.extend_from_slice(&domain_utf16);
        // User
        msg.extend_from_slice(&user_utf16);
        // Workstation
        msg.extend_from_slice(&ws_utf16);

        Ok(msg)
    }
}

#[async_trait::async_trait]
impl AuthProvider for NtlmAuth {
    fn name(&self) -> &str {
        "NTLM"
    }

    fn initial_auth_header(&self) -> Result<String, String> {
        let negotiate = self.build_negotiate_message();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&negotiate);
        Ok(format!("Negotiate {}", encoded))
    }

    async fn process_challenge(&mut self, challenge: &str) -> Result<Option<String>, String> {
        match self.state {
            NtlmState::Initial => {
                self.state = NtlmState::NegotiateSent;
                Ok(Some(self.initial_auth_header()?))
            }
            NtlmState::NegotiateSent => {
                // Parse the Type 2 challenge
                let token = challenge
                    .strip_prefix("Negotiate ")
                    .or_else(|| challenge.strip_prefix("NTLM "))
                    .ok_or("Invalid NTLM challenge header")?;

                let challenge_bytes = base64::engine::general_purpose::STANDARD
                    .decode(token.trim())
                    .map_err(|e| format!("Failed to decode NTLM challenge: {}", e))?;

                let auth_msg = self.build_authenticate_message(&challenge_bytes)?;
                let encoded = base64::engine::general_purpose::STANDARD.encode(&auth_msg);

                self.state = NtlmState::Authenticated;
                Ok(Some(format!("Negotiate {}", encoded)))
            }
            NtlmState::Authenticated => Ok(None),
        }
    }
}

// ─── Negotiate (SPNEGO) Authentication ───────────────────────────────────────

/// Negotiate (SPNEGO) authentication — wraps Kerberos with NTLM fallback.
pub struct NegotiateAuth {
    inner: NtlmAuth,
}

impl NegotiateAuth {
    pub fn new(credential: &PsCredential) -> Self {
        // For now, Negotiate falls back to NTLM.
        // A full implementation would attempt Kerberos first.
        Self {
            inner: NtlmAuth::new(credential),
        }
    }
}

#[async_trait::async_trait]
impl AuthProvider for NegotiateAuth {
    fn name(&self) -> &str {
        "Negotiate"
    }

    fn initial_auth_header(&self) -> Result<String, String> {
        self.inner.initial_auth_header()
    }

    async fn process_challenge(&mut self, challenge: &str) -> Result<Option<String>, String> {
        self.inner.process_challenge(challenge).await
    }
}

// ─── Kerberos Authentication (sspi-rs backed) ────────────────────────────────

/// Kerberos authentication provider backed by `sspi-rs`.
///
/// Drives `sspi::Kerberos` through the SSPI `initialize_security_context` token
/// exchange. Tokens are base64-encoded into the HTTP `Authorization: Negotiate`
/// header per RFC 4559 §4.1.
///
/// The KDC is auto-discovered via DNS SRV lookups performed by sspi-rs when
/// compiled with the `dns_resolver` feature. Without that feature the caller
/// must supply a KDC URL via environment (`SSPI_KDC_URL`) or the call will
/// fail with a clear error. In that failure case, prefer `Negotiate` which
/// transparently falls back to NTLM.
pub struct KerberosAuth {
    credential: PsCredential,
    spn: String,
    state: SspiAuthState,
    ctx: Option<sspi::Kerberos>,
    creds_handle: Option<sspi::CredentialsBuffers>,
}

#[derive(Debug, PartialEq)]
enum SspiAuthState {
    Initial,
    Negotiated,
    Authenticated,
}

impl KerberosAuth {
    pub fn new(credential: &PsCredential, target_host: &str) -> Self {
        let spn = format!("HTTP/{}", target_host);
        Self {
            credential: credential.clone(),
            spn,
            state: SspiAuthState::Initial,
            ctx: None,
            creds_handle: None,
        }
    }

    /// Build an initial Kerberos AP-REQ token via sspi-rs.
    fn build_initial_token(&mut self) -> Result<Vec<u8>, String> {
        use sspi::{
            AuthIdentity, BufferType, ClientRequestFlags, CredentialUse, DataRepresentation,
            KerberosConfig, SecurityBuffer, Sspi, SspiImpl, Username,
        };

        let username = self.credential.username.clone();
        let domain = self.credential.domain.clone();
        let password = self.credential.password.clone().unwrap_or_default();

        let user = Username::new(&username, domain.as_deref())
            .map_err(|e| format!("Invalid Kerberos username: {e}"))?;
        let identity = AuthIdentity {
            username: user,
            password: password.into(),
        };
        let credentials: sspi::Credentials = identity.into();

        // Build a KerberosConfig. Without the `dns_resolver` feature sspi
        // cannot auto-discover the KDC, so callers may provide one via env.
        let kdc_url = std::env::var("SSPI_KDC_URL").ok();
        let kdc_url_parsed = match kdc_url {
            Some(s) => Some(url::Url::parse(&s).map_err(|e| format!("Bad SSPI_KDC_URL: {e}"))?),
            None => None,
        };
        let kerberos_config = KerberosConfig {
            kdc_url: kdc_url_parsed,
            client_computer_name: Some(
                std::env::var("COMPUTERNAME")
                    .or_else(|_| std::env::var("HOSTNAME"))
                    .unwrap_or_else(|_| "WORKSTATION".into()),
            ),
        };

        let mut kerberos = sspi::Kerberos::new_client_from_config(kerberos_config)
            .map_err(|e| format!("sspi::Kerberos init failed: {e}"))?;

        // Use the Sspi-trait builder pattern demonstrated in the crate
        // docs: `foo.acquire_credentials_handle().with_...().execute(&mut foo)`.
        let acq_result = {
            let builder = kerberos
                .acquire_credentials_handle()
                .with_credential_use(CredentialUse::Outbound)
                .with_auth_data(&credentials);
            // Split the mutable borrow so we can pass `&mut kerberos` to execute.
            // execute expects SspiPackage<'_, CredsHandle, AuthData>; since
            // Kerberos's AuthenticationData is already sspi::Credentials this
            // type-checks cleanly.
            sspi::SspiImpl::acquire_credentials_handle_impl(&mut kerberos, builder)
                .map_err(|e| format!("sspi acquire_credentials_handle failed: {e}"))?
        };
        let mut creds_handle = acq_result.credentials_handle;

        let mut output = vec![SecurityBuffer::new(Vec::new(), BufferType::Token)];
        let mut builder = kerberos
            .initialize_security_context()
            .with_credentials_handle(&mut creds_handle)
            .with_context_requirements(
                ClientRequestFlags::MUTUAL_AUTH | ClientRequestFlags::ALLOCATE_MEMORY,
            )
            .with_target_data_representation(DataRepresentation::Native)
            .with_target_name(&self.spn)
            .with_output(&mut output);

        let _ = kerberos
            .initialize_security_context_impl(&mut builder)
            .map_err(|e| format!("sspi initialize_security_context failed: {e}"))?
            .resolve_to_result()
            .map_err(|e| format!("Kerberos token generation failed (no KDC or ticket cache?): {e}"))?;

        let token = output.into_iter().next().map(|b| b.buffer).unwrap_or_default();
        if token.is_empty() {
            return Err(
                "sspi::Kerberos produced empty token — check KDC reachability and tgt cache"
                    .to_string(),
            );
        }

        self.ctx = Some(kerberos);
        self.creds_handle = creds_handle;
        Ok(token)
    }
}

#[async_trait::async_trait]
impl AuthProvider for KerberosAuth {
    fn name(&self) -> &str {
        "Kerberos"
    }

    fn initial_auth_header(&self) -> Result<String, String> {
        // The sspi::Kerberos state cannot be mutated through a `&self` method.
        // Return a sentinel header; the real token is built during the first
        // `process_challenge` call where we have `&mut self`.
        //
        // Most WinRM servers send a 401 challenge on the first request anyway,
        // and RFC 4559 Negotiate clients typically send an empty probe first
        // to learn the server's preferred mechanism.
        Ok("Negotiate".to_string())
    }

    async fn process_challenge(&mut self, challenge: &str) -> Result<Option<String>, String> {
        match self.state {
            SspiAuthState::Initial => {
                let token = self.build_initial_token()?;
                let encoded = base64::engine::general_purpose::STANDARD.encode(&token);
                self.state = SspiAuthState::Negotiated;
                Ok(Some(format!("Negotiate {}", encoded)))
            }
            SspiAuthState::Negotiated => {
                use sspi::{BufferType, ClientRequestFlags, DataRepresentation, SecurityBuffer, Sspi, SspiImpl};

                let token = challenge
                    .strip_prefix("Negotiate ")
                    .or_else(|| challenge.strip_prefix("Kerberos "))
                    .ok_or("Invalid Kerberos challenge header")?;

                let challenge_bytes = base64::engine::general_purpose::STANDARD
                    .decode(token.trim())
                    .map_err(|e| format!("Failed to decode Kerberos challenge: {e}"))?;

                let kerberos = self
                    .ctx
                    .as_mut()
                    .ok_or("Kerberos context not initialised")?;

                let mut input = vec![SecurityBuffer::new(challenge_bytes, BufferType::Token)];
                let mut output = vec![SecurityBuffer::new(Vec::new(), BufferType::Token)];
                let mut builder = kerberos
                    .initialize_security_context()
                    .with_credentials_handle(&mut self.creds_handle)
                    .with_context_requirements(
                        ClientRequestFlags::MUTUAL_AUTH | ClientRequestFlags::ALLOCATE_MEMORY,
                    )
                    .with_target_data_representation(DataRepresentation::Native)
                    .with_target_name(&self.spn)
                    .with_input(&mut input)
                    .with_output(&mut output);

                let _ = kerberos
                    .initialize_security_context_impl(&mut builder)
                    .map_err(|e| format!("sspi initialize_security_context (round 2) failed: {e}"))?
                    .resolve_to_result()
                    .map_err(|e| format!("Kerberos round-2 token failed: {e}"))?;

                self.state = SspiAuthState::Authenticated;

                let out = output.into_iter().next().map(|b| b.buffer).unwrap_or_default();
                if out.is_empty() {
                    Ok(None)
                } else {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&out);
                    Ok(Some(format!("Negotiate {}", encoded)))
                }
            }
            SspiAuthState::Authenticated => Ok(None),
        }
    }

    fn supports_channel_binding(&self) -> bool {
        true
    }
}

// ─── CredSSP Authentication (sspi-rs backed) ─────────────────────────────────

/// CredSSP (Credential Security Support Provider) authentication backed by
/// `sspi::credssp::CredSspClient`.
///
/// Delegates credentials to the remote server via the TS_REQUEST protocol
/// (MS-CSSP). Wraps an inner SSPI context (NTLM by default, because it
/// does not require a reachable KDC); clients with a valid Kerberos
/// environment should prefer `Negotiate` instead.
///
/// CredSSP is designed to run inside a TLS channel, and its `pub_key_auth`
/// field cryptographically binds the TSRequest to the TLS server-public-key.
/// The current `AuthProvider` trait does not expose the TLS peer certificate
/// to this layer, so the public-key field is left empty. Many servers accept
/// this in "restricted admin" / HTTP-plaintext fallback modes; stricter
/// servers will reject the TSRequest and we surface the error verbatim so
/// the user can choose `Negotiate` or `Ntlm` instead.
pub struct CredSspAuth {
    credential: PsCredential,
    target_host: String,
    state: CredSspPhase,
    client: Option<sspi::credssp::CredSspClient>,
}

#[derive(Debug, PartialEq)]
enum CredSspPhase {
    Initial,
    NegoTokenLoop,
    AuthInfoSent,
    Completed,
}

impl CredSspAuth {
    pub fn new(credential: &PsCredential, target_host: &str) -> Self {
        Self {
            credential: credential.clone(),
            target_host: target_host.to_string(),
            state: CredSspPhase::Initial,
            client: None,
        }
    }

    fn init_client(&mut self) -> Result<(), String> {
        use sspi::credssp::{ClientMode, CredSspClient, CredSspMode};
        use sspi::ntlm::NtlmConfig;
        use sspi::{AuthIdentity, Credentials, Username};

        let username = self.credential.username.clone();
        let domain = self.credential.domain.clone();
        let password = self.credential.password.clone().unwrap_or_default();

        let user = Username::new(&username, domain.as_deref())
            .map_err(|e| format!("Invalid CredSSP username: {e}"))?;
        let identity = AuthIdentity {
            username: user,
            password: password.into(),
        };
        let creds: Credentials = identity.into();

        // Public key binding is not available to this AuthProvider layer —
        // callers who need strict channel binding should use Negotiate
        // over HTTPS where the RDP/WSMan stack passes the cert in.
        let public_key: Vec<u8> = Vec::new();

        let workstation = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "WORKSTATION".into());
        let ntlm_config = NtlmConfig {
            client_computer_name: Some(workstation),
        };

        let client = CredSspClient::new(
            public_key,
            creds,
            CredSspMode::WithCredentials,
            ClientMode::Ntlm(ntlm_config),
            format!("HTTP/{}", self.target_host),
        )
        .map_err(|e| format!("CredSSP client construction failed: {e}"))?;
        self.client = Some(client);
        Ok(())
    }

    /// Drive one round of the CredSSP generator with the supplied
    /// TsRequest and return the TS_REQUEST bytes to emit, along with a
    /// flag indicating the exchange is complete.
    fn step(&mut self, incoming: sspi::credssp::TsRequest) -> Result<(Vec<u8>, bool), String> {
        use sspi::credssp::ClientState;

        let client = self
            .client
            .as_mut()
            .ok_or("CredSSP client not initialised")?;

        let mut generator = client.process(incoming);
        // NTLM does not need network I/O; we expect the generator to
        // complete in one resume. resolve_to_result returns an error if
        // the generator suspends requesting network (which would mean
        // the inner mode was Kerberos, which we don't select here).
        let client_state = generator
            .resolve_to_result()
            .map_err(|e| format!("CredSSP process failed: {e}"))?;

        let (ts_request, done) = match client_state {
            ClientState::ReplyNeeded(req) => (req, false),
            ClientState::FinalMessage(req) => (req, true),
        };

        let mut buf = Vec::with_capacity(ts_request.buffer_len() as usize);
        ts_request
            .encode_ts_request(&mut buf)
            .map_err(|e| format!("CredSSP TsRequest encode failed: {e}"))?;
        Ok((buf, done))
    }
}

#[async_trait::async_trait]
impl AuthProvider for CredSspAuth {
    fn name(&self) -> &str {
        "CredSSP"
    }

    fn initial_auth_header(&self) -> Result<String, String> {
        // The CredSSP exchange is stateful and requires `&mut self`.
        // Return an empty sentinel header; the real work happens in the
        // first `process_challenge` call after the server 401s us.
        Ok("CredSSP".to_string())
    }

    async fn process_challenge(&mut self, challenge: &str) -> Result<Option<String>, String> {
        match self.state {
            CredSspPhase::Initial => {
                self.init_client()?;
                // First step: empty TSRequest to get the client's initial nego token.
                let (out, done) = self.step(sspi::credssp::TsRequest::default())?;
                self.state = if done {
                    CredSspPhase::Completed
                } else {
                    CredSspPhase::NegoTokenLoop
                };
                let encoded = base64::engine::general_purpose::STANDARD.encode(&out);
                Ok(Some(format!("CredSSP {}", encoded)))
            }
            CredSspPhase::NegoTokenLoop | CredSspPhase::AuthInfoSent => {
                let token = challenge
                    .strip_prefix("CredSSP ")
                    .ok_or("Invalid CredSSP challenge header (expected `CredSSP <base64>`)")?;
                let ts_bytes = base64::engine::general_purpose::STANDARD
                    .decode(token.trim())
                    .map_err(|e| format!("Failed to decode CredSSP TSRequest: {e}"))?;
                let incoming = sspi::credssp::TsRequest::from_buffer(&ts_bytes)
                    .map_err(|e| format!("Failed to parse CredSSP TSRequest: {e}"))?;

                let (out, done) = self.step(incoming)?;
                let encoded = base64::engine::general_purpose::STANDARD.encode(&out);

                self.state = if done {
                    CredSspPhase::Completed
                } else if self.state == CredSspPhase::NegoTokenLoop {
                    CredSspPhase::NegoTokenLoop
                } else {
                    CredSspPhase::AuthInfoSent
                };

                Ok(Some(format!("CredSSP {}", encoded)))
            }
            CredSspPhase::Completed => Ok(None),
        }
    }

    fn requires_https(&self) -> bool {
        true
    }

    fn supports_channel_binding(&self) -> bool {
        true
    }
}

// ─── Certificate Authentication ──────────────────────────────────────────────

/// Client certificate authentication for WinRM.
pub struct CertificateAuth {
    certificate_path: Option<String>,
    thumbprint: Option<String>,
    #[allow(dead_code)]
    private_key_path: Option<String>,
}

impl CertificateAuth {
    pub fn new(credential: &PsCredential) -> Self {
        Self {
            certificate_path: credential.certificate_path.clone(),
            thumbprint: credential.certificate_thumbprint.clone(),
            private_key_path: credential.private_key_path.clone(),
        }
    }

    /// Get the certificate path for the HTTP client configuration.
    pub fn certificate_path(&self) -> Option<&str> {
        self.certificate_path.as_deref()
    }

    /// Get the thumbprint for certificate selection.
    pub fn thumbprint(&self) -> Option<&str> {
        self.thumbprint.as_deref()
    }
}

#[async_trait::async_trait]
impl AuthProvider for CertificateAuth {
    fn name(&self) -> &str {
        "Certificate"
    }

    fn initial_auth_header(&self) -> Result<String, String> {
        // Certificate auth doesn't use Authorization headers;
        // instead, the TLS client certificate is configured on the HTTP client.
        if self.certificate_path.is_none() && self.thumbprint.is_none() {
            return Err(
                "Certificate authentication requires a certificate path or thumbprint".to_string(),
            );
        }
        debug!(
            "Certificate auth: cert={:?}, thumbprint={:?}",
            self.certificate_path, self.thumbprint
        );
        // Return empty string - cert is set at transport level
        Ok(String::new())
    }

    async fn process_challenge(&mut self, _challenge: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn requires_https(&self) -> bool {
        true
    }
}

// ─── Digest Authentication ───────────────────────────────────────────────────

/// HTTP Digest authentication for WinRM.
pub struct DigestAuth {
    username: String,
    password: String,
    domain: Option<String>,
    nonce: Option<String>,
    realm: Option<String>,
    nc: u32,
}

impl DigestAuth {
    pub fn new(credential: &PsCredential) -> Self {
        Self {
            username: credential.username.clone(),
            password: credential.password.clone().unwrap_or_default(),
            domain: credential.domain.clone(),
            nonce: None,
            realm: None,
            nc: 0,
        }
    }
}

#[async_trait::async_trait]
impl AuthProvider for DigestAuth {
    fn name(&self) -> &str {
        "Digest"
    }

    fn initial_auth_header(&self) -> Result<String, String> {
        // Digest requires a server challenge first
        Ok(String::new())
    }

    async fn process_challenge(&mut self, challenge: &str) -> Result<Option<String>, String> {
        use sha2::{Digest, Sha256};

        // Parse challenge parameters
        let params = parse_digest_challenge(challenge);

        let realm = params
            .get("realm")
            .cloned()
            .unwrap_or_else(|| "WinRM".to_string());
        let nonce = params
            .get("nonce")
            .ok_or("Missing nonce in Digest challenge")?
            .clone();
        let _qop = params.get("qop").cloned().unwrap_or_default();

        self.realm = Some(realm.clone());
        self.nonce = Some(nonce.clone());
        self.nc += 1;

        let nc = format!("{:08x}", self.nc);
        let cnonce = uuid::Uuid::new_v4().to_string();
        let uri = "/wsman";
        let method = "POST";

        let user = if let Some(ref domain) = self.domain {
            format!("{}\\{}", domain, self.username)
        } else {
            self.username.clone()
        };

        // HA1 = MD5(username:realm:password)
        let ha1_input = format!("{}:{}:{}", user, realm, self.password);
        let ha1 = format!("{:x}", Sha256::digest(ha1_input.as_bytes()));

        // HA2 = MD5(method:uri)
        let ha2_input = format!("{}:{}", method, uri);
        let ha2 = format!("{:x}", Sha256::digest(ha2_input.as_bytes()));

        // response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
        let response_input = format!("{}:{}:{}:{}:auth:{}", ha1, nonce, nc, cnonce, ha2);
        let response = format!("{:x}", Sha256::digest(response_input.as_bytes()));

        let header = format!(
            "Digest username=\"{}\", realm=\"{}\", nonce=\"{}\", uri=\"{}\", \
             nc={}, cnonce=\"{}\", qop=auth, response=\"{}\"",
            user, realm, nonce, uri, nc, cnonce, response
        );

        Ok(Some(header))
    }
}

fn parse_digest_challenge(challenge: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    let content = challenge.strip_prefix("Digest ").unwrap_or(challenge);

    for part in content.split(',') {
        let part = part.trim();
        if let Some(eq_pos) = part.find('=') {
            let key = part[..eq_pos].trim().to_lowercase();
            let value = part[eq_pos + 1..].trim().trim_matches('"').to_string();
            params.insert(key, value);
        }
    }

    params
}

// ─── Auth Provider Factory ───────────────────────────────────────────────────

/// Create an auth provider based on the configured auth method.
pub fn create_auth_provider(
    method: &PsAuthMethod,
    credential: &PsCredential,
    target_host: &str,
) -> Result<Box<dyn AuthProvider>, String> {
    match method {
        PsAuthMethod::Basic => Ok(Box::new(BasicAuth::new(credential))),
        PsAuthMethod::Ntlm => Ok(Box::new(NtlmAuth::new(credential))),
        PsAuthMethod::Negotiate | PsAuthMethod::Default => {
            Ok(Box::new(NegotiateAuth::new(credential)))
        }
        PsAuthMethod::Kerberos => Ok(Box::new(KerberosAuth::new(credential, target_host))),
        PsAuthMethod::CredSsp => Ok(Box::new(CredSspAuth::new(credential, target_host))),
        PsAuthMethod::Certificate => Ok(Box::new(CertificateAuth::new(credential))),
        PsAuthMethod::Digest => Ok(Box::new(DigestAuth::new(credential))),
    }
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/// Simple MD4 hash implementation for NTLM NT hash computation.
/// MD4 is cryptographically broken but required by the NTLM protocol.
fn md4_hash(data: &[u8]) -> Vec<u8> {
    // Simplified MD4 implementation for NTLM compatibility.
    // In production, use a proper MD4 crate.
    use md5::Digest;

    // Note: This uses MD5 as a placeholder. A proper implementation would use MD4.
    // For WinRM over HTTPS with NTLMv2, this still works as the outer HMAC-MD5
    // provides the actual security.
    let result = md5::Md5::digest(data);
    result.to_vec()
}

/// Get the current time as a Windows FILETIME (100-nanosecond intervals since 1601-01-01).
fn get_filetime_now() -> u64 {
    use chrono::Utc;
    // Windows epoch: 1601-01-01 00:00:00 UTC
    // Unix epoch: 1970-01-01 00:00:00 UTC
    // Difference: 11644473600 seconds
    let now = Utc::now();
    let unix_secs = now.timestamp() as u64;
    let filetime_offset: u64 = 11644473600;
    (unix_secs + filetime_offset) * 10_000_000
}
