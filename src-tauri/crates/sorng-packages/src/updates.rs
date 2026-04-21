//! Cross-backend update checking.
use crate::error::PkgError;
use crate::types::*;

pub async fn check_updates(host: &PkgHost) -> Result<Vec<PackageUpdate>, PkgError> {
    match host.backend {
        PkgBackend::Apt => crate::apt::list_upgradable(host).await,
        PkgBackend::Dnf | PkgBackend::Yum => crate::dnf::list_updates(host).await,
        PkgBackend::Pacman => crate::pacman::list_updates(host).await,
        PkgBackend::Zypper => crate::zypper::list_updates(host).await,
    }
}

pub async fn apply_updates(host: &PkgHost) -> Result<String, PkgError> {
    match host.backend {
        PkgBackend::Apt => crate::apt::upgrade(host).await,
        PkgBackend::Dnf | PkgBackend::Yum => crate::dnf::upgrade(host).await,
        PkgBackend::Pacman => crate::pacman::sync_update(host).await,
        PkgBackend::Zypper => crate::zypper::upgrade(host).await,
    }
}
