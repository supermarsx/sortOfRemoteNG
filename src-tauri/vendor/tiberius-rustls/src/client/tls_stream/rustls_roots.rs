use std::io;
use tokio_rustls::rustls::{pki_types::CertificateDer, RootCertStore};

/// One fallible boundary shared by the production adapter and loopback tests.
pub(super) fn root_store(
    native: Vec<CertificateDer<'static>>,
    extra: Option<CertificateDer<'static>>,
) -> io::Result<RootCertStore> {
    let mut roots = RootCertStore::empty();
    roots.add_parsable_certificates(native);
    if let Some(certificate) = extra {
        roots.add(certificate).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "The configured SQL Server CA certificate is invalid.",
            )
        })?;
    }
    if roots.is_empty() {
        return Err(io::Error::new(io::ErrorKind::NotFound,
            "No usable TLS roots are available. Restore the OS certificate store or configure a valid SQL Server CA certificate; verification was not disabled."));
    }
    Ok(roots)
}
