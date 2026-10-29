//! K1: the per-attempt interception CA (owner: x1).
//!
//! Each browser attempt gets a fresh in-memory ECDSA P-256 CA that only that
//! attempt's CEF context trusts (`CUSTOM_ONLY` anchor). The key is never
//! serialised, logged, written to disk or exposed through IPC, and it drops
//! with the session.
//!
//! - CA: `CA:TRUE pathlen:0`, `keyCertSign`/`cRLSign`, random CN suffix,
//!   valid now-1d..now+400d.
//! - One leaf key pair per attempt. One leaf per exact authority (host and
//!   port), SAN DNS or IP, EKU serverAuth, valid now-1d..now+7d, re-minted
//!   inside 24 h of expiry. At most `LEAF_CACHE` authorities are retained
//!   (least recently used evicted).

use crate::private_forward_proxy::Authority;
use rand::RngCore;
use rcgen::{
    BasicConstraints, Certificate, CertificateParams, DistinguishedName, DnType,
    ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType, SerialNumber,
    PKCS_ECDSA_P256_SHA256,
};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::server::{ClientHello, NoServerSessionStorage, ResolvesServerCert};
use rustls::sign::{CertifiedKey, SigningKey};
use std::collections::HashMap;
use std::io;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

/// Authorities whose leaves stay cached per attempt.
pub(crate) const LEAF_CACHE: usize = 512;
const DAY: Duration = Duration::from_secs(24 * 60 * 60);
const CA_LIFETIME: Duration = Duration::from_secs(400 * 24 * 60 * 60);
const LEAF_LIFETIME: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// A cached leaf is re-minted once it is this close to `notAfter`.
const REMINT_WITHIN: Duration = DAY;
/// rcgen's default `not_before` (1975-01-01T00:00:00Z) in Unix seconds. Used
/// to build `OffsetDateTime` values without depending on `time` directly.
const RCGEN_DEFAULT_EPOCH: u64 = 157_766_400;
pub(crate) const ALPN_H2: &[u8] = b"h2";
pub(crate) const ALPN_HTTP11: &[u8] = b"http/1.1";

fn io_error(message: &'static str) -> io::Error {
    io::Error::other(message)
}

fn provider() -> Arc<CryptoProvider> {
    CryptoProvider::get_default()
        .cloned()
        .unwrap_or_else(|| Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
}

fn unix(time: SystemTime) -> io::Result<u64> {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| io_error("System clock before 1970"))
}

/// Sets `not_before`/`not_after` from absolute times (whole seconds).
fn set_validity(
    params: &mut CertificateParams,
    not_before: SystemTime,
    not_after: SystemTime,
) -> io::Result<()> {
    let base = CertificateParams::default().not_before;
    let since = |t: SystemTime| -> io::Result<Duration> {
        unix(t)?
            .checked_sub(RCGEN_DEFAULT_EPOCH)
            .map(Duration::from_secs)
            .ok_or_else(|| io_error("System clock before 1975"))
    };
    params.not_before = base + since(not_before)?;
    params.not_after = base + since(not_after)?;
    Ok(())
}

fn random_serial() -> io::Result<SerialNumber> {
    let mut serial = [0u8; 16];
    rand::rngs::OsRng
        .try_fill_bytes(&mut serial)
        .map_err(|_| io_error("Interception serial generation failed"))?;
    // Positive, nonzero leading byte keeps the DER INTEGER at 16 bytes.
    serial[0] = (serial[0] & 0x7f) | 0x01;
    Ok(SerialNumber::from_slice(&serial))
}

struct Leaf {
    certified: Arc<CertifiedKey>,
    der: Vec<u8>,
    /// The previous leaf for this authority, kept so a handshake that began
    /// just before a re-mint is still recognised by the CEF hook.
    previous: Option<Vec<u8>>,
    not_after: SystemTime,
    last_used: u64,
}

struct LeafCache {
    leaves: HashMap<Authority, Leaf>,
    tick: u64,
}

