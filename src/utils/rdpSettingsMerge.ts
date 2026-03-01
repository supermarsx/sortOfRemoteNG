import { DEFAULT_RDP_SETTINGS, RDPConnectionSettings } from '../types/connection';

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

  return {
    display: {
      ...base.display,
      width: global.defaultWidth ?? base.display?.width,
      height: global.defaultHeight ?? base.display?.height,
      colorDepth: global.defaultColorDepth ?? base.display?.colorDepth,
      smartSizing: global.smartSizing ?? base.display?.smartSizing,
      ...conn?.display,
    },
    audio: { ...base.audio, ...conn?.audio },
    input: { ...base.input, ...conn?.input },
    deviceRedirection: { ...base.deviceRedirection, ...conn?.deviceRedirection },
    performance: {
      ...base.performance,
      targetFps: global.targetFps ?? base.performance?.targetFps,
      frameBatching: global.frameBatching ?? base.performance?.frameBatching,
      frameBatchIntervalMs: global.frameBatchIntervalMs ?? base.performance?.frameBatchIntervalMs,
      renderBackend: global.renderBackend ?? base.performance?.renderBackend,
      frontendRenderer: (global.frontendRenderer ?? base.performance?.frontendRenderer ?? 'auto') as FrontendRendererType,
      codecs: {
        ...base.performance?.codecs,
        enableCodecs: global.codecsEnabled ?? base.performance?.codecs?.enableCodecs,
        remoteFx: global.remoteFxEnabled ?? base.performance?.codecs?.remoteFx,
        remoteFxEntropy: global.remoteFxEntropy ?? base.performance?.codecs?.remoteFxEntropy,
        enableGfx: global.gfxEnabled ?? base.performance?.codecs?.enableGfx,
        h264Decoder: global.h264Decoder ?? base.performance?.codecs?.h264Decoder,
        ...conn?.performance?.codecs,
      },
      ...conn?.performance,
      ...(conn?.performance ? {
        codecs: {
          ...base.performance?.codecs,
          enableCodecs: global.codecsEnabled ?? base.performance?.codecs?.enableCodecs,
          remoteFx: global.remoteFxEnabled ?? base.performance?.codecs?.remoteFx,
          remoteFxEntropy: global.remoteFxEntropy ?? base.performance?.codecs?.remoteFxEntropy,
          enableGfx: global.gfxEnabled ?? base.performance?.codecs?.enableGfx,
          h264Decoder: global.h264Decoder ?? base.performance?.codecs?.h264Decoder,
          ...conn?.performance?.codecs,
        },
      } : {}),
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
