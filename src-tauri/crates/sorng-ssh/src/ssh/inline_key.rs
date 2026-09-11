//! Windows in-memory authentication without changing libssh2's transport backend.
//! The public signing callback works with WinCNG as well as OpenSSL builds.
//! Never use this module for custom-allocator sessions: `ssh2::Session::new`
//! installs the default allocator. This mirrors ssh2 0.9.6's keyboard-interactive
//! callback, which allocates with libc::malloc for libssh2 to free. The bundled
//! cc build and supported vcpkg MD builds share the selected Windows CRT.

use libc::{c_char, c_int, c_void};
use libssh2_sys::LIBSSH2_SESSION;
use rsa::{
    pkcs1::DecodeRsaPrivateKey,
    pkcs8::DecodePrivateKey,
    signature::{RandomizedSigner, SignatureEncoding, Signer},
    traits::PublicKeyParts,
    BigUint, RsaPrivateKey,
};
use ssh_key::{private::KeypairData, PrivateKey};
use std::{ffi::CString, panic::AssertUnwindSafe, ptr, slice};

pub(super) const ERROR: &str =
    "In-memory SSH key is invalid, unsupported, or could not authenticate";
pub(super) const MAX_KEY: usize = 65_536;
const MAX_SIGNED: usize = 131_072;
pub(super) type Result<T> = std::result::Result<T, &'static str>;

// Missing from libssh2-sys 0.3.2's bindings, present in the stable public C ABI.
unsafe extern "C" {
    fn libssh2_userauth_publickey(
        session: *mut LIBSSH2_SESSION,
        username: *const c_char,
        public_key: *const u8,
        public_key_len: usize,
        sign: unsafe extern "C" fn(
            *mut LIBSSH2_SESSION,
            *mut *mut u8,
            *mut usize,
            *const u8,
            usize,
            *mut *mut c_void,
        ) -> c_int,
        context: *mut *mut c_void,
    ) -> c_int;
}

enum Key {
    Rsa(Box<RsaPrivateKey>),
    Ssh(Box<PrivateKey>),
}

