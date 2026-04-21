use super::*;
use sorng_core::events::DynEventEmitter;

pub(crate) struct ApiHandles {
    pub(crate) agent_service: Arc<Mutex<agent::AgentService>>,
    pub(crate) aws_service: Arc<Mutex<aws::AwsService>>,
    pub(crate) cloudflare_service: Arc<Mutex<cloudflare::CloudflareService>>,
    pub(crate) commander_service: Arc<Mutex<commander::CommanderService>>,
    pub(crate) db_service: Arc<Mutex<DbService>>,
    pub(crate) ftp_service: Arc<Mutex<FtpService>>,
    pub(crate) meshcentral_service: Arc<Mutex<meshcentral::MeshCentralService>>,
    pub(crate) network_service: Arc<Mutex<NetworkService>>,
    pub(crate) qr_service: Arc<Mutex<QrService>>,
    pub(crate) rpc_service: Arc<Mutex<rpc::RpcService>>,
    pub(crate) rustdesk_service: Arc<Mutex<RustDeskService>>,
    pub(crate) security_service: Arc<Mutex<SecurityService>>,
    pub(crate) vercel_service: Arc<Mutex<vercel::VercelService>>,
    pub(crate) wmi_service: Arc<Mutex<wmi::WmiService>>,
    pub(crate) wol_service: Arc<Mutex<WolService>>,
}

pub(crate) fn register(
    app: &mut tauri::App<tauri::Wry>,
    ssh_service: Arc<Mutex<SshService>>,
    emitter: DynEventEmitter,
) -> ApiHandles {
    #[cfg(feature = "rdp")]
    {
        let rdp_service = RdpService::new();
        app.manage(rdp_service);

        let frame_store = rdp::SharedFrameStore::new();
        app.manage(frame_store);
    }

    let vnc_service = VncService::new_state();
    app.manage(vnc_service);

    // ── t3-e55: remote-display protocols ─────────────────────────
    let spice_service = spice::service::SpiceService::new_state();
    app.manage(spice_service);

    let nx_service = nx::service::NxService::new_state();
    app.manage(nx_service);

    let x2go_service: x2go::service::X2goServiceState =
        Arc::new(Mutex::new(x2go::service::X2goService::new()));
    app.manage(x2go_service);

    let xdmcp_service: xdmcp::service::XdmcpServiceState =
        Arc::new(Mutex::new(xdmcp::service::XdmcpService::new()));
    app.manage(xdmcp_service);

    let ard_service: ard::ArdServiceState = Arc::new(Mutex::new(ard::ArdService::new()));
    app.manage(ard_service);

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

    let script_service = ScriptService::new(ssh_service.clone());
    app.manage(script_service);

    let openvpn_service = OpenVPNService::new_with_emitter(emitter.clone());
    app.manage(openvpn_service.clone());

    // Dedicated `sorng-openvpn` crate service — separate from the legacy
    // `sorng_vpn::openvpn` service above. Both are registered so the new
    // `openvpn_*`-prefixed commands (t3-e47) resolve their managed state
    // independently of the legacy `*_openvpn` handlers.
    let openvpn_dedicated_service: OpenVpnDedicatedState =
        OpenVpnDedicatedService::new_with_emitter(emitter.clone());
    app.manage(openvpn_dedicated_service);

    let proxy_service = ProxyService::new_with_emitter(emitter.clone());
    app.manage(proxy_service.clone());

    let wireguard_service = WireGuardService::new_with_emitter(emitter.clone());
    app.manage(wireguard_service.clone());

    let zerotier_service = ZeroTierService::new_with_emitter(emitter.clone());
    app.manage(zerotier_service.clone());

    let tailscale_service = TailscaleService::new_with_emitter(emitter.clone());
    app.manage(tailscale_service.clone());

    let pptp_service = PPTPService::new_with_emitter(emitter.clone());
    app.manage(pptp_service.clone());

    let l2tp_service = L2TPService::new_with_emitter(emitter.clone());
    app.manage(l2tp_service.clone());

    let ikev2_service = IKEv2Service::new_with_emitter(emitter.clone());
    app.manage(ikev2_service.clone());

    let ipsec_service = IPsecService::new_with_emitter(emitter.clone());
    app.manage(ipsec_service.clone());

    let sstp_service = SSTPService::new_with_emitter(emitter.clone());
    app.manage(sstp_service.clone());

    // SoftEther — per plan §1.4 + e04 handoff. Scaffolded native Rust client
    // (TCP+TLS watermark handshake + tokio::task::spawn session loop).
    // Attach to chaining service via `set_softether_service` so the existing
    // `ChainingService::new_with_emitter` 10-arg signature stays stable.
    // Gated behind `vpn-softether` feature (off by default in 1.0).
    #[cfg(feature = "vpn-softether")]
    let softether_service = SoftEtherService::new_with_emitter(emitter.clone());
    #[cfg(feature = "vpn-softether")]
    app.manage(softether_service.clone());

    let chaining_service = ChainingService::new_with_emitter(
        proxy_service.clone(),
        openvpn_service.clone(),
        wireguard_service.clone(),
        zerotier_service.clone(),
        tailscale_service.clone(),
        pptp_service.clone(),
        l2tp_service.clone(),
        ikev2_service.clone(),
        ipsec_service.clone(),
        sstp_service.clone(),
        emitter.clone(),
    );
    // Wire SoftEther into the chain BEFORE moving chaining_service into
    // `app.manage(...)`. `chaining_service` is `Arc<Mutex<ChainingService>>`
    // so we briefly take the async lock via block_on (synchronous
    // registration path). No await occurs on the Tauri command thread — this
    // only runs once, at startup.
    #[cfg(feature = "vpn-softether")]
    {
        let cs = chaining_service.clone();
        let softether_clone = softether_service.clone();
        tauri::async_runtime::block_on(async move {
            cs.lock().await.set_softether_service(softether_clone);
        });
    }
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
