//! Local TLS-only compatibility patch; see vendor/tiberius-rustls/PATCHES.md.
use crate::{
    client::{config::Config, TrustConfig},
    Error,
};
use futures_util::io::{AsyncRead, AsyncWrite};
use std::{
    fs, io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tokio_rustls::{
    rustls::{
        self,
        client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
        crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider},
        pki_types::{CertificateDer, ServerName, UnixTime},
        ClientConfig, DigitallySignedStruct, SignatureScheme,
    },
    TlsConnector,
};
use tokio_util::compat::{Compat, FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tracing::{event, Level};

#[path = "rustls_roots.rs"]
mod roots;

impl From<rustls::Error> for Error {
    fn from(error: rustls::Error) -> Self {
        Self::Tls(error.to_string())
    }
}

pub(crate) struct TlsStream<S: AsyncRead + AsyncWrite + Unpin + Send>(
    Compat<tokio_rustls::client::TlsStream<Compat<S>>>,
);

#[derive(Debug)]
struct NoCertVerifier {
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn server_name(config: &Config) -> crate::Result<ServerName<'static>> {
    match (
        ServerName::try_from(config.get_host().to_owned()),
        &config.trust,
    ) {
        (Ok(name), _) => Ok(name),
        // Preserve the explicit existing TrustServerCertificate mode only.
        (Err(_), TrustConfig::TrustAll) => {
            Ok(ServerName::try_from("placeholder.domain.com").unwrap())
        }
        (Err(error), _) => Err(Error::Tls(error.to_string())),
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send> TlsStream<S> {
    pub(super) async fn new(config: &Config, stream: S) -> crate::Result<Self> {
        // Never install/select a process-global provider: other app clients may
        // legitimately use another provider in the same full-feature process.
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let builder = ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()?;
        let client_config = match &config.trust {
            TrustConfig::TrustAll => {
                event!(
                    Level::WARN,
                    "Trusting the server certificate without validation."
                );
                builder
                    .dangerous()
                    .with_custom_certificate_verifier(Arc::new(NoCertVerifier { provider }))
                    .with_no_client_auth()
            }
            trust => {
                let extra = if let TrustConfig::CaCertificateLocation(path) = trust {
                    let bytes = fs::read(path).map_err(|error| Error::Tls(error.to_string()))?;
                    match path
                        .extension()
                        .map(|extension| extension.to_ascii_lowercase())
                    {
                        Some(extension) if extension == "pem" || extension == "crt" => {
                            let mut certificates = rustls_pemfile::certs(&mut bytes.as_slice())
                                .collect::<io::Result<Vec<_>>>()
                                .map_err(|error| Error::Tls(error.to_string()))?;
                            if certificates.len() != 1 {
                                return Err(Error::Tls("The configured CA file must contain exactly one PEM certificate.".into()));
                            }
                            certificates.pop()
                        }
                        Some(extension) if extension == "der" => Some(CertificateDer::from(bytes)),
                        _ => {
                            return Err(Error::Tls(
                                "Unsupported CA certificate extension; use PEM, CRT or DER.".into(),
                            ))
                        }
                    }
                } else {
                    None
                };
                // Same additive semantics as the previous native-TLS backend.
                // An explicit valid CA can also work on a machine with no OS roots.
                let native = rustls_native_certs::load_native_certs();
                let store = roots::root_store(native.certs, extra)
                    .map_err(|error| Error::Tls(error.to_string()))?;
                builder.with_root_certificates(store).with_no_client_auth()
            }
        };
        let stream = TlsConnector::from(Arc::new(client_config))
            .connect(server_name(config)?, stream.compat())
            .await
            .map_err(|error| Error::Tls(error.to_string()))?;
        Ok(Self(stream.compat()))
    }

    pub(crate) fn get_mut(&mut self) -> &mut S {
        self.0.get_mut().get_mut().0.get_mut()
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send> AsyncRead for TlsStream<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut [u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut Pin::get_mut(self).0).poll_read(cx, buf)
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send> AsyncWrite for TlsStream<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut Pin::get_mut(self).0).poll_write(cx, buf)
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut Pin::get_mut(self).0).poll_flush(cx)
    }
    fn poll_close(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut Pin::get_mut(self).0).poll_close(cx)
    }
}
