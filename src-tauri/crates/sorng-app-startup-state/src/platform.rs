use super::*;

pub(super) fn register(app: &mut tauri::App<tauri::Wry>) {
    let hyperv: HyperVServiceState = Arc::new(Mutex::new(hyperv::service::HyperVService::new()));
    app.manage(hyperv);
    let vmware: VmwareServiceState = Arc::new(Mutex::new(vmware::service::VmwareService::new()));
    app.manage(vmware);
    let desktop: VmwDesktopServiceState =
        Arc::new(Mutex::new(vmware_desktop::service::VmwDesktopService::new()));
    app.manage(desktop);
    let proxmox: ProxmoxServiceState =
        Arc::new(Mutex::new(proxmox::service::ProxmoxService::new()));
    app.manage(proxmox);
    let idrac: IdracServiceState = Arc::new(Mutex::new(idrac::service::IdracService::new()));
    app.manage(idrac);
    let ilo: IloServiceState = Arc::new(Mutex::new(ilo::service::IloService::new()));
    app.manage(ilo);
    let lenovo: LenovoServiceState = Arc::new(Mutex::new(lenovo::service::LenovoService::new()));
    app.manage(lenovo);
    let supermicro: SmcServiceState = Arc::new(Mutex::new(supermicro::service::SmcService::new()));
    app.manage(supermicro);
    let synology: SynologyServiceState =
        Arc::new(Mutex::new(synology::service::SynologyService::new()));
    app.manage(synology);
    app.manage(MeshCentralService::new());
    app.manage(MremotengService::new());
    app.manage(termserv::service::TermServService::new_state());
}
