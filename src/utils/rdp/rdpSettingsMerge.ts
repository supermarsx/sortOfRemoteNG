import { DEFAULT_RDP_SETTINGS, RDPConnectionSettings } from '../../types/connection/connection';

type FrontendRendererType = NonNullable<RDPConnectionSettings['performance']>['frontendRenderer'];

/** Remove keys whose value is undefined so they don't overwrite resolved values via spread. */
function defined<T extends Record<string, unknown>>(obj: T | undefined): Partial<T> {
  if (!obj) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result as Partial<T>;
}

/**
 * Merge compile-time defaults, global defaults, and per-connection overrides
 * into a single RDPConnectionSettings object.
 *
 * Priority: per-connection (highest) → global defaults → compile-time defaults (lowest).
 * Per-connection fields set to `undefined` (inherit) fall through to global defaults.
 */
export function mergeRdpSettings(
  connSettings: RDPConnectionSettings | undefined,
  globalDefaults: Record<string, any>,
): RDPConnectionSettings {
  const base = DEFAULT_RDP_SETTINGS;
  const conn = connSettings;
  const g = globalDefaults;

  // Build merged codec settings
  const mergedCodecs = {
    ...base.performance?.codecs,
    enableCodecs: g.codecsEnabled ?? base.performance?.codecs?.enableCodecs,
    remoteFx: g.remoteFxEnabled ?? base.performance?.codecs?.remoteFx,
    remoteFxEntropy: g.remoteFxEntropy ?? base.performance?.codecs?.remoteFxEntropy,
    enableGfx: g.gfxEnabled ?? base.performance?.codecs?.enableGfx,
    h264Decoder: g.h264Decoder ?? base.performance?.codecs?.h264Decoder,
    nalPassthrough: g.nalPassthrough ?? base.performance?.codecs?.nalPassthrough,
    ...defined(conn?.performance?.codecs),
  };

  return {
    display: {
      ...base.display,
      width: g.defaultWidth ?? base.display?.width,
      height: g.defaultHeight ?? base.display?.height,
      colorDepth: g.defaultColorDepth ?? base.display?.colorDepth,
      smartSizing: g.smartSizing ?? base.display?.smartSizing,
      resizeToWindow: g.resizeToWindow ?? base.display?.resizeToWindow,
      desktopScaleFactor: g.desktopScaleFactor ?? base.display?.desktopScaleFactor,
      lossyCompression: g.lossyCompression ?? base.display?.lossyCompression,
      ...defined(conn?.display),
    },
    audio: {
      ...base.audio,
      playbackMode: g.audioPlaybackMode ?? base.audio?.playbackMode,
      recordingMode: g.audioRecordingMode ?? base.audio?.recordingMode,
      audioQuality: g.audioQuality ?? base.audio?.audioQuality,
      ...defined(conn?.audio),
    },
    input: {
      ...base.input,
      mouseMode: g.mouseMode ?? base.input?.mouseMode,
      enableUnicodeInput: g.enableUnicodeInput ?? base.input?.enableUnicodeInput,
      autoDetectLayout: g.autoDetectKeyboardLayout ?? base.input?.autoDetectLayout,
      scrollSpeed: g.scrollSpeed ?? base.input?.scrollSpeed,
      smoothScroll: g.smoothScroll ?? base.input?.smoothScroll,
      localCursor: g.localCursor ?? base.input?.localCursor,
      inputPriority: g.inputPriority ?? base.input?.inputPriority,
      batchIntervalMs: g.batchIntervalMs ?? base.input?.batchIntervalMs,
      keyboardLayout: g.keyboardLayout ?? base.input?.keyboardLayout,
      keyboardType: g.keyboardType ?? base.input?.keyboardType,
      keyboardFunctionKeys: g.keyboardFunctionKeys ?? base.input?.keyboardFunctionKeys,
      ...defined(conn?.input),
    },
    deviceRedirection: {
      ...base.deviceRedirection,
      clipboard: g.clipboardRedirection ?? base.deviceRedirection?.clipboard,
      printers: g.printerRedirection ?? base.deviceRedirection?.printers,
      ports: g.portRedirection ?? base.deviceRedirection?.ports,
      smartCards: g.smartCardRedirection ?? base.deviceRedirection?.smartCards,
      webAuthn: g.webAuthnRedirection ?? base.deviceRedirection?.webAuthn,
      videoCapture: g.videoCaptureRedirection ?? base.deviceRedirection?.videoCapture,
      usbDevices: g.usbRedirection ?? base.deviceRedirection?.usbDevices,
      audioInput: g.audioInputRedirection ?? base.deviceRedirection?.audioInput,
      ...defined(conn?.deviceRedirection),
    },
    performance: {
      ...base.performance,
      connectionSpeed: g.connectionSpeed ?? base.performance?.connectionSpeed,
      disableWallpaper: g.disableWallpaper ?? base.performance?.disableWallpaper,
      disableFullWindowDrag: g.disableFullWindowDrag ?? base.performance?.disableFullWindowDrag,
      disableMenuAnimations: g.disableMenuAnimations ?? base.performance?.disableMenuAnimations,
      disableTheming: g.disableTheming ?? base.performance?.disableTheming,
      disableCursorShadow: g.disableCursorShadow ?? base.performance?.disableCursorShadow,
      disableCursorSettings: g.disableCursorSettings ?? base.performance?.disableCursorSettings,
      enableFontSmoothing: g.enableFontSmoothing ?? base.performance?.enableFontSmoothing,
      enableDesktopComposition: g.enableDesktopComposition ?? base.performance?.enableDesktopComposition,
      persistentBitmapCaching: g.persistentBitmapCaching ?? base.performance?.persistentBitmapCaching,
      targetFps: g.targetFps ?? base.performance?.targetFps,
      frameBatching: g.frameBatching ?? base.performance?.frameBatching,
      frameBatchIntervalMs: g.frameBatchIntervalMs ?? base.performance?.frameBatchIntervalMs,
      renderBackend: g.renderBackend ?? base.performance?.renderBackend,
      frontendRenderer: (g.frontendRenderer ?? base.performance?.frontendRenderer ?? 'auto') as FrontendRendererType,
      frameScheduling: g.frameScheduling ?? base.performance?.frameScheduling,
      tripleBuffering: g.tripleBuffering ?? base.performance?.tripleBuffering,
      codecs: mergedCodecs,
      ...defined(conn?.performance),
      // Resolve 'inherit': replace with global default
      ...(conn?.performance?.renderBackend === 'inherit' ? { renderBackend: g.renderBackend ?? base.performance?.renderBackend } : {}),
      ...(conn?.performance?.frontendRenderer === 'inherit' ? { frontendRenderer: (g.frontendRenderer ?? base.performance?.frontendRenderer ?? 'auto') as FrontendRendererType } : {}),
      // Preserve codec merge after conn spread
      codecs: { ...mergedCodecs, ...defined(conn?.performance?.codecs) },
    },
    security: {
      ...base.security,
      useCredSsp: g.useCredSsp ?? base.security?.useCredSsp,
      enableTls: g.enableTls ?? base.security?.enableTls,
      enableNla: g.enableNla ?? base.security?.enableNla,
      autoLogon: g.autoLogon ?? base.security?.autoLogon,
      credsspOracleRemediation: g.credsspOracleRemediation ?? base.security?.credsspOracleRemediation,
      allowHybridEx: g.allowHybridEx ?? base.security?.allowHybridEx,
      nlaFallbackToTls: g.nlaFallbackToTls ?? base.security?.nlaFallbackToTls,
      tlsMinVersion: g.tlsMinVersion ?? base.security?.tlsMinVersion,
      ntlmEnabled: g.ntlmEnabled ?? base.security?.ntlmEnabled,
      kerberosEnabled: g.kerberosEnabled ?? base.security?.kerberosEnabled,
      pku2uEnabled: g.pku2uEnabled ?? base.security?.pku2uEnabled,
      restrictedAdmin: g.restrictedAdmin ?? base.security?.restrictedAdmin,
      remoteCredentialGuard: g.remoteCredentialGuard ?? base.security?.remoteCredentialGuard,
      enforceServerPublicKeyValidation: g.enforceServerPublicKeyValidation ?? base.security?.enforceServerPublicKeyValidation,
      credsspVersion: g.credsspVersion ?? base.security?.credsspVersion,
      serverCertValidation: g.serverCertValidation ?? base.security?.serverCertValidation,
      enableServerPointer: g.enableServerPointer ?? base.security?.enableServerPointer,
      pointerSoftwareRendering: g.pointerSoftwareRendering ?? base.security?.pointerSoftwareRendering,
      sspiPackageList: g.sspiPackageList || base.security?.sspiPackageList,
      ...defined(conn?.security),
    },
    gateway: {
      ...base.gateway,
      enabled: g.gatewayEnabled ?? base.gateway?.enabled,
      hostname: g.gatewayHostname || base.gateway?.hostname,
      port: g.gatewayPort ?? base.gateway?.port,
      authMethod: g.gatewayAuthMethod ?? base.gateway?.authMethod,
      transportMode: g.gatewayTransportMode ?? base.gateway?.transportMode,
      bypassForLocal: g.gatewayBypassLocal ?? base.gateway?.bypassForLocal,
      ...defined(conn?.gateway),
    },
    hyperv: {
      ...base.hyperv,
      enhancedSessionMode: g.enhancedSessionMode ?? base.hyperv?.enhancedSessionMode,
      ...defined(conn?.hyperv),
    },
    negotiation: {
      ...base.negotiation,
      autoDetect: g.autoDetect ?? base.negotiation?.autoDetect,
      strategy: g.negotiationStrategy ?? base.negotiation?.strategy,
      maxRetries: g.maxRetries ?? base.negotiation?.maxRetries,
      retryDelayMs: g.retryDelayMs ?? base.negotiation?.retryDelayMs,
      ...defined(conn?.negotiation),
    },
    advanced: {
      ...base.advanced,
      fullFrameSyncInterval: g.fullFrameSyncInterval ?? base.advanced?.fullFrameSyncInterval,
      readTimeoutMs: g.readTimeoutMs ?? base.advanced?.readTimeoutMs,
      sessionClosePolicy: g.sessionClosePolicy ?? base.advanced?.sessionClosePolicy,
      clientName: g.clientName || base.advanced?.clientName,
      clientBuild: g.clientBuild ?? base.advanced?.clientBuild,
      maxConsecutiveErrors: g.maxConsecutiveErrors ?? base.advanced?.maxConsecutiveErrors,
      statsIntervalSecs: g.statsIntervalSecs ?? base.advanced?.statsIntervalSecs,
      ...defined(conn?.advanced),
    },
    tcp: {
      ...base.tcp,
      connectTimeoutSecs: g.tcpConnectTimeoutSecs ?? base.tcp?.connectTimeoutSecs,
      nodelay: g.tcpNodelay ?? base.tcp?.nodelay,
      keepAlive: g.tcpKeepAlive ?? base.tcp?.keepAlive,
      keepAliveIntervalSecs: g.tcpKeepAliveIntervalSecs ?? base.tcp?.keepAliveIntervalSecs,
      recvBufferSize: g.tcpRecvBufferSize ?? base.tcp?.recvBufferSize,
      sendBufferSize: g.tcpSendBufferSize ?? base.tcp?.sendBufferSize,
      ...defined(conn?.tcp),
    },
  };
}
