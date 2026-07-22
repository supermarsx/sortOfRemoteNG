//! Compile-time parity checks for the app's split composition crates.
//!
//! These checks make the public `app_lib` paths part of the test contract so
//! moving codegen out of the root crate cannot silently create duplicate API
//! types or bypass the operations state registrar.

use std::any::TypeId;

#[test]
fn app_api_reexports_are_the_dedicated_crate_types() {
    assert_eq!(
        TypeId::of::<app_lib::api::ApiService>(),
        TypeId::of::<sorng_app_api::api::ApiService>()
    );
    assert_eq!(
        TypeId::of::<app_lib::api::ApiState>(),
        TypeId::of::<sorng_app_api::api::ApiState>()
    );
    assert_eq!(
        TypeId::of::<app_lib::api_config::ApiRuntimeConfig>(),
        TypeId::of::<sorng_app_api::api_config::ApiRuntimeConfig>()
    );
}

#[test]
fn connectivity_startup_state_registrar_is_exported_by_its_crate() {
    let registrar: fn(
        &mut tauri::App<tauri::Wry>,
        std::sync::Arc<tokio::sync::Mutex<app_lib::ssh::SshService>>,
        sorng_core::events::DynEventEmitter,
    ) -> sorng_app_startup_connectivity::ApiHandles = sorng_app_startup_connectivity::register;
    assert_eq!(
        std::mem::size_of_val(&registrar),
        std::mem::size_of::<fn()>()
    );
    assert_eq!(
        sorng_app_startup_connectivity::MANAGED_STATE_REGISTRATIONS,
        40
    );
}

#[test]
fn remaining_startup_registrars_are_concrete_and_preserve_state_identity() {
    assert_eq!(
        TypeId::of::<app_lib::auth::AuthServiceState>(),
        TypeId::of::<sorng_app_startup_state::AuthServiceState>()
    );
    assert_eq!(
        TypeId::of::<app_lib::ssh::SshServiceState>(),
        TypeId::of::<sorng_app_startup_state::SshServiceState>()
    );
    assert_eq!(
        TypeId::of::<app_lib::api::ApiService>(),
        TypeId::of::<sorng_app_startup_state::ApiService>()
    );

    let access: fn(&mut tauri::App<tauri::Wry>) = sorng_app_startup_state::register_access;
    let security: fn(
        &mut tauri::App<tauri::Wry>,
        &std::path::Path,
        sorng_core::events::DynEventEmitter,
        sorng_app_startup_state::EventEmitterFactory,
    ) = sorng_app_startup_state::register_security_data;
    assert_eq!(std::mem::size_of_val(&access), std::mem::size_of::<fn()>());
    assert_eq!(
        std::mem::size_of_val(&security),
        std::mem::size_of::<fn()>()
    );
}

#[test]
fn moved_registrar_inventory_is_complete_and_feature_sensitive() {
    assert_eq!(sorng_app_startup_state::MAX_MANAGED_STATE_REGISTRATIONS, 84);
    assert_eq!(sorng_app_startup_state::ACCESS_REGISTRATION_ORDER.len(), 5);
    assert_eq!(
        sorng_app_startup_state::PLATFORM_REGISTRATION_ORDER.len(),
        12
    );
    assert_eq!(sorng_app_startup_state::COLLAB_REGISTRATION_ORDER.len(), 14);
    assert_eq!(sorng_app_startup_state::API_REGISTRATION_ORDER.len(), 3);

    let enabled_databases = [
        cfg!(feature = "db-mysql"),
        cfg!(feature = "db-postgres"),
        cfg!(feature = "db-mssql"),
        cfg!(feature = "db-sqlite"),
        cfg!(feature = "db-mongo"),
        cfg!(feature = "db-redis"),
    ]
    .into_iter()
    .filter(|enabled| *enabled)
    .count();
    assert_eq!(
        sorng_app_startup_state::SECURITY_DATA_REGISTRATION_ORDER.len(),
        34 + enabled_databases
    );

    let expected_prefix = 9 + usize::from(cfg!(all(feature = "opkssh", not(feature = "ops"))));
    assert_eq!(
        sorng_app_startup_state::INFRASTRUCTURE_PREFIX_REGISTRATION_ORDER.len(),
        expected_prefix
    );
}

