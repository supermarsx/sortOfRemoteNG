import { DEFAULT_RDP_SETTINGS, RDPConnectionSettings } from '../../types/connection/connection';

type FrontendRendererType = NonNullable<RDPConnectionSettings['performance']>['frontendRenderer'];

/**
 * Merge compile-time defaults, global defaults, and per-connection overrides
 * into a single RDPConnectionSettings object.
 */
export function mergeRdpSettings(
  connSettings: RDPConnectionSettings | undefined,
  globalDefaults: Record<string, any>,
): RDPConnectionSettings {
  const base = DEFAULT_RDP_SETTINGS;
  const conn = connSettings;
  const global = globalDefaults;

  // Build merged codec settings (used twice: base merge + conn override)
  const mergedCodecs = {
    ...base.performance?.codecs,
    enableCodecs: global.codecsEnabled ?? base.performance?.codecs?.enableCodecs,
    remoteFx: global.remoteFxEnabled ?? base.performance?.codecs?.remoteFx,
    remoteFxEntropy: global.remoteFxEntropy ?? base.performance?.codecs?.remoteFxEntropy,
    enableGfx: global.gfxEnabled ?? base.performance?.codecs?.enableGfx,
    h264Decoder: global.h264Decoder ?? base.performance?.codecs?.h264Decoder,
    nalPassthrough: global.nalPassthrough ?? base.performance?.codecs?.nalPassthrough,
  };

  return {
    display: {
      ...base.display,
      width: global.defaultWidth ?? base.display?.width,
      height: global.defaultHeight ?? base.display?.height,
      colorDepth: global.defaultColorDepth ?? base.display?.colorDepth,
      smartSizing: global.smartSizing ?? base.display?.smartSizing,
      resizeToWindow: global.resizeToWindow ?? base.display?.resizeToWindow,
      desktopScaleFactor: global.desktopScaleFactor ?? base.display?.desktopScaleFactor,
      lossyCompression: global.lossyCompression ?? base.display?.lossyCompression,
      ...conn?.display,
    },
    audio: {
      ...base.audio,
      playbackMode: global.audioPlaybackMode ?? base.audio?.playbackMode,
      recordingMode: global.audioRecordingMode ?? base.audio?.recordingMode,
      audioQuality: global.audioQuality ?? base.audio?.audioQuality,
      ...conn?.audio,
    },
    input: {
      ...base.input,
      mouseMode: global.mouseMode ?? base.input?.mouseMode,
      enableUnicodeInput: global.enableUnicodeInput ?? base.input?.enableUnicodeInput,
      autoDetectLayout: global.autoDetectKeyboardLayout ?? base.input?.autoDetectLayout,
      scrollSpeed: global.scrollSpeed ?? base.input?.scrollSpeed,
      smoothScroll: global.smoothScroll ?? base.input?.smoothScroll,
      localCursor: global.localCursor ?? base.input?.localCursor,
      ...conn?.input,
    },
    deviceRedirection: {
      ...base.deviceRedirection,
      clipboard: global.clipboardRedirection ?? base.deviceRedirection?.clipboard,
      printers: global.printerRedirection ?? base.deviceRedirection?.printers,
      ports: global.portRedirection ?? base.deviceRedirection?.ports,
      smartCards: global.smartCardRedirection ?? base.deviceRedirection?.smartCards,
      webAuthn: global.webAuthnRedirection ?? base.deviceRedirection?.webAuthn,
      videoCapture: global.videoCaptureRedirection ?? base.deviceRedirection?.videoCapture,
      usbDevices: global.usbRedirection ?? base.deviceRedirection?.usbDevices,
      audioInput: global.audioInputRedirection ?? base.deviceRedirection?.audioInput,
      ...conn?.deviceRedirection,
    },
    performance: {
      ...base.performance,
      connectionSpeed: global.connectionSpeed ?? base.performance?.connectionSpeed,
      disableWallpaper: global.disableWallpaper ?? base.performance?.disableWallpaper,
      disableFullWindowDrag: global.disableFullWindowDrag ?? base.performance?.disableFullWindowDrag,
      disableMenuAnimations: global.disableMenuAnimations ?? base.performance?.disableMenuAnimations,
      disableTheming: global.disableTheming ?? base.performance?.disableTheming,
      disableCursorShadow: global.disableCursorShadow ?? base.performance?.disableCursorShadow,
      disableCursorSettings: global.disableCursorSettings ?? base.performance?.disableCursorSettings,
      enableFontSmoothing: global.enableFontSmoothing ?? base.performance?.enableFontSmoothing,
      enableDesktopComposition: global.enableDesktopComposition ?? base.performance?.enableDesktopComposition,
      persistentBitmapCaching: global.persistentBitmapCaching ?? base.performance?.persistentBitmapCaching,
      targetFps: global.targetFps ?? base.performance?.targetFps,
      frameBatching: global.frameBatching ?? base.performance?.frameBatching,
      frameBatchIntervalMs: global.frameBatchIntervalMs ?? base.performance?.frameBatchIntervalMs,
      renderBackend: global.renderBackend ?? base.performance?.renderBackend,
      frontendRenderer: (global.frontendRenderer ?? base.performance?.frontendRenderer ?? 'auto') as FrontendRendererType,
      frameScheduling: global.frameScheduling ?? base.performance?.frameScheduling,
      tripleBuffering: global.tripleBuffering ?? base.performance?.tripleBuffering,
      codecs: { ...mergedCodecs },
      ...conn?.performance,
      // Resolve 'inherit': replace with global default so downstream code never sees it
      ...(conn?.performance?.renderBackend === 'inherit' ? { renderBackend: global.renderBackend ?? base.performance?.renderBackend } : {}),
      ...(conn?.performance?.frontendRenderer === 'inherit' ? { frontendRenderer: (global.frontendRenderer ?? base.performance?.frontendRenderer ?? 'auto') as FrontendRendererType } : {}),
      // Re-apply codec merge after conn?.performance spread to ensure global defaults underlay
      ...(conn?.performance ? { codecs: { ...mergedCodecs, ...conn?.performance?.codecs } } : {}),
    },
    security: {
      ...base.security,
      useCredSsp: global.useCredSsp ?? base.security?.useCredSsp,
      enableTls: global.enableTls ?? base.security?.enableTls,
      enableNla: global.enableNla ?? base.security?.enableNla,
      autoLogon: global.autoLogon ?? base.security?.autoLogon,
      ...conn?.security,
    },
    gateway: {
      ...base.gateway,
      enabled: global.gatewayEnabled ?? base.gateway?.enabled,
      hostname: global.gatewayHostname || base.gateway?.hostname,
      port: global.gatewayPort ?? base.gateway?.port,
      authMethod: global.gatewayAuthMethod ?? base.gateway?.authMethod,
      transportMode: global.gatewayTransportMode ?? base.gateway?.transportMode,
      bypassForLocal: global.gatewayBypassLocal ?? base.gateway?.bypassForLocal,
      ...conn?.gateway,
    },
    hyperv: {
      ...base.hyperv,
      enhancedSessionMode: global.enhancedSessionMode ?? base.hyperv?.enhancedSessionMode,
      ...conn?.hyperv,
    },
    negotiation: {
      ...base.negotiation,
      autoDetect: global.autoDetect ?? base.negotiation?.autoDetect,
      strategy: global.negotiationStrategy ?? base.negotiation?.strategy,
      maxRetries: global.maxRetries ?? base.negotiation?.maxRetries,
      retryDelayMs: global.retryDelayMs ?? base.negotiation?.retryDelayMs,
      ...conn?.negotiation,
    },
    advanced: {
      ...base.advanced,
      fullFrameSyncInterval: global.fullFrameSyncInterval ?? base.advanced?.fullFrameSyncInterval,
      readTimeoutMs: global.readTimeoutMs ?? base.advanced?.readTimeoutMs,
      ...conn?.advanced,
    },
    tcp: {
      ...base.tcp,
      connectTimeoutSecs: global.tcpConnectTimeoutSecs ?? base.tcp?.connectTimeoutSecs,
      nodelay: global.tcpNodelay ?? base.tcp?.nodelay,
      keepAlive: global.tcpKeepAlive ?? base.tcp?.keepAlive,
      keepAliveIntervalSecs: global.tcpKeepAliveIntervalSecs ?? base.tcp?.keepAliveIntervalSecs,
      recvBufferSize: global.tcpRecvBufferSize ?? base.tcp?.recvBufferSize,
      sendBufferSize: global.tcpSendBufferSize ?? base.tcp?.sendBufferSize,
      ...conn?.tcp,
    },
  };
}