/// Deliberately no `Debug`, `Clone` or serde: it holds a private key.
pub struct InterceptAuthority {
    anchor_der: Vec<u8>,
    /// The CA (rcgen keeps its key pair inside; dropped with the session).
    ca: Certificate,
    /// PKCS#8 of the per-attempt leaf key pair, only to rebuild rcgen params.
    leaf_key: Zeroizing<Vec<u8>>,
    leaf_signer: Arc<dyn SigningKey>,
    provider: Arc<CryptoProvider>,
    cache: Mutex<LeafCache>,
}

impl InterceptAuthority {
    /// Mints a fresh CA for one attempt.
    pub fn generate() -> io::Result<Arc<Self>> {
        Self::generate_at(SystemTime::now())
    }

    pub(crate) fn generate_at(now: SystemTime) -> io::Result<Arc<Self>> {
        let mut suffix = [0u8; 8];
        rand::rngs::OsRng
            .try_fill_bytes(&mut suffix)
            .map_err(|_| io_error("Interception CA generation failed"))?;
        let mut params = CertificateParams::default();
        params.alg = &PKCS_ECDSA_P256_SHA256;
        let mut name = DistinguishedName::new();
        name.push(
            DnType::CommonName,
            format!("sortOfRemoteNG attempt {}", hex::encode(suffix)),
        );
        params.distinguished_name = name;
        params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        params.serial_number = Some(random_serial()?);
        set_validity(&mut params, now - DAY, now + CA_LIFETIME)?;
        params.key_pair = Some(
            KeyPair::generate(&PKCS_ECDSA_P256_SHA256)
                .map_err(|_| io_error("Interception CA generation failed"))?,
        );
        let ca = Certificate::from_params(params)
            .map_err(|_| io_error("Interception CA generation failed"))?;
        let anchor_der = ca
            .serialize_der()
            .map_err(|_| io_error("Interception CA generation failed"))?;

        let leaf_pair = KeyPair::generate(&PKCS_ECDSA_P256_SHA256)
            .map_err(|_| io_error("Interception key generation failed"))?;
        let leaf_key = Zeroizing::new(leaf_pair.serialize_der());
        drop(leaf_pair);
        let provider = provider();
        let leaf_signer = provider
            .key_provider
            .load_private_key(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
                leaf_key.to_vec(),
            )))
            .map_err(|_| io_error("Interception key load failed"))?;
        Ok(Arc::new(Self {
            anchor_der,
            ca,
            leaf_key,
            leaf_signer,
            provider,
            cache: Mutex::new(LeafCache {
                leaves: HashMap::new(),
                tick: 0,
            }),
        }))
    }

    /// DER of the CA certificate: the single trust anchor of the attempt's
    /// CEF context.
    pub fn anchor_der(&self) -> &[u8] {
        &self.anchor_der
    }

    /// True only for a leaf this authority minted for exactly `host:port`.
    /// `host` may carry IPv6 brackets.
    pub fn admits_leaf(&self, host: &str, port: u16, leaf_der: &[u8]) -> bool {
        let host = host
            .strip_prefix('[')
            .and_then(|h| h.strip_suffix(']'))
            .unwrap_or(host);
        let text = if host.contains(':') {
            format!("[{host}]:{port}")
        } else {
            format!("{host}:{port}")
        };
        let Ok(authority) = Authority::parse(&text) else {
            return false;
        };
        let Ok(cache) = self.cache.lock() else {
            return false;
        };
        cache
            .leaves
            .get(&authority)
            .is_some_and(|leaf| leaf.der == leaf_der || leaf.previous.as_deref() == Some(leaf_der))
    }

    /// Server config for one tunnel: leaf for `authority`, ALPN restricted to
    /// the client's offer intersected with `h2`/`http/1.1` (h2 preferred).
    pub(crate) fn server_config(
        &self,
        authority: &Authority,
        client_alpn: &[Vec<u8>],
    ) -> io::Result<Arc<rustls::ServerConfig>> {
        self.server_config_at(authority, client_alpn, SystemTime::now())
    }

    pub(crate) fn server_config_at(
        &self,
        authority: &Authority,
        client_alpn: &[Vec<u8>],
        now: SystemTime,
    ) -> io::Result<Arc<rustls::ServerConfig>> {
        let certified = self.leaf_at(authority, now)?;
        let mut config = rustls::ServerConfig::builder_with_provider(self.provider.clone())
            .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
            .map_err(|_| io_error("Interception TLS configuration failed"))?
            .with_no_client_auth()
            .with_cert_resolver(Arc::new(MintedLeaf(certified)));
        config.alpn_protocols = [ALPN_H2, ALPN_HTTP11]
            .into_iter()
            .filter(|p| client_alpn.iter().any(|offer| offer.as_slice() == *p))
            .map(<[u8]>::to_vec)
            .collect();
        // The engine never resumes (patch 0001); keep no session state either.
        config.session_storage = Arc::new(NoServerSessionStorage {});
        config.send_tls13_tickets = 0;
        config.max_early_data_size = 0;
        Ok(Arc::new(config))
    }

    /// Cached leaf for `authority`, minted or re-minted as needed.
    pub(crate) fn leaf_at(
        &self,
        authority: &Authority,
        now: SystemTime,
    ) -> io::Result<Arc<CertifiedKey>> {
        let mut cache = self.cache.lock().map_err(|_| super::unavailable())?;
        cache.tick += 1;
        let tick = cache.tick;
        let previous = match cache.leaves.get_mut(authority) {
            Some(leaf) if leaf.not_after > now + REMINT_WITHIN => {
                leaf.last_used = tick;
                return Ok(leaf.certified.clone());
            }
            Some(leaf) => Some(std::mem::take(&mut leaf.der)),
            None => None,
        };
        let (der, not_after) = self.mint(authority, now)?;
        let certified = Arc::new(CertifiedKey::new(
            vec![
                CertificateDer::from(der.clone()),
                CertificateDer::from(self.anchor_der.clone()),
            ],
            self.leaf_signer.clone(),
        ));
        if previous.is_none() && cache.leaves.len() >= LEAF_CACHE {
            if let Some(oldest) = cache
                .leaves
                .iter()
                .min_by_key(|(_, leaf)| leaf.last_used)
                .map(|(key, _)| key.clone())
            {
                cache.leaves.remove(&oldest);
            }
        }
        cache.leaves.insert(
            authority.clone(),
            Leaf {
                certified: certified.clone(),
                der,
                previous,
                not_after,
                last_used: tick,
            },
        );
        Ok(certified)
    }

    fn mint(&self, authority: &Authority, now: SystemTime) -> io::Result<(Vec<u8>, SystemTime)> {
        let failed = || io_error("Interception leaf minting failed");
        let mut params = CertificateParams::default();
        params.alg = &PKCS_ECDSA_P256_SHA256;
        let host = authority.host();
        let mut name = DistinguishedName::new();
        match host.parse::<IpAddr>() {
            Ok(ip) => params.subject_alt_names = vec![SanType::IpAddress(ip)],
            Err(_) => {
                name.push(DnType::CommonName, host);
                params.subject_alt_names = vec![SanType::DnsName(host.to_string())];
            }
        }
        params.distinguished_name = name;
        params.is_ca = IsCa::ExplicitNoCa;
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        params.use_authority_key_identifier_extension = true;
        params.serial_number = Some(random_serial()?);
        let not_after = now + LEAF_LIFETIME;
        set_validity(&mut params, now - DAY, not_after)?;
        params.key_pair = Some(KeyPair::from_der(&self.leaf_key).map_err(|_| failed())?);
        let leaf = Certificate::from_params(params).map_err(|_| failed())?;
        let der = leaf
            .serialize_der_with_signer(&self.ca)
            .map_err(|_| failed())?;
        // Whole seconds, like the encoded certificate.
        let not_after = UNIX_EPOCH + Duration::from_secs(unix(not_after)?);
        Ok((der, not_after))
    }

    #[cfg(test)]
    pub(crate) fn cached_leaves(&self) -> usize {
        self.cache.lock().map(|c| c.leaves.len()).unwrap_or(0)
    }
}

/// Resolves exactly one minted leaf; no SNI-based selection (the tunnel
/// already checked SNI against the CONNECT authority).
struct MintedLeaf(Arc<CertifiedKey>);

impl std::fmt::Debug for MintedLeaf {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MintedLeaf")
    }
}

impl ResolvesServerCert for MintedLeaf {
    fn resolve(&self, _client_hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        Some(self.0.clone())
    }
}