#[test]
fn root_registry_only_orchestrates_external_registrars_in_original_order() {
    let root_lib = include_str!("../src/lib.rs");
    let root_registry = include_str!("../src/state_registry.rs");
    assert!(!root_lib.contains(".manage("));
    assert!(!root_registry.contains(".manage("));

    let ordered_calls = [
        "register_infrastructure_prefix(",
        "sorng_app_startup_connectivity::register(",
        "register_security_data(",
        "register_access(",
        "register_platform(",
        "register_collab(",
        "ops_startup_state::register(",
        "register_api_service(",
        "register_api_server_controller(",
    ];
    let mut cursor = 0;
    for call in ordered_calls {
        let relative = root_registry[cursor..]
            .find(call)
            .unwrap_or_else(|| panic!("missing startup composition call: {call}"));
        cursor += relative + call.len();
    }
}

#[test]
fn startup_state_crate_owns_all_eighty_four_manage_monomorphizations() {
    let sources = [
        include_str!("../crates/sorng-app-startup-state/src/lib.rs"),
        include_str!("../crates/sorng-app-startup-state/src/security_data.rs"),
        include_str!("../crates/sorng-app-startup-state/src/access.rs"),
        include_str!("../crates/sorng-app-startup-state/src/platform.rs"),
        include_str!("../crates/sorng-app-startup-state/src/collab.rs"),
    ];
    let registrations = sources
        .iter()
        .map(|source| source.matches("app.manage(").count())
        .sum::<usize>();
    assert_eq!(registrations, 84);
}

fn assert_source_fragments_in_order(source: &str, registrar: &str, fragments: &[&str]) {
    let mut cursor = 0;
    for fragment in fragments {
        let relative = source[cursor..].find(fragment).unwrap_or_else(|| {
            panic!("{registrar} registration order is missing fragment: {fragment}")
        });
        cursor += relative + fragment.len();
    }
}

