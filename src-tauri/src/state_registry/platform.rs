use super::*;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>) {
    let hyperv_service: HyperVServiceState =
        Arc::new(Mutex::new(hyperv::service::HyperVService::new()));
    app.manage(hyperv_service);

    let vmware_service: VmwareServiceState =
        Arc::new(Mutex::new(vmware::service::VmwareService::new()));
    app.manage(vmware_service);

    let vmware_desktop_service: VmwDesktopServiceState =
        Arc::new(Mutex::new(vmware_desktop::service::VmwDesktopService::new()));
    app.manage(vmware_desktop_service);

    let proxmox_service: ProxmoxServiceState =
        Arc::new(Mutex::new(proxmox::service::ProxmoxService::new()));
    app.manage(proxmox_service);

    let idrac_service: IdracServiceState =
        Arc::new(Mutex::new(idrac::service::IdracService::new()));
    app.manage(idrac_service);

    let ilo_service: IloServiceState = Arc::new(Mutex::new(ilo::service::IloService::new()));
    app.manage(ilo_service);

    let lenovo_service: LenovoServiceState =
        Arc::new(Mutex::new(lenovo::service::LenovoService::new()));
    app.manage(lenovo_service);

    let smc_service: SmcServiceState = Arc::new(Mutex::new(supermicro::service::SmcService::new()));
    app.manage(smc_service);

    let synology_service: SynologyServiceState =
        Arc::new(Mutex::new(synology::service::SynologyService::new()));
    app.manage(synology_service);

    let meshcentral_dedicated_service = MeshCentralService::new();
    app.manage(meshcentral_dedicated_service);

    let mremoteng_service = MremotengService::new();
    app.manage(mremoteng_service);

    let termserv_state = termserv::service::TermServService::new_state();
    app.manage(termserv_state);
}