impl Key {
    fn parse(pem: &str, passphrase: Option<&str>) -> Result<Self> {
        if pem.len() > MAX_KEY
            || pem.as_bytes().contains(&0)
            || passphrase.is_some_and(|p| p.len() > MAX_KEY)
        {
            return Err(ERROR);
        }
        let pem = pem.trim();
        if pem.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
            let mut key = PrivateKey::from_openssh(pem).map_err(|_| ERROR)?;
            if key.is_encrypted() {
                // Inspect cost before any attacker-controlled KDF is executed.
                match key.kdf() {
                    ssh_key::Kdf::Bcrypt { salt, rounds }
                        if (1..=128).contains(rounds) && (16..=64).contains(&salt.len()) => {}
                    _ => return Err(ERROR),
                }
                key = key
                    .decrypt(passphrase.ok_or(ERROR)?.as_bytes())
                    .map_err(|_| ERROR)?;
            }
            return match key.key_data() {
                KeypairData::Rsa(pair) => {
                    // ssh-key 0.6.7's RSA conversion duplicates p; construct with p AND q.
                    let n = BigUint::try_from(&pair.public.n).map_err(|_| ERROR)?;
                    if !(1024..=8192).contains(&n.bits()) {
                        return Err(ERROR);
                    }
                    let e = BigUint::try_from(&pair.public.e).map_err(|_| ERROR)?;
                    let mut d = zeroize::Zeroizing::new(
                        BigUint::try_from(&pair.private.d).map_err(|_| ERROR)?,
                    );
                    let mut p = zeroize::Zeroizing::new(
                        BigUint::try_from(&pair.private.p).map_err(|_| ERROR)?,
                    );
                    let mut q = zeroize::Zeroizing::new(
                        BigUint::try_from(&pair.private.q).map_err(|_| ERROR)?,
                    );
                    let key = RsaPrivateKey::from_components(
                        n,
                        e,
                        std::mem::take(&mut *d),
                        vec![std::mem::take(&mut *p), std::mem::take(&mut *q)],
                    )
                    .map_err(|_| ERROR)?;
                    Self::rsa(key)
                }
                KeypairData::Ed25519(_) | KeypairData::Ecdsa(_) | KeypairData::Dsa(_) => {
                    Self::ssh(key)
                }
                _ => Err(ERROR),
            };
        }
        if pem.starts_with("-----BEGIN ENCRYPTED PRIVATE KEY-----") {
            let (label, doc) = pkcs8::der::SecretDocument::from_pem(pem).map_err(|_| ERROR)?;
            if label != "ENCRYPTED PRIVATE KEY" {
                return Err(ERROR);
            }
            let encrypted =
                pkcs8::EncryptedPrivateKeyInfo::try_from(doc.as_bytes()).map_err(|_| ERROR)?;
            let params = encrypted.encryption_algorithm.pbes2().ok_or(ERROR)?;
            validate_kdf(&params.kdf)?;
            let plain = encrypted
                .decrypt(passphrase.ok_or(ERROR)?)
                .map_err(|_| ERROR)?;
            Self::pkcs8(plain.as_bytes())
        } else if pem.starts_with("-----BEGIN PRIVATE KEY-----") {
            let (_, doc) = pkcs8::der::SecretDocument::from_pem(pem).map_err(|_| ERROR)?;
            Self::pkcs8(doc.as_bytes())
        } else {
            let (label, der) = super::inline_key_pem::decode(pem, passphrase)?;
            match label.as_str() {
                "RSA PRIVATE KEY" => {
                    Self::rsa(RsaPrivateKey::from_pkcs1_der(&der).map_err(|_| ERROR)?)
                }
                "EC PRIVATE KEY" => Self::ec(&der, true),
                "DSA PRIVATE KEY" => Self::dsa_der(&der),
                _ => Err(ERROR),
            }
        }
    }

    fn pkcs8(der: &[u8]) -> Result<Self> {
        use pkcs8::der::Decode;
        let info = pkcs8::PrivateKeyInfo::from_der(der).map_err(|_| ERROR)?;
        match info.algorithm.oid.to_string().as_str() {
            "1.2.840.113549.1.1.1" => {
                Self::rsa(RsaPrivateKey::from_pkcs8_der(der).map_err(|_| ERROR)?)
            }
            "1.2.840.10045.2.1" => Self::ec(der, false),
            "1.3.101.112" => {
                let key = ed25519_dalek::SigningKey::from_pkcs8_der(der).map_err(|_| ERROR)?;
                Self::ssh(
                    PrivateKey::new(ssh_key::private::Ed25519Keypair::from(key).into(), "")
                        .map_err(|_| ERROR)?,
                )
            }
            "1.2.840.10040.4.1" => {
                use pkcs8::der::asn1::UintRef;
                let params = info.algorithm.parameters.ok_or(ERROR)?;
                let (p, q, g) = params
                    .sequence(|reader| {
                        Ok((
                            UintRef::decode(reader)?,
                            UintRef::decode(reader)?,
                            UintRef::decode(reader)?,
                        ))
                    })
                    .map_err(|_| ERROR)?;
                let x = UintRef::from_der(info.private_key).map_err(|_| ERROR)?;
                if p.as_bytes().len() != 128
                    || q.as_bytes().len() != 20
                    || g.as_bytes().len() > 128
                    || x.as_bytes().len() > 20
                {
                    return Err(ERROR);
                }
                let x = zeroize::Zeroizing::new(dsa::BigUint::from_bytes_be(x.as_bytes()));
                let q = dsa::BigUint::from_bytes_be(q.as_bytes());
                if x.bits() == 0 || *x >= q {
                    return Err(ERROR);
                }
                if let Some(public) = info.public_key {
                    let y = UintRef::from_der(public).map_err(|_| ERROR)?;
                    if y.as_bytes().len() > 128 {
                        return Err(ERROR);
                    }
                    let y = dsa::BigUint::from_bytes_be(y.as_bytes());
                    if y.bits() == 0 || y >= dsa::BigUint::from_bytes_be(p.as_bytes()) {
                        return Err(ERROR);
                    }
                }
                let key = dsa::SigningKey::from_pkcs8_der(der).map_err(|_| ERROR)?;
                Self::ssh(
                    PrivateKey::new(
                        ssh_key::private::DsaKeypair::try_from(key)
                            .map_err(|_| ERROR)?
                            .into(),
                        "",
                    )
                    .map_err(|_| ERROR)?,
                )
            }
            _ => Err(ERROR),
        }
    }

    fn ec(der: &[u8], sec1: bool) -> Result<Self> {
        use pkcs8::der::Decode;
        let declared_curve = if sec1 {
            Some(
                sec1::EcPrivateKey::from_der(der)
                    .map_err(|_| ERROR)?
                    .parameters
                    .and_then(|p| p.named_curve())
                    .ok_or(ERROR)?
                    .to_string(),
            )
        } else {
            None
        };
        macro_rules! curve {
            ($curve:ident, $variant:ident, $oid:literal) => {
                if declared_curve.as_deref().is_none_or(|oid| oid == $oid) {
                    if let Ok(key) = if sec1 {
                        $curve::SecretKey::from_sec1_der(der)
                    } else {
                        $curve::SecretKey::from_pkcs8_der(der)
                            .map_err(|_| $curve::elliptic_curve::Error)
                    } {
                        let public = key.public_key();
                        return Self::ssh(
                            PrivateKey::new(
                                ssh_key::private::EcdsaKeypair::$variant {
                                    public: public.into(),
                                    private: key.into(),
                                }
                                .into(),
                                "",
                            )
                            .map_err(|_| ERROR)?,
                        );
                    }
                }
            };
        }
        curve!(p256, NistP256, "1.2.840.10045.3.1.7");
        curve!(p384, NistP384, "1.3.132.0.34");
        curve!(p521, NistP521, "1.3.132.0.35");
        Err(ERROR)
    }

    fn dsa_der(der: &[u8]) -> Result<Self> {
        use pkcs8::der::{asn1::UintRef, Decode, Reader, SliceReader};
        let mut reader = SliceReader::new(der).map_err(|_| ERROR)?;
        let values = reader
            .sequence(|reader| {
                if u8::decode(reader)? != 0 {
                    return Err(pkcs8::der::ErrorKind::Failed.into());
                }
                Ok([
                    UintRef::decode(reader)?,
                    UintRef::decode(reader)?,
                    UintRef::decode(reader)?,
                    UintRef::decode(reader)?,
                    UintRef::decode(reader)?,
                ])
            })
            .map_err(|_| ERROR)?;
        reader.finish(()).map_err(|_| ERROR)?;
        let [p, q, g, y, x] = values.map(|v| dsa::BigUint::from_bytes_be(v.as_bytes()));
        let mut x = zeroize::Zeroizing::new(x);
        if p.bits() != 1024
            || q.bits() != 160
            || g.bits() > 1024
            || y.bits() > 1024
            || x.bits() > 160
            || x.bits() == 0
            || *x >= q
        {
            return Err(ERROR);
        }
        let components = dsa::Components::from_components(p, q, g).map_err(|_| ERROR)?;
        let public = dsa::VerifyingKey::from_components(components, y).map_err(|_| ERROR)?;
        let key =
            dsa::SigningKey::from_components(public, std::mem::take(&mut *x)).map_err(|_| ERROR)?;
        Self::ssh(
            PrivateKey::new(
                ssh_key::private::DsaKeypair::try_from(key)
                    .map_err(|_| ERROR)?
                    .into(),
                "",
            )
            .map_err(|_| ERROR)?,
        )
    }

    fn ssh(key: PrivateKey) -> Result<Self> {
        // Prove public/private consistency locally before offering the public key.
        use rsa::signature::Verifier;
        if let KeypairData::Dsa(pair) = key.key_data() {
            if pair.public.p.as_bytes().len() > 129
                || pair.public.q.as_bytes().len() > 21
                || pair.public.g.as_bytes().len() > 129
                || pair.public.y.as_bytes().len() > 129
                || pair.private.as_bytes().len() > 21
            {
                return Err(ERROR);
            }
            let x =
                zeroize::Zeroizing::new(dsa::BigUint::try_from(&pair.private).map_err(|_| ERROR)?);
            let q = dsa::BigUint::try_from(&pair.public.q).map_err(|_| ERROR)?;
            if x.bits() == 0 || x.bits() > 160 || *x >= q {
                return Err(ERROR);
            }
        }
        let proof: ssh_key::Signature = key
            .try_sign(b"in-memory SSH key consistency")
            .map_err(|_| ERROR)?;
        key.public_key()
            .key_data()
            .verify(b"in-memory SSH key consistency", &proof)
            .map_err(|_| ERROR)?;
        Ok(Self::Ssh(Box::new(key)))
    }

    fn rsa(key: RsaPrivateKey) -> Result<Self> {
        if !(1024..=8192).contains(&key.n().bits()) {
            return Err(ERROR);
        }
        key.validate().map_err(|_| ERROR)?;
        Ok(Self::Rsa(Box::new(key)))
    }

    fn public_blob(&self) -> Result<Vec<u8>> {
        match self {
            Self::Rsa(key) => {
                let public =
                    ssh_key::public::RsaPublicKey::try_from(&rsa::RsaPublicKey::from(key.as_ref()))
                        .map_err(|_| ERROR)?;
                ssh_key::PublicKey::new(public.into(), "")
                    .to_bytes()
                    .map_err(|_| ERROR)
            }
            Self::Ssh(key) => key.public_key().to_bytes().map_err(|_| ERROR),
        }
    }

    fn sign(&self, algorithm: &[u8], message: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Rsa(key) => {
                // RandomizedSigner supplies cryptographic blinding to private RSA.
                let mut rng = ssh_key::rand_core::OsRng;
                macro_rules! sign {
                    ($digest:ty) => {
                        rsa::pkcs1v15::SigningKey::<$digest>::new(key.as_ref().clone())
                            .try_sign_with_rng(&mut rng, message)
                            .map(|sig| sig.to_vec())
                            .map_err(|_| ERROR)
                    };
                }
                match algorithm {
                    b"rsa-sha2-512" => sign!(sha2::Sha512),
                    b"rsa-sha2-256" => sign!(sha2::Sha256),
                    // Only if libssh2 negotiated this legacy algorithm; never request a downgrade.
                    b"ssh-rsa" => sign!(sha1::Sha1),
                    _ => Err(ERROR),
                }
            }
            Self::Ssh(key) => {
                if key.algorithm().as_str().as_bytes() != algorithm {
                    return Err(ERROR);
                }
                let signature: ssh_key::Signature = key.try_sign(message).map_err(|_| ERROR)?;
                if signature.algorithm().as_str().as_bytes() != algorithm {
                    return Err(ERROR);
                }
                Ok(signature.as_bytes().to_vec())
            }
        }
    }
}

