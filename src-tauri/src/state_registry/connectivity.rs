use super::*;

pub(crate) struct ApiHandles {
    pub(crate) agent_service: agent::AgentService,
    pub(crate) aws_service: aws::AwsService,
    pub(crate) cloudflare_service: cloudflare::CloudflareService,
    pub(crate) commander_service: commander::CommanderService,
    pub(crate) db_service: DbService,
    pub(crate) ftp_service: FtpService,
    pub(crate) meshcentral_service: meshcentral::MeshCentralService,
    pub(crate) network_service: NetworkService,
    pub(crate) qr_service: QrService,
    pub(crate) rpc_service: rpc::RpcService,
    pub(crate) rustdesk_service: RustDeskService,
    pub(crate) security_service: SecurityService,
    pub(crate) vercel_service: vercel::VercelService,
    pub(crate) wmi_service: wmi::WmiService,
    pub(crate) wol_service: WolService,
}

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>, ssh_service: SshService) -> ApiHandles {
    #[cfg(feature = "rdp")]
    {
        let rdp_service = RdpService::new();
        app.manage(rdp_service);

        let frame_store = rdp::SharedFrameStore::new();
        app.manage(frame_store);
    }

    let vnc_service = VncService::new_state();
    app.manage(vnc_service);

    let anydesk_service = AnyDeskService::new();
    app.manage(anydesk_service);

    let db_service = DbService::new();
    app.manage(db_service.clone());

    let ftp_service = FtpService::new();
    app.manage(ftp_service.clone());

    let network_service = NetworkService::new();
    app.manage(network_service.clone());

    let security_service = SecurityService::new();
    app.manage(security_service.clone());

    let wol_service = WolService::new();
    app.manage(wol_service.clone());

    let script_service = ScriptService::new(ssh_service);
    app.manage(script_service);

    let openvpn_service = OpenVPNService::new();
    app.manage(openvpn_service.clone());

    let proxy_service = ProxyService::new();
    app.manage(proxy_service.clone());

    let wireguard_service = WireGuardService::new();
    app.manage(wireguard_service.clone());

    let zerotier_service = ZeroTierService::new();
    app.manage(zerotier_service.clone());

    let tailscale_service = TailscaleService::new();
    app.manage(tailscale_service.clone());

    let chaining_service = ChainingService::new(
        proxy_service.clone(),
        openvpn_service.clone(),
        wireguard_service.clone(),
        zerotier_service.clone(),
        tailscale_service.clone(),
    );
    app.manage(chaining_service);

    let qr_service = QrService::new();
    app.manage(qr_service.clone());

    let rustdesk_service = RustDeskService::new();
    app.manage(rustdesk_service.clone());

    let wmi_service = wmi::WmiService::new();
    app.manage(wmi_service.clone());

    let rpc_service = rpc::RpcService::new();
    app.manage(rpc_service.clone());

    let meshcentral_service = meshcentral::MeshCentralService::new();
    app.manage(meshcentral_service.clone());

    let agent_service = agent::AgentService::new();
    app.manage(agent_service.clone());

    let commander_service = commander::CommanderService::new();
    app.manage(commander_service.clone());

    let aws_service = aws::AwsService::new();
    app.manage(aws_service.clone());

    let vercel_service = vercel::VercelService::new();
    app.manage(vercel_service.clone());

    let cloudflare_service = cloudflare::CloudflareService::new();
    app.manage(cloudflare_service.clone());

    ApiHandles {
        agent_service,
        aws_service,
        cloudflare_service,
        commander_service,
        db_service,
        ftp_service,
        meshcentral_service,
        network_service,
        qr_service,
        rpc_service,
        rustdesk_service,
        security_service,
        vercel_service,
        wmi_service,
        wol_service,
    }
}
