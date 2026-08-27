use super::*;

/// Bridges [`sorng_core::events::AppEventEmitter`] to this app handle.
///
/// `register_platform` is called with only the `App`, so — unlike the
/// registrars that are handed an [`EventEmitterFactory`] — this module builds
/// its own emitter. It is the same three-line adapter the root crate uses for
/// the connectivity services.
struct PlatformEventEmitter(tauri::AppHandle);

impl sorng_core::events::AppEventEmitter for PlatformEventEmitter {
    fn emit_event(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        use tauri::Emitter;
        self.0
            .emit(event, payload)
            .map_err(|error| error.to_string())
    }
}

fn platform_emitter(app: &tauri::App<tauri::Wry>) -> DynEventEmitter {
    Arc::new(PlatformEventEmitter(app.handle().clone()))
}

pub(super) fn register(app: &mut tauri::App<tauri::Wry>) {
    let hyperv: HyperVServiceState = Arc::new(Mutex::new(hyperv::service::HyperVService::new()));
    app.manage(hyperv);
    let vmware: VmwareServiceState = Arc::new(Mutex::new(vmware::service::VmwareService::new()));
    app.manage(vmware);
    let desktop: VmwDesktopServiceState =
        Arc::new(Mutex::new(vmware_desktop::service::VmwDesktopService::new()));
    app.manage(desktop);
    // t67-e5: the xterm.js console relay streams `proxmox-console-*` events,
    // so this service is built with an emitter (mirrors serial/ssh3).
    let proxmox: ProxmoxServiceState = Arc::new(Mutex::new(
        proxmox::service::ProxmoxService::new_with_emitter(platform_emitter(app)),
    ));
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
    let voip_phone: VoipPhoneServiceState =
        Arc::new(Mutex::new(voip_phone::service::VoipPhoneService::new()));
    app.manage(voip_phone);
}