fn validate_kdf(kdf: &pkcs8::pkcs5::pbes2::Kdf<'_>) -> Result<()> {
    use pkcs8::pkcs5::pbes2::Kdf;
    let valid = match kdf {
        Kdf::Pbkdf2(p) => {
            (1..=1_000_000).contains(&p.iteration_count)
                && (8..=64).contains(&p.salt.len())
                && p.key_length.is_none_or(|n| n <= 64)
        }
        Kdf::Scrypt(p) => {
            p.cost_parameter.is_power_of_two()
                && (2..=65_536).contains(&p.cost_parameter)
                && (1..=8).contains(&p.block_size)
                && (1..=4).contains(&p.parallelization)
                && p.cost_parameter * u64::from(p.block_size) * u64::from(p.parallelization)
                    <= 524_288
                && (8..=64).contains(&p.salt.len())
                && p.key_length.is_none_or(|n| n <= 64)
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(ERROR)
    }
}

fn string<'a>(bytes: &mut &'a [u8]) -> Result<&'a [u8]> {
    let length =
        u32::from_be_bytes(bytes.get(..4).ok_or(ERROR)?.try_into().map_err(|_| ERROR)?) as usize;
    let value = bytes
        .get(4..4usize.checked_add(length).ok_or(ERROR)?)
        .ok_or(ERROR)?;
    *bytes = &bytes[4 + length..];
    Ok(value)
}

