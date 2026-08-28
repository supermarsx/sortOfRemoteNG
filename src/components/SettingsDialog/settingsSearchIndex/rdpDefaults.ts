import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `rdpDefaults` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 *
 * `values` carries **both halves** of every `{ value, label }` option pair so a
 * user can search either the wire value (`remotefx`, `h264`, `wgpu`) or the
 * label they can actually see (`RemoteFX`, `H.264 hardware decode`, `Wgpu
 * (GPU)`). The drift guard checks this for every *literal* `options` array; the
 * imported/derived option lists (`RESOLUTION_PRESETS`, `BUFFER_OPTIONS`,
 * `CLIPBOARD_DIRECTION_OPTIONS`, `PRINTER_OUTPUT_MODE_OPTIONS`) are exempt from
 * the guard but are indexed here anyway.
 *
 * Labels in this tab are hardcoded English — none of the RDP sections call
 * `t()` — so no entry carries a `labelKey`.
 */
export const RDP_DEFAULTS_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Session Management ─────────────────────────────────────────
  {
    key: "rdpSessionDisplayMode",
    label: "Session panel display mode",
    description:
      "Show the RDP session manager as a floating popup or a docked side panel.",
    tags: ["session", "panel", "popup", "sidebar", "display", "manager"],
    synonyms: ["session manager", "modal overlay", "right sidebar"],
    values: [
      "popup",
      "Popup (modal overlay)",
      "panel",
      "Panel (right sidebar)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpSessionClosePolicy",
    label: "Tab close policy",
    description:
      "What happens when an RDP tab is closed — ask, detach and keep the session alive, or fully disconnect.",
    tags: ["close", "tab", "detach", "disconnect", "policy", "session"],
    synonyms: ["keep session running", "reattach", "leave running"],
    values: [
      "ask",
      "Ask every time",
      "detach",
      "Keep session running (detach)",
      "disconnect",
      "Fully disconnect",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpSessionThumbnailsEnabled",
    label: "Show session thumbnails",
    description:
      "Display live preview thumbnails of active RDP sessions in the session manager.",
    tags: ["thumbnail", "preview", "session", "live", "screenshot"],
    synonyms: ["session preview", "live preview"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpSessionThumbnailPolicy",
    label: "Thumbnail capture policy",
    description:
      "When session thumbnails are captured — continuously, on tab blur, on detach, or manually.",
    tags: ["thumbnail", "capture", "policy", "blur", "detach", "manual"],
    values: [
      "realtime",
      "Realtime (periodic refresh)",
      "on-blur",
      "On blur (when tab loses focus)",
      "on-detach",
      "On detach (when viewer is detached)",
      "manual",
      "Manual only",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpSessionThumbnailInterval",
    label: "Thumbnail refresh interval",
    description:
      "How often session thumbnails are refreshed when using the realtime capture policy.",
    tags: ["thumbnail", "refresh", "interval", "seconds", "realtime"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Security Defaults ──────────────────────────────────────────
  {
    key: "useCredSsp",
    label: "Use CredSSP",
    description:
      "Master switch for the Credential Security Support Provider — when off, CredSSP is skipped entirely for new connections.",
    tags: ["credssp", "security", "credentials", "delegation", "auth"],
    synonyms: ["credential security support provider", "cred ssp"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "enableTls",
    label: "Enable TLS",
    description:
      "Encrypt the RDP transport with TLS to protect data in transit.",
    tags: ["tls", "ssl", "encryption", "transport", "security"],
    synonyms: ["transport layer security"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "enableNla",
    label: "Enable NLA (Network Level Authentication)",
    description:
      "Require authentication before opening the full RDP session, reducing exposure to denial-of-service attacks.",
    tags: ["nla", "authentication", "network level", "security", "preauth"],
    synonyms: ["network level authentication"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "autoLogon",
    label: "Auto logon",
    description:
      "Send stored credentials in the connection INFO packet to bypass the remote login screen.",
    tags: ["auto", "logon", "login", "credentials", "sso", "bypass"],
    synonyms: ["autologin", "auto login", "single sign on"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Display Defaults ───────────────────────────────────────────
  {
    key: "defaultResolution",
    label: "Default resolution",
    description:
      "The screen resolution used when opening a new RDP connection.",
    tags: ["resolution", "screen", "size", "display", "preset"],
    synonyms: ["screen size", "hd", "full hd", "qhd", "uhd", "4k", "5k"],
    values: [
      "1280x720",
      "1280 × 720 (HD)",
      "1366x768",
      "1366 × 768 (HD+)",
      "1600x900",
      "1600 × 900 (HD+)",
      "1920x1080",
      "1920 × 1080 (Full HD)",
      "2560x1440",
      "2560 × 1440 (QHD)",
      "3440x1440",
      "3440 × 1440 (Ultrawide)",
      "3840x2160",
      "3840 × 2160 (4K UHD)",
      "5120x2880",
      "5120 × 2880 (5K)",
      "custom",
      "Custom…",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "defaultWidth",
    label: "Width",
    description:
      "Custom horizontal resolution in pixels for the remote desktop. Defaults to 1920.",
    tags: ["width", "horizontal", "pixels", "resolution", "custom"],
    synonyms: ["1280", "1366", "1600", "1920", "2560", "3440", "3840", "5120"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "defaultHeight",
    label: "Height",
    description:
      "Custom vertical resolution in pixels for the remote desktop. Defaults to 1080.",
    tags: ["height", "vertical", "pixels", "resolution", "custom"],
    synonyms: ["720", "768", "900", "1080", "1440", "2160", "2880"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "defaultColorDepth",
    label: "Default color depth",
    description:
      "Bits used per pixel for color rendering. Higher values produce better color fidelity.",
    tags: ["color", "depth", "bits", "bpp", "truecolor", "display"],
    synonyms: ["colour depth", "bit depth", "16 bit", "24 bit", "32 bit"],
    values: [
      "16",
      "16-bit (High Color)",
      "24",
      "24-bit (True Color)",
      "32",
      "32-bit (True Color + Alpha)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "scalingMode",
    label: "Scaling mode",
    description:
      "How the remote desktop fits the local window — smart sizing scales a fixed resolution, resize to window changes the remote resolution.",
    tags: ["scaling", "smart sizing", "resize", "fit", "zoom", "scrollbars"],
    synonyms: ["smart size", "scale to fit", "dynamic resolution"],
    values: [
      "smart",
      "Smart Sizing (scale to fit)",
      "resize",
      "Resize to Window (dynamic resolution)",
      "none",
      "None (scrollbars if needed)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "lossyCompression",
    label: "Lossy compression",
    description:
      "Trade minor visual fidelity for lower bandwidth using lossy image compression.",
    tags: ["lossy", "compression", "bandwidth", "quality", "image"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Audio Defaults ─────────────────────────────────────────────
  {
    key: "audioPlaybackMode",
    label: "Audio playback",
    description:
      "Where remote session audio is played back — locally, on the remote machine, or not at all.",
    tags: ["audio", "sound", "playback", "speaker", "redirect"],
    synonyms: ["play on remote computer", "play on this computer", "mute"],
    values: [
      "local",
      "Play on this computer",
      "remote",
      "Play on remote computer",
      "disabled",
      "Do not play",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "audioRecordingMode",
    label: "Audio recording",
    description:
      "Redirect audio input from your local microphone to the remote session.",
    tags: ["audio", "recording", "microphone", "input", "capture"],
    synonyms: ["mic", "record audio"],
    values: ["disabled", "Disabled", "enabled", "Record from this computer"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "audioQuality",
    label: "Audio quality",
    description:
      "Audio codec quality level. Dynamic mode auto-adjusts based on available bandwidth.",
    tags: ["audio", "quality", "codec", "bitrate", "bandwidth"],
    values: [
      "dynamic",
      "Dynamic (auto-adjust)",
      "medium",
      "Medium",
      "high",
      "High",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Input Defaults ─────────────────────────────────────────────
  {
    key: "mouseMode",
    label: "Mouse mode",
    description:
      "Absolute mode sends exact cursor coordinates; relative mode sends movement deltas, useful for some remote applications.",
    tags: ["mouse", "cursor", "pointer", "absolute", "relative", "input"],
    values: [
      "absolute",
      "Absolute (real mouse position)",
      "relative",
      "Relative (virtual mouse delta)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "autoDetectKeyboardLayout",
    label: "Auto-detect keyboard layout on connect",
    description:
      "Apply the local keyboard layout when establishing a new session.",
    tags: ["keyboard", "layout", "locale", "auto", "detect", "input"],
    synonyms: ["kbd layout", "keymap"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "enableUnicodeInput",
    label: "Enable Unicode keyboard input",
    description:
      "Send keystrokes as Unicode for non-Latin scripts and special characters.",
    tags: ["unicode", "keyboard", "input", "scripts", "characters", "utf"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Local Resource / Device Redirection Defaults ───────────────
  {
    key: "rdpDefaults.clipboardRedirection",
    label: "Clipboard",
    description: "Share clipboard between local and remote for copy/paste.",
    tags: ["clipboard", "copy", "paste", "redirection", "share"],
    synonyms: ["copy paste", "cut and paste"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.printerRedirection",
    label: "Printers",
    description: "Redirect local printers to the remote session.",
    tags: ["printer", "printing", "redirection", "spool"],
    synonyms: ["print", "printers"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.portRedirection",
    label: "Serial / COM ports",
    description: "Redirect serial/COM ports for hardware devices.",
    tags: ["serial", "com port", "port", "redirection", "hardware", "rs232"],
    synonyms: ["com", "serial port", "rs-232"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.smartCardRedirection",
    label: "Smart cards",
    description: "Redirect smart card readers for authentication.",
    tags: ["smart card", "smartcard", "reader", "redirection", "auth", "piv"],
    synonyms: ["smartcard", "cac", "piv card", "chip card"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.webAuthnRedirection",
    label: "WebAuthn / FIDO",
    description: "Redirect security keys for passwordless auth.",
    tags: ["webauthn", "fido", "security key", "passwordless", "redirection"],
    synonyms: ["fido2", "yubikey", "u2f", "passkey"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.videoCaptureRedirection",
    label: "Video capture",
    description: "Redirect local cameras to the remote session.",
    tags: ["video", "camera", "webcam", "capture", "redirection"],
    synonyms: ["webcam", "camera"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.audioInputRedirection",
    label: "Audio input",
    description: "Redirect microphone to the remote session.",
    tags: ["audio", "microphone", "input", "redirection", "mic"],
    synonyms: ["mic"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.usbRedirection",
    label: "USB devices",
    description: "Redirect USB devices for direct hardware access.",
    tags: ["usb", "device", "redirection", "hardware", "passthrough"],
    synonyms: ["usb passthrough"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.driveRedirection",
    label: "Drive redirection",
    description:
      "Share local drives and folders as mapped network drives in the remote session.",
    tags: ["drive", "disk", "folder", "redirection", "mapping", "share"],
    synonyms: ["drive mapping", "mapped drive", "folder sharing"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.clipboardDirection",
    label: "Clipboard direction",
    description:
      "Default clipboard flow policy for RDP sessions — bidirectional or one-way.",
    tags: ["clipboard", "direction", "policy", "one way", "copy", "paste"],
    synonyms: ["clipboard policy", "local to remote", "remote to local"],
    values: [
      "bidirectional",
      "Bidirectional",
      "client-to-server",
      "Local to remote only",
      "server-to-client",
      "Remote to local only",
      "disabled",
      "Disabled",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "rdpDefaults.printerOutputMode",
    label: "Printer output mode",
    description:
      "Default delivery mode for redirected print jobs — save the spool file locally or send it to an OS printer.",
    tags: ["printer", "output", "spool", "native print", "print job"],
    synonyms: ["spool file", "native printing"],
    values: [
      "spool-file",
      "Save spool file locally",
      "native-print",
      "Send to OS printer (spool fallback)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── RDP Gateway Defaults ───────────────────────────────────────
  {
    key: "gatewayEnabled",
    label: "Enable RDP Gateway by default",
    description:
      "Route connections through an RD Gateway server for access to machines behind firewalls.",
    tags: ["gateway", "rd gateway", "firewall", "tunnel", "proxy"],
    synonyms: ["rdg", "ts gateway", "remote desktop gateway"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "gatewayHostname",
    label: "Default gateway hostname",
    description:
      "Fully qualified domain name or IP address of the RD Gateway server.",
    tags: ["gateway", "hostname", "host", "fqdn", "address", "server"],
    synonyms: ["gateway host", "gateway address", "gateway server"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "gatewayPort",
    label: "Default gateway port",
    description:
      "TCP port used to connect to the RD Gateway server. Default is 443 (HTTPS).",
    tags: ["gateway", "port", "tcp", "https", "443"],
    synonyms: ["gateway port", "443"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "gatewayAuthMethod",
    label: "Authentication method",
    description:
      "Authentication protocol used when connecting to the RD Gateway server.",
    tags: ["gateway", "auth", "authentication", "ntlm", "kerberos", "digest"],
    synonyms: ["gateway auth", "kerberos", "smart card"],
    values: [
      "ntlm",
      "NTLM",
      "basic",
      "Basic",
      "digest",
      "Digest",
      "negotiate",
      "Negotiate (Kerberos/NTLM)",
      "smartcard",
      "Smart Card",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "gatewayTransportMode",
    label: "Transport mode",
    description:
      "Network transport used for gateway communication. Auto selects the best available option.",
    tags: ["gateway", "transport", "http", "udp", "auto", "network"],
    values: ["auto", "Auto", "http", "HTTP", "udp", "UDP"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "gatewayBypassLocal",
    label: "Bypass gateway for local addresses",
    description:
      "Skip the gateway when reaching machines on the local network.",
    tags: ["gateway", "bypass", "local", "lan", "direct"],
    synonyms: ["bypass local", "no proxy for local"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Hyper-V Defaults ───────────────────────────────────────────
  {
    key: "enhancedSessionMode",
    label: "Use Enhanced Session Mode by default",
    description:
      "Enable clipboard, drive redirection, and improved audio in Hyper-V virtual machines.",
    tags: ["hyper-v", "hyperv", "enhanced session", "vm", "vmconnect"],
    synonyms: ["hyperv", "enhanced session mode", "virtual machine"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Connection Negotiation Defaults ────────────────────────────
  {
    key: "autoDetect",
    label: "Enable auto-detect negotiation by default",
    description:
      "Try different protocol combinations until a working one is found.",
    tags: ["auto detect", "negotiation", "protocol", "fallback", "connect"],
    synonyms: ["autodetect", "protocol detection"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "negotiationStrategy",
    label: "Default strategy",
    description:
      "Order in which security protocols are attempted when negotiating a connection.",
    tags: ["negotiation", "strategy", "nla", "tls", "credssp", "plain"],
    synonyms: ["nla first", "tls first", "protocol order"],
    values: [
      "auto",
      "Auto (try all combinations)",
      "nla-first",
      "NLA First (CredSSP → TLS → Plain)",
      "tls-first",
      "TLS First (TLS → CredSSP → Plain)",
      "nla-only",
      "NLA Only",
      "tls-only",
      "TLS Only",
      "plain-only",
      "Plain Only (DANGEROUS)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "maxRetries",
    label: "Max retries",
    description:
      "Maximum number of connection attempts before giving up on a failed negotiation.",
    tags: ["retry", "retries", "attempts", "max", "reconnect"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "retryDelayMs",
    label: "Retry delay",
    description:
      "Wait time in milliseconds between consecutive connection retry attempts.",
    tags: ["retry", "delay", "backoff", "milliseconds", "wait"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── TCP / Socket Defaults ──────────────────────────────────────
  {
    key: "tcpConnectTimeoutSecs",
    label: "Connect timeout",
    description:
      "Maximum time in seconds to wait for a TCP connection to be established before timing out.",
    tags: ["tcp", "timeout", "connect", "seconds", "socket"],
    synonyms: ["connection timeout"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "tcpNodelay",
    label: "TCP_NODELAY (disable Nagle's algorithm)",
    description:
      "Send packets immediately to reduce latency for interactive sessions.",
    tags: ["tcp", "nodelay", "nagle", "latency", "socket", "interactive"],
    synonyms: ["tcp nodelay", "nagle algorithm"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "tcpKeepAlive",
    label: "TCP keep-alive",
    description:
      "Send periodic keep-alive probes to detect stale connections before they're dropped, and how often to send them.",
    tags: ["tcp", "keep-alive", "keepalive", "probe", "interval", "stale"],
    synonyms: ["keep alive", "keepalive interval", "so_keepalive", "probes"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "tcpRecvBufferSize",
    label: "Receive buffer",
    description:
      "Size of the TCP receive buffer. Larger buffers improve throughput on high-latency networks.",
    tags: ["tcp", "buffer", "receive", "socket", "throughput", "so_rcvbuf"],
    synonyms: ["recv buffer", "so_rcvbuf"],
    values: [
      "65536",
      "64 KB",
      "131072",
      "128 KB",
      "262144",
      "256 KB (default)",
      "524288",
      "512 KB",
      "1048576",
      "1 MB",
      "2097152",
      "2 MB",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "tcpSendBufferSize",
    label: "Send buffer",
    description:
      "Size of the TCP send buffer. Larger buffers can improve throughput for outbound data.",
    tags: ["tcp", "buffer", "send", "socket", "throughput", "so_sndbuf"],
    synonyms: ["send buffer", "so_sndbuf"],
    values: [
      "65536",
      "64 KB",
      "131072",
      "128 KB",
      "262144",
      "256 KB (default)",
      "524288",
      "512 KB",
      "1048576",
      "1 MB",
      "2097152",
      "2 MB",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Render Backend Defaults ────────────────────────────────────
  {
    key: "renderBackend",
    label: "Default render backend",
    description:
      "How decoded RDP frames are rendered. Native backends bypass JavaScript by blitting straight to a Win32 child window.",
    tags: ["render", "backend", "wgpu", "softbuffer", "webview", "gpu", "cpu"],
    synonyms: ["renderer", "dx12", "vulkan", "native window"],
    values: [
      "webview",
      "Webview (JS Canvas) — most compatible",
      "softbuffer",
      "Softbuffer (CPU) — native Win32, zero JS overhead",
      "wgpu",
      "Wgpu (GPU) — DX12/Vulkan, best at high res",
      "auto",
      "Auto — try GPU → CPU → Webview",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "frontendRenderer",
    label: "Default frontend renderer",
    description:
      "How RGBA frames or H.264 NAL units are painted onto the browser canvas.",
    tags: [
      "frontend",
      "renderer",
      "canvas",
      "webgl",
      "webgpu",
      "webcodecs",
      "worker",
    ],
    synonyms: [
      "canvas 2d",
      "offscreen canvas",
      "h264 decode",
      "hardware decode",
    ],
    values: [
      "auto",
      "Auto — best available (WebCodecs GPU → WebGL → Canvas 2D)",
      "canvas2d",
      "Canvas 2D — putImageData (baseline)",
      "webgl",
      "WebGL — texSubImage2D (GPU texture upload)",
      "webgpu",
      "WebGPU — writeTexture (modern GPU API)",
      "offscreen-worker",
      "OffscreenCanvas Worker — off-main-thread rendering",
      "webcodecs-worker",
      "WebCodecs Worker (GPU) — H.264 hardware decode",
      "webcodecs-cpu",
      "WebCodecs Worker (CPU) — H.264 software decode",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "frameScheduling",
    label: "Default frame scheduling",
    description:
      "Frame presentation timing. VSync aligns with display refresh; low-latency minimizes delay.",
    tags: ["frame", "scheduling", "vsync", "latency", "adaptive", "timing"],
    synonyms: ["v-sync", "low latency", "refresh rate"],
    values: [
      "vsync",
      "VSync (~16ms, synced to display refresh)",
      "low-latency",
      "Low-Latency (~1ms, unbound from vsync)",
      "adaptive",
      "Adaptive — start vsync, escalate under pressure",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "tripleBuffering",
    label: "Triple buffering (WebGL)",
    description:
      "Ping-pong textures avoid GPU stalls during WebGL rendering, improving frame smoothness.",
    tags: ["triple buffering", "webgl", "gpu", "texture", "stall", "render"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Performance / Frame Delivery Defaults ──────────────────────
  {
    key: "connectionSpeed",
    label: "Connection speed preset",
    description:
      "Predefined set of visual and frame delivery settings optimized for your network speed.",
    tags: ["speed", "preset", "bandwidth", "modem", "broadband", "wan", "lan"],
    synonyms: ["network speed", "experience level", "connection quality"],
    values: [
      "modem",
      "Modem (56 Kbps)",
      "broadband-low",
      "Broadband (Low)",
      "broadband-high",
      "Broadband (High)",
      "wan",
      "WAN",
      "lan",
      "LAN (10 Mbps+)",
      "auto-detect",
      "Auto-detect",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "disableWallpaper",
    label: "Disable wallpaper",
    description:
      "Prevents the desktop wallpaper from being rendered, reducing bandwidth usage.",
    tags: ["wallpaper", "desktop", "background", "bandwidth", "visual"],
    synonyms: ["desktop background"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "disableFullWindowDrag",
    label: "Disable full-window drag",
    description:
      "Shows only a window outline while dragging instead of rendering full window contents.",
    tags: ["window", "drag", "outline", "visual", "bandwidth"],
    synonyms: ["full window drag", "show window contents while dragging"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "disableMenuAnimations",
    label: "Disable menu animations",
    description:
      "Turns off menu fade and slide animations to improve responsiveness.",
    tags: ["menu", "animation", "fade", "visual", "responsiveness"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "disableTheming",
    label: "Disable visual themes",
    description:
      "Disables Windows visual themes on the remote desktop to save bandwidth.",
    tags: ["theme", "theming", "visual styles", "bandwidth", "windows"],
    synonyms: ["visual styles"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "disableCursorShadow",
    label: "Disable cursor shadow",
    description:
      "Removes the shadow effect beneath the mouse cursor in the remote session.",
    tags: ["cursor", "shadow", "mouse", "pointer", "visual"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "disableCursorSettings",
    label: "Disable cursor settings",
    description:
      "Disables custom cursor rendering settings on the remote machine.",
    tags: ["cursor", "settings", "mouse", "pointer", "blinking"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "enableFontSmoothing",
    label: "Enable font smoothing (ClearType)",
    description:
      "Enables ClearType font smoothing for clearer text on the remote desktop.",
    tags: ["font", "smoothing", "cleartype", "antialiasing", "text"],
    synonyms: ["clear type", "anti aliasing", "subpixel"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "enableDesktopComposition",
    label: "Enable desktop composition (Aero)",
    description:
      "Enables Aero glass and transparency effects on the remote desktop. Uses more bandwidth.",
    tags: ["desktop composition", "aero", "glass", "transparency", "dwm"],
    synonyms: ["aero glass", "dwm"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "persistentBitmapCaching",
    label: "Persistent bitmap caching",
    description:
      "Caches frequently used bitmaps to disk, reducing bandwidth on reconnection to the same server.",
    tags: ["bitmap", "cache", "caching", "persistent", "disk", "bandwidth"],
    synonyms: ["bitmap cache"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "targetFps",
    label: "Target FPS",
    description:
      "Maximum frames per second the remote session will deliver. Set to 0 for unlimited.",
    tags: ["fps", "frames", "framerate", "target", "performance"],
    synonyms: ["frames per second", "frame rate", "60 fps", "30 fps"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "frameBatching",
    label: "Frame batching",
    description:
      "Accumulates changed screen regions and sends them in batches to reduce IPC overhead.",
    tags: ["frame", "batching", "batch", "dirty region", "ipc", "latency"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "frameBatchIntervalMs",
    label: "Batch interval",
    description:
      "Time between batch flushes. Lower values mean smoother updates but higher CPU usage.",
    tags: ["batch", "interval", "milliseconds", "frame", "flush", "cpu"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "fullFrameSyncInterval",
    label: "Full-frame sync interval",
    description:
      "How often a complete framebuffer is resent to correct any accumulated rendering drift.",
    tags: ["full frame", "sync", "interval", "framebuffer", "drift", "resend"],
    synonyms: ["keyframe", "full refresh"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "readTimeoutMs",
    label: "PDU read timeout",
    description:
      "How long to wait for incoming protocol data units before yielding. Lower values are more responsive but use more CPU.",
    tags: ["pdu", "read", "timeout", "poll", "milliseconds", "cpu"],
    synonyms: ["protocol data unit", "poll rate"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },

  // ─── Bitmap Codec Negotiation Defaults ──────────────────────────
  {
    key: "codecsEnabled",
    label: "Enable Bitmap Codec Negotiation",
    description:
      "Advertise advanced codecs to the server; when off, only raw/RLE bitmaps are used.",
    tags: ["codec", "bitmap", "negotiation", "compression", "rle", "raw"],
    synonyms: ["codecs", "bitmap compression"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "remoteFxEnabled",
    label: "RemoteFX (RFX)",
    description:
      "DWT + RLGR entropy coding — the best quality/compression balance for the RemoteFX codec.",
    tags: ["remotefx", "rfx", "codec", "dwt", "rlgr", "compression"],
    synonyms: ["remote fx", "rfx codec"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "remoteFxEntropy",
    label: "Entropy Algorithm",
    description:
      "RLGR1 offers faster decoding; RLGR3 provides better compression at a slight CPU cost.",
    tags: ["entropy", "rlgr", "remotefx", "codec", "compression", "decoding"],
    synonyms: ["rlgr1", "rlgr3", "entropy coding"],
    values: [
      "rlgr1",
      "RLGR1 (faster decoding)",
      "rlgr3",
      "RLGR3 (better compression)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "gfxEnabled",
    label: "RDPGFX (H.264 Hardware Decode)",
    description:
      "Enables the RDPGFX pipeline for H.264-based screen encoding with GPU hardware acceleration.",
    tags: ["rdpgfx", "gfx", "h.264", "avc", "gpu", "hardware", "egfx"],
    synonyms: ["egfx", "graphics pipeline", "avc444"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "h264Decoder",
    label: "H.264 Decoder",
    description:
      "Backend H.264 decoder. Media Foundation uses GPU hardware; openh264 is a software fallback.",
    tags: ["h.264", "decoder", "media foundation", "openh264", "gpu", "avc"],
    synonyms: ["avc", "hardware decoder", "software decoder"],
    values: [
      "auto",
      "Auto (MF hardware → openh264 fallback)",
      "media-foundation",
      "Media Foundation (GPU hardware)",
      "openh264",
      "openh264 (software)",
    ],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
  {
    key: "nalPassthrough",
    label: "NAL Passthrough (WebCodecs Decode)",
    description:
      "Skip backend H.264 decode; send raw NAL units to the frontend for WebCodecs-based decoding.",
    tags: ["nal", "passthrough", "webcodecs", "h.264", "decode", "frontend"],
    synonyms: ["nal units", "webcodecs decode"],
    section: "rdpDefaults",
    sectionLabel: "RDP Defaults",
  },
];