#[test]
fn every_moved_registrar_keeps_its_internal_registration_order() {
    assert_source_fragments_in_order(
        include_str!("../crates/sorng-app-startup-state/src/lib.rs"),
        "infrastructure and API",
        &[
            "app.manage(sorng_app_shell::commands::parse_launch_args",
            "app.manage(enc_state);",
            "app.manage(UpdaterService::new",
            "app.manage(auth_service.clone());",
            "app.manage(secure_storage);",
            "app.manage(TrustStoreService::new(",
            "app.manage(ssh_service.clone());",
            "app.manage(SftpService::new());",
            "app.manage(smb_service);",
            "let state: OpksshServiceState",
            "app.manage(state);",
            "app.manage(api_service.clone());",
            "sorng_commands_core::api_capability_commands::DisabledCapsSetter(",
            "sorng_commands_core::api_server_commands::ApiServerController::new(",
        ],
    );
    assert_source_fragments_in_order(
        include_str!("../crates/sorng-app-startup-state/src/security_data.rs"),
        "security data",
        &[
            "app.manage(CertAuthService::new",
            "app.manage(CertGenService::new",
            "app.manage(legacy_crypto::new_policy_state",
            "app.manage(TwoFactorService::new",
            "let totp_service: TotpServiceState",
            "app.manage(totp_service);",
            "app.manage(BearerAuthService::new",
            "let auto_lock_service = AutoLockService::new",
            "app.manage(auto_lock_service.clone());",
            "app.manage(GpoService::new",
            "app.manage(LoginDetectionService::new",
            "app.manage(TelnetService::new",
            "app.manage(SerialService::new_with_emitter",
            "app.manage(RloginService::new",
            "app.manage(RawSocketService::new",
            "app.manage(GcpService::new",
            "app.manage(OciService::new",
            "app.manage(AzureService::new",
            "app.manage(ExchangeService::new",
            "app.manage(SmtpService::new",
            "app.manage(HetznerService::new",
            "app.manage(IbmService::new",
            "app.manage(DigitalOceanService::new",
            "app.manage(HerokuService::new",
            "app.manage(ScalewayService::new",
            "app.manage(LinodeService::new",
            "app.manage(OvhService::new",
            "app.manage(HttpService::new",
            "app.manage(ProxySessionManager::new",
            "app.manage(PasskeyService::new",
            "app.manage(Ssh3Service::new_with_emitter",
            "let backup_service =",
            "app.manage(backup_service);",
            "app.manage(BitwardenService::new_state",
            "app.manage(KeePassService::new",
            "app.manage(PassboltService::new_state",
            "app.manage(ScpService::new",
            "mysql::service::new_state",
            "app.manage(state);",
            "postgres::service::new_state",
            "app.manage(state);",
            "mssql::service::new_state",
            "app.manage(state);",
            "sqlite::service::new_state",
            "app.manage(state);",
            "mongodb::service::new_state",
            "app.manage(state);",
            "redis::service::new_state",
            "app.manage(state);",
        ],
    );
    assert_source_fragments_in_order(
        include_str!("../crates/sorng-app-startup-state/src/access.rs"),
        "access",
        &[
            "let ai_agent_service: AiAgentServiceState",
            "app.manage(ai_agent_service);",
            "let onepassword_service: OnePasswordServiceState",
            "app.manage(onepassword_service);",
            "let lastpass_service: LastPassServiceState",
            "app.manage(lastpass_service);",
            "let google_passwords_service: GooglePasswordsServiceState",
            "app.manage(google_passwords_service);",
            "let dashlane_service: DashlaneServiceState",
            "app.manage(dashlane_service);",
        ],
    );
    assert_source_fragments_in_order(
        include_str!("../crates/sorng-app-startup-state/src/platform.rs"),
        "platform",
        &[
            "let hyperv: HyperVServiceState",
            "app.manage(hyperv);",
            "let vmware: VmwareServiceState",
            "app.manage(vmware);",
            "let desktop: VmwDesktopServiceState",
            "app.manage(desktop);",
            "let proxmox: ProxmoxServiceState",
            "app.manage(proxmox);",
            "let idrac: IdracServiceState",
            "app.manage(idrac);",
            "let ilo: IloServiceState",
            "app.manage(ilo);",
            "let lenovo: LenovoServiceState",
            "app.manage(lenovo);",
            "let supermicro: SmcServiceState",
            "app.manage(supermicro);",
            "let synology: SynologyServiceState",
            "app.manage(synology);",
            "app.manage(MeshCentralService::new",
            "app.manage(MremotengService::new",
            "app.manage(termserv::service::TermServService::new_state",
        ],
    );
    assert_source_fragments_in_order(
        include_str!("../crates/sorng-app-startup-state/src/collab.rs"),
        "collaboration",
        &[
            "let whatsapp_state: WhatsAppServiceState",
            "app.manage(whatsapp_state);",
            "app.manage(telegram::service::TelegramService::new",
            "app.manage(dropbox::service::DropboxService::new",
            "app.manage(nextcloud::service::NextcloudService::new",
            "app.manage(gdrive::service::GDriveService::new",
            "let onedrive_state: OneDriveServiceState",
            "app.manage(onedrive_state);",
            "let rec_state: RecordingServiceState",
            "app.manage(rec_state);",
            "let llm_state: LlmServiceState",
            "app.manage(llm_state.clone());",
            "let ai_assist_state: AiAssistServiceState",
            "app.manage(ai_assist_state.clone());",
            "let palette: CommandPaletteServiceState",
            "app.manage(palette);",
            "let font: FontServiceState",
            "app.manage(font);",
            "let secure_clip: SecureClipServiceState",
            "app.manage(secure_clip);",
            "let theme: ThemeEngineState",
            "app.manage(theme);",
            "let extensions: ExtensionsServiceState",
            "app.manage(extensions);",
        ],
    );
}

#[cfg(feature = "ops")]
#[test]
fn ops_startup_state_registrar_is_exported_by_the_domain_crate() {
    let registrar: fn(&mut tauri::App<tauri::Wry>, &std::path::Path) =
        sorng_app_domains::ops_startup_state::register;
    assert_eq!(
        std::mem::size_of_val(&registrar),
        std::mem::size_of::<fn()>()
    );
}