struct Context<'a> {
    key: &'a Key,
    username: &'a [u8],
    public: &'a [u8],
    session: *mut LIBSSH2_SESSION,
}

impl Context<'_> {
    fn sign(&self, data: &[u8]) -> Result<Vec<u8>> {
        if data.len() > MAX_SIGNED {
            return Err(ERROR);
        }
        let mut rest = data;
        if !(16..=128).contains(&string(&mut rest)?.len()) || rest.first() != Some(&50) {
            return Err(ERROR);
        }
        rest = &rest[1..];
        if string(&mut rest)? != self.username
            || string(&mut rest)? != b"ssh-connection"
            || string(&mut rest)? != b"publickey"
            || rest.first() != Some(&1)
        {
            return Err(ERROR);
        }
        rest = &rest[1..];
        let algorithm = string(&mut rest)?;
        if string(&mut rest)? != self.public || !rest.is_empty() {
            return Err(ERROR);
        }
        self.key.sign(algorithm, data)
    }
}

unsafe extern "C" fn sign_callback(
    session: *mut LIBSSH2_SESSION,
    output: *mut *mut u8,
    output_len: *mut usize,
    data: *const u8,
    data_len: usize,
    context: *mut *mut c_void,
) -> c_int {
    if output.is_null() || output_len.is_null() {
        return -1;
    }
    // SAFETY: libssh2 owns valid writable output pointers for this synchronous call.
    unsafe {
        *output = ptr::null_mut();
        *output_len = 0;
    }
    if data.is_null() || data_len > MAX_SIGNED || context.is_null() || session.is_null() {
        return -1;
    }
    // Never unwind into C. -1 deliberately differs from ALGO_UNSUPPORTED: no fallback retry.
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| -> Result<()> {
        // SAFETY: context is our stack pointer, retained until the blocking call returns;
        // data is libssh2's bounded buffer and is only borrowed during this callback.
        let context = unsafe { (*context as *const Context<'_>).as_ref() }.ok_or(ERROR)?;
        if context.session != session {
            return Err(ERROR);
        }
        let signature = context.sign(unsafe { slice::from_raw_parts(data, data_len) })?;
        if signature.is_empty() || signature.len() > 16_384 {
            return Err(ERROR);
        }
        // SAFETY: Session::new default allocator pairs this with libssh2's free,
        // as in upstream ssh2's keyboard-interactive callback. No Rust Vec ownership crosses C.
        let allocation = unsafe { libc::malloc(signature.len()) }.cast::<u8>();
        if allocation.is_null() {
            return Err(ERROR);
        }
        unsafe {
            ptr::copy_nonoverlapping(signature.as_ptr(), allocation, signature.len());
            *output = allocation;
            *output_len = signature.len();
        }
        Ok(())
    }));
    if matches!(result, Ok(Ok(()))) {
        0
    } else {
        -1
    }
}

pub(super) fn authenticate(
    session: &ssh2::Session,
    username: &str,
    pem: &str,
    passphrase: Option<&str>,
) -> Result<()> {
    if username.is_empty() || username.len() > 1024 || !session.is_blocking() {
        return Err(ERROR);
    }
    let username_c = CString::new(username).map_err(|_| ERROR)?;
    let key = Key::parse(pem, passphrase)?;
    let public = key.public_blob()?;
    // Hold the same mutex as every ssh2 API throughout the complete blocking call.
    // This prevents concurrent operations/free and keeps the stack callback context alive.
    let mut raw = session.raw();
    let session_ptr = &mut *raw as *mut LIBSSH2_SESSION;
    // A cloned Session could change mode during key parsing; the retained guard
    // makes this final check and the whole callback invocation indivisible.
    if unsafe { libssh2_sys::libssh2_session_get_blocking(session_ptr) } == 0 {
        return Err(ERROR);
    }
    let mut context = Context {
        key: &key,
        username: username.as_bytes(),
        public: &public,
        session: session_ptr,
    };
    let mut context_ptr = (&mut context as *mut Context<'_>).cast::<c_void>();
    // SAFETY: exact stable libssh2 ABI; buffers/guard/context live until synchronous return.
    let result = unsafe {
        libssh2_userauth_publickey(
            session_ptr,
            username_c.as_ptr(),
            public.as_ptr(),
            public.len(),
            sign_callback,
            &mut context_ptr,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(ERROR)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::{
        pkcs8::{EncodePrivateKey, LineEnding},
        signature::Verifier,
    };

    #[test]
    fn inline_key_transport_capability_receipt() {
        let session = ssh2::Session::new().unwrap();
        for (name, kind) in [
            ("HostKey", ssh2::MethodType::HostKey),
            ("Kex", ssh2::MethodType::Kex),
            ("Cipher", ssh2::MethodType::CryptCs),
        ] {
            println!(
                "{name}: {}",
                session.supported_algs(kind).unwrap().join(",")
            );
        }
    }

    fn word(bytes: &[u8], out: &mut Vec<u8>) {
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        out.extend_from_slice(bytes);
    }
    fn packet(username: &[u8], algorithm: &[u8], public: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        word(&[7; 32], &mut bytes);
        bytes.push(50);
        word(username, &mut bytes);
        word(b"ssh-connection", &mut bytes);
        word(b"publickey", &mut bytes);
        bytes.push(1);
        word(algorithm, &mut bytes);
        word(public, &mut bytes);
        bytes
    }
    #[test]
    fn inline_key_rsa_negotiated_hash_is_exact_and_legacy_1024_is_preserved() {
        let rsa = RsaPrivateKey::new(&mut ssh_key::rand_core::OsRng, 1024).unwrap();
        let pem = rsa.to_pkcs8_pem(LineEnding::LF).unwrap();
        let key = Key::parse(
            &format!(" \r\n{} \r\n", pem.as_str().replace('\n', "\r\n")),
            None,
        )
        .unwrap();
        let public = rsa::RsaPublicKey::from(&rsa);
        macro_rules! check {
            ($alg:literal, $hash:ty) => {
                let signature = rsa::pkcs1v15::Signature::try_from(
                    key.sign($alg, b"message").unwrap().as_slice(),
                )
                .unwrap();
                let verifier = rsa::pkcs1v15::VerifyingKey::<$hash>::new(public.clone());
                verifier.verify(b"message", &signature).unwrap();
                assert!(verifier.verify(b"changed", &signature).is_err());
            };
        }
        check!(b"rsa-sha2-512", sha2::Sha512);
        check!(b"rsa-sha2-256", sha2::Sha256);
        check!(b"ssh-rsa", sha1::Sha1);
        assert!(key.sign(b"ssh-ed25519", b"message").is_err());
        assert!(key.sign(b"rsa-sha2-384", b"message").is_err());
    }
    #[test]
    fn inline_key_encrypted_openssh_ed_and_all_ecdsa_curves() {
        for algorithm in [
            ssh_key::Algorithm::Ed25519,
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP256,
            },
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP384,
            },
            ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP521,
            },
        ] {
            let key =
                PrivateKey::random(&mut ssh_key::rand_core::OsRng, algorithm.clone()).unwrap();
            let encrypted = key
                .encrypt(&mut ssh_key::rand_core::OsRng, "fixture-password")
                .unwrap()
                .to_openssh(ssh_key::LineEnding::LF)
                .unwrap();
            assert!(Key::parse(&encrypted, Some("wrong")).is_err());
            assert!(Key::parse(&encrypted, None).is_err());
            let parsed = Key::parse(&encrypted, Some("fixture-password")).unwrap();
            assert_eq!(
                parsed.public_blob().unwrap(),
                key.public_key().to_bytes().unwrap()
            );
            let signed = parsed
                .sign(algorithm.as_str().as_bytes(), b"message")
                .unwrap();
            key.public_key()
                .key_data()
                .verify(
                    b"message",
                    &ssh_key::Signature::new(algorithm, signed).unwrap(),
                )
                .unwrap();
        }
    }
    #[test]
    fn inline_key_callback_validates_packet_and_uses_default_allocator() {
        let parsed = Key::Ssh(Box::new(
            PrivateKey::random(&mut ssh_key::rand_core::OsRng, ssh_key::Algorithm::Ed25519)
                .unwrap(),
        ));
        let public = parsed.public_blob().unwrap();
        let session = ssh2::Session::new().unwrap();
        let mut raw = session.raw();
        let session_ptr = &mut *raw as *mut LIBSSH2_SESSION;
        let mut context = Context {
            key: &parsed,
            username: b"fixture",
            public: &public,
            session: session_ptr,
        };
        let mut ctx = (&mut context as *mut Context<'_>).cast();
        let valid = packet(b"fixture", b"ssh-ed25519", &public);
        let mut output = ptr::null_mut();
        let mut length = 0;
        let result = unsafe {
            sign_callback(
                session_ptr,
                &mut output,
                &mut length,
                valid.as_ptr(),
                valid.len(),
                &mut ctx,
            )
        };
        assert_eq!(result, 0);
        assert_eq!(length, 64);
        assert!(!output.is_null());
        // Actual libssh2 deallocator, not a matching Rust free substitute.
        unsafe {
            libssh2_sys::libssh2_free(session_ptr, output.cast());
        }
        let mut invalid = vec![
            packet(b"other", b"ssh-ed25519", &public),
            packet(b"fixture", b"ssh-rsa", &public),
            packet(b"fixture", b"ssh-ed25519", b"other"),
        ];
        invalid.push([valid.as_slice(), &[0]].concat());
        invalid.push(vec![0; MAX_SIGNED + 1]);
        for mut bytes in invalid {
            output = ptr::dangling_mut();
            length = 100;
            let result = unsafe {
                sign_callback(
                    session_ptr,
                    &mut output,
                    &mut length,
                    bytes.as_mut_ptr(),
                    bytes.len(),
                    &mut ctx,
                )
            };
            assert_eq!(result, -1);
            assert!(output.is_null());
            assert_eq!(length, 0);
        }
        for end in 0..valid.len() {
            assert!(context.sign(&valid[..end]).is_err());
        }
        assert_eq!(
            unsafe {
                sign_callback(
                    session_ptr,
                    &mut output,
                    &mut length,
                    ptr::null(),
                    3,
                    &mut ctx,
                )
            },
            -1
        );
    }
    #[test]
    fn inline_key_costs_and_malformed_input_fail_before_decrypt() {
        use pkcs8::pkcs5::pbes2::{Kdf, Pbkdf2Params, Pbkdf2Prf, ScryptParams};
        let mut pbkdf = Pbkdf2Params {
            salt: &[0; 16],
            iteration_count: 1_000_001,
            key_length: None,
            prf: Pbkdf2Prf::HmacWithSha256,
        };
        assert!(validate_kdf(&Kdf::Pbkdf2(pbkdf)).is_err());
        pbkdf.iteration_count = 2048;
        assert!(validate_kdf(&Kdf::Pbkdf2(pbkdf)).is_ok());
        assert!(validate_kdf(&Kdf::Scrypt(ScryptParams {
            salt: &[0; 16],
            cost_parameter: 1 << 31,
            block_size: 8,
            parallelization: 1,
            key_length: None
        }))
        .is_err());
        for pem in [
            "bad",
            "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----",
            "\0",
        ] {
            assert!(Key::parse(pem, None).is_err());
        }
        assert!(Key::parse(&"x".repeat(MAX_KEY + 1), None).is_err());
        let session = ssh2::Session::new().unwrap();
        session.set_blocking(false);
        assert!(authenticate(&session, "fixture", "bad", None).is_err());
    }

    #[test]
    fn inline_key_sec1_requires_exact_named_curve_and_matching_public_key() {
        use pkcs8::der::{Decode, Encode};
        let key = p256::SecretKey::random(&mut ssh_key::rand_core::OsRng);
        let raw_der = key.to_sec1_der().unwrap();
        let mut named = sec1::EcPrivateKey::from_der(&raw_der).unwrap();
        // RustCrypto's low-level encoder omits the optional named curve; a
        // standalone PEM must supply it (as OpenSSL/ssh-keygen do).
        named.parameters = Some(sec1::EcParameters::NamedCurve(
            pkcs8::ObjectIdentifier::new_unwrap("1.2.840.10045.3.1.7"),
        ));
        let der = zeroize::Zeroizing::new(named.to_der().unwrap());
        assert!(Key::ec(&der, true).is_ok());
        let mut decoded = sec1::EcPrivateKey::from_der(&der).unwrap();
        decoded.public_key = None;
        decoded.parameters = Some(sec1::EcParameters::NamedCurve(
            pkcs8::ObjectIdentifier::new_unwrap("1.3.132.0.10"),
        ));
        assert!(Key::ec(&decoded.to_der().unwrap(), true).is_err());
        decoded.parameters = None;
        assert!(Key::ec(&decoded.to_der().unwrap(), true).is_err());
        decoded.parameters = Some(sec1::EcParameters::NamedCurve(
            pkcs8::ObjectIdentifier::new_unwrap("1.2.840.10045.3.1.7"),
        ));
        let other = p256::SecretKey::random(&mut ssh_key::rand_core::OsRng);
        let other_der = other.to_sec1_der().unwrap();
        decoded.public_key = sec1::EcPrivateKey::from_der(&other_der).unwrap().public_key;
        assert!(Key::ec(&decoded.to_der().unwrap(), true).is_err());
    }

    #[test]
    fn inline_key_dsa_openssh_pkcs8_and_traditional_der_roundtrip_and_bounds() {
        use pkcs8::der::{
            asn1::{AnyRef, UintRef},
            Encode, Tag,
        };
        let key =
            PrivateKey::random(&mut ssh_key::rand_core::OsRng, ssh_key::Algorithm::Dsa).unwrap();
        let pair = key.key_data().dsa().unwrap();
        let dsa = dsa::SigningKey::try_from(pair).unwrap();
        let pkcs8 = dsa.to_pkcs8_pem(LineEnding::LF).unwrap();
        let encrypted = key
            .encrypt(&mut ssh_key::rand_core::OsRng, "fixture")
            .unwrap()
            .to_openssh(ssh_key::LineEnding::LF)
            .unwrap();
        for (pem, password) in [
            (pkcs8.as_str(), None),
            (encrypted.as_str(), Some("fixture")),
        ] {
            let parsed = Key::parse(pem, password).unwrap();
            let sig = ssh_key::Signature::new(
                ssh_key::Algorithm::Dsa,
                parsed.sign(b"ssh-dss", b"message").unwrap(),
            )
            .unwrap();
            key.public_key()
                .key_data()
                .verify(b"message", &sig)
                .unwrap();
        }
        assert!(Key::parse(&encrypted, Some("wrong")).is_err());
        let unsigned = |bytes: &[u8]| UintRef::new(bytes).unwrap().to_der().unwrap();
        let mut content = zeroize::Zeroizing::new(0u8.to_der().unwrap());
        for bytes in [
            pair.public.p.as_positive_bytes().unwrap(),
            pair.public.q.as_positive_bytes().unwrap(),
            pair.public.g.as_positive_bytes().unwrap(),
            pair.public.y.as_positive_bytes().unwrap(),
            pair.private.as_bytes(),
        ] {
            // DER UintRef excludes the SSH mpint sign octet.
            let bytes = if bytes.first() == Some(&0) {
                &bytes[1..]
            } else {
                bytes
            };
            content.extend(unsigned(bytes));
        }
        let der = zeroize::Zeroizing::new(
            AnyRef::new(Tag::Sequence, &content)
                .unwrap()
                .to_der()
                .unwrap(),
        );
        assert_eq!(
            Key::dsa_der(&der).unwrap().public_blob().unwrap(),
            key.public_key().to_bytes().unwrap()
        );
        for end in 0..der.len() {
            assert!(Key::dsa_der(&der[..end]).is_err());
        }
        // Huge private/public integers are refused before any modular operation.
        let mut invalid = 0u8.to_der().unwrap();
        for _ in 0..5 {
            invalid.extend(unsigned(&[1; 1024]));
        }
        assert!(Key::dsa_der(
            &AnyRef::new(Tag::Sequence, &invalid)
                .unwrap()
                .to_der()
                .unwrap()
        )
        .is_err());
    }
}
