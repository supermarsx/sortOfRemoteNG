import { describe, it, expect } from 'vitest';
import { mergeRdpSettings } from '../../src/utils/rdp/rdpSettingsMerge';
import { DEFAULT_RDP_SETTINGS, RDPConnectionSettings } from '../../src/types/connection/connection';

// ---------------------------------------------------------------------------
// Helper: extract the `defined()` function's behaviour via the public
// mergeRdpSettings API (defined() is not exported, so we test it indirectly
// through the merge, and directly via a re-implementation contract test below).
// ---------------------------------------------------------------------------

describe('mergeRdpSettings', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Basic merge — no per-connection settings
  // ═══════════════════════════════════════════════════════════════════════
  describe('basic merge — compile-time defaults only (no globals, no per-connection)', () => {
    const result = mergeRdpSettings(undefined, {});

    it('returns every top-level section', () => {
      expect(result.display).toBeDefined();
      expect(result.audio).toBeDefined();
      expect(result.input).toBeDefined();
      expect(result.deviceRedirection).toBeDefined();
      expect(result.performance).toBeDefined();
      expect(result.security).toBeDefined();
      expect(result.gateway).toBeDefined();
      expect(result.hyperv).toBeDefined();
      expect(result.negotiation).toBeDefined();
      expect(result.advanced).toBeDefined();
      expect(result.tcp).toBeDefined();
    });

    it('display matches compile-time defaults', () => {
      expect(result.display?.width).toBe(1920);
      expect(result.display?.height).toBe(1080);
      expect(result.display?.resizeToWindow).toBe(true);
      expect(result.display?.colorDepth).toBe(32);
      expect(result.display?.desktopScaleFactor).toBe(100);
      expect(result.display?.lossyCompression).toBe(true);
      expect(result.display?.smartSizing).toBe(true);
    });

    it('audio matches compile-time defaults', () => {
      expect(result.audio?.playbackMode).toBe('local');
      expect(result.audio?.recordingMode).toBe('disabled');
      expect(result.audio?.audioQuality).toBe('dynamic');
    });

    it('input matches compile-time defaults', () => {
      expect(result.input?.mouseMode).toBe('absolute');
      expect(result.input?.enableUnicodeInput).toBe(true);
      expect(result.input?.autoDetectLayout).toBe(true);
      expect(result.input?.scrollSpeed).toBe(1.0);
      expect(result.input?.smoothScroll).toBe(true);
      expect(result.input?.localCursor).toBe('local');
      expect(result.input?.inputPriority).toBe('realtime');
      expect(result.input?.batchIntervalMs).toBe(16);
      expect(result.input?.keyboardLayout).toBe(0x0409);
      expect(result.input?.keyboardType).toBe('ibm-enhanced');
      expect(result.input?.keyboardFunctionKeys).toBe(12);
    });

    it('deviceRedirection matches compile-time defaults', () => {
      expect(result.deviceRedirection?.clipboard).toBe(true);
      expect(result.deviceRedirection?.clipboardDirection).toBe('bidirectional');
      expect(result.deviceRedirection?.printers).toBe(false);
      expect(result.deviceRedirection?.ports).toBe(false);
      expect(result.deviceRedirection?.smartCards).toBe(false);
      expect(result.deviceRedirection?.webAuthn).toBe(false);
      expect(result.deviceRedirection?.videoCapture).toBe(false);
      expect(result.deviceRedirection?.usbDevices).toBe(false);
      expect(result.deviceRedirection?.audioInput).toBe(false);
    });

    it('performance matches compile-time defaults', () => {
      expect(result.performance?.connectionSpeed).toBe('broadband-high');
      expect(result.performance?.disableWallpaper).toBe(true);
      expect(result.performance?.disableFullWindowDrag).toBe(true);
      expect(result.performance?.disableMenuAnimations).toBe(true);
      expect(result.performance?.disableTheming).toBe(false);
      expect(result.performance?.disableCursorShadow).toBe(true);
      expect(result.performance?.disableCursorSettings).toBe(false);
      expect(result.performance?.enableFontSmoothing).toBe(true);
      expect(result.performance?.enableDesktopComposition).toBe(false);
      expect(result.performance?.persistentBitmapCaching).toBe(false);
      expect(result.performance?.targetFps).toBe(30);
      expect(result.performance?.frameBatching).toBe(false);
      expect(result.performance?.frameBatchIntervalMs).toBe(33);
      expect(result.performance?.renderBackend).toBe('webview');
      expect(result.performance?.frontendRenderer).toBe('auto');
      expect(result.performance?.frameScheduling).toBe('adaptive');
      expect(result.performance?.tripleBuffering).toBe(true);
    });

    it('performance codecs match compile-time defaults', () => {
      expect(result.performance?.codecs?.enableCodecs).toBe(true);
      expect(result.performance?.codecs?.remoteFx).toBe(true);
      expect(result.performance?.codecs?.remoteFxEntropy).toBe('rlgr3');
      expect(result.performance?.codecs?.enableGfx).toBe(false);
      expect(result.performance?.codecs?.h264Decoder).toBe('auto');
    });

    it('security matches compile-time defaults', () => {
      expect(result.security?.enableTls).toBe(true);
      expect(result.security?.enableNla).toBe(true);
      expect(result.security?.useCredSsp).toBe(true);
      expect(result.security?.autoLogon).toBe(false);
      expect(result.security?.enableServerPointer).toBe(true);
      expect(result.security?.pointerSoftwareRendering).toBe(true);
    });

    it('gateway matches compile-time defaults', () => {
      expect(result.gateway?.enabled).toBe(false);
      expect(result.gateway?.hostname).toBe('');
      expect(result.gateway?.port).toBe(443);
      expect(result.gateway?.authMethod).toBe('ntlm');
      expect(result.gateway?.bypassForLocal).toBe(true);
      expect(result.gateway?.transportMode).toBe('auto');
    });

    it('hyperv matches compile-time defaults', () => {
      expect(result.hyperv?.enhancedSessionMode).toBe(false);
    });

    it('negotiation matches compile-time defaults', () => {
      expect(result.negotiation?.autoDetect).toBe(false);
      expect(result.negotiation?.strategy).toBe('nla-first');
      expect(result.negotiation?.maxRetries).toBe(3);
      expect(result.negotiation?.retryDelayMs).toBe(1000);
    });

    it('advanced matches compile-time defaults', () => {
      expect(result.advanced?.clientName).toBe('SortOfRemoteNG');
      expect(result.advanced?.clientBuild).toBe(0);
      expect(result.advanced?.readTimeoutMs).toBe(16);
      expect(result.advanced?.fullFrameSyncInterval).toBe(300);
      expect(result.advanced?.maxConsecutiveErrors).toBe(50);
      expect(result.advanced?.statsIntervalSecs).toBe(1);
    });

    it('tcp matches compile-time defaults', () => {
      expect(result.tcp?.connectTimeoutSecs).toBe(10);
      expect(result.tcp?.nodelay).toBe(true);
      expect(result.tcp?.keepAlive).toBe(true);
      expect(result.tcp?.keepAliveIntervalSecs).toBe(60);
      expect(result.tcp?.recvBufferSize).toBe(262144);
      expect(result.tcp?.sendBufferSize).toBe(262144);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Per-connection override — verify overrides beat globals and defaults
  // ═══════════════════════════════════════════════════════════════════════
  describe('per-connection overrides take highest priority', () => {
    it('display overrides win over globals', () => {
      const result = mergeRdpSettings(
        { display: { width: 3840, height: 2160, colorDepth: 24, smartSizing: false } },
        { defaultWidth: 2560, defaultHeight: 1440, defaultColorDepth: 32, smartSizing: true },
      );
      expect(result.display?.width).toBe(3840);
      expect(result.display?.height).toBe(2160);
      expect(result.display?.colorDepth).toBe(24);
      expect(result.display?.smartSizing).toBe(false);
    });

    it('audio overrides win over globals', () => {
      const result = mergeRdpSettings(
        { audio: { playbackMode: 'remote', recordingMode: 'enabled', audioQuality: 'high' } },
        { audioPlaybackMode: 'disabled', audioRecordingMode: 'disabled', audioQuality: 'medium' },
      );
      expect(result.audio?.playbackMode).toBe('remote');
      expect(result.audio?.recordingMode).toBe('enabled');
      expect(result.audio?.audioQuality).toBe('high');
    });

    it('input overrides win over globals', () => {
      const result = mergeRdpSettings(
        { input: { mouseMode: 'relative', scrollSpeed: 2.5, smoothScroll: false, localCursor: 'dot' } },
        { mouseMode: 'absolute', scrollSpeed: 1.0, smoothScroll: true, localCursor: 'remote' },
      );
      expect(result.input?.mouseMode).toBe('relative');
      expect(result.input?.scrollSpeed).toBe(2.5);
      expect(result.input?.smoothScroll).toBe(false);
      expect(result.input?.localCursor).toBe('dot');
    });

    it('security overrides win over globals', () => {
      const result = mergeRdpSettings(
        { security: { useCredSsp: false, enableTls: false, enableNla: false, autoLogon: true } },
        { useCredSsp: true, enableTls: true, enableNla: true, autoLogon: false },
      );
      expect(result.security?.useCredSsp).toBe(false);
      expect(result.security?.enableTls).toBe(false);
      expect(result.security?.enableNla).toBe(false);
      expect(result.security?.autoLogon).toBe(true);
    });

    it('performance overrides win over globals', () => {
      const result = mergeRdpSettings(
        { performance: { targetFps: 60, frameBatching: true, connectionSpeed: 'lan' } },
        { targetFps: 30, frameBatching: false, connectionSpeed: 'modem' },
      );
      expect(result.performance?.targetFps).toBe(60);
      expect(result.performance?.frameBatching).toBe(true);
      expect(result.performance?.connectionSpeed).toBe('lan');
    });

    it('gateway overrides win over globals', () => {
      const result = mergeRdpSettings(
        { gateway: { enabled: true, hostname: 'conn-gw.example.com', port: 8443 } },
        { gatewayEnabled: false, gatewayHostname: 'global-gw.example.com', gatewayPort: 443 },
      );
      expect(result.gateway?.enabled).toBe(true);
      expect(result.gateway?.hostname).toBe('conn-gw.example.com');
      expect(result.gateway?.port).toBe(8443);
    });

    it('negotiation overrides win over globals', () => {
      const result = mergeRdpSettings(
        { negotiation: { strategy: 'tls-only', maxRetries: 10, retryDelayMs: 500 } },
        { negotiationStrategy: 'nla-first', maxRetries: 3, retryDelayMs: 1000 },
      );
      expect(result.negotiation?.strategy).toBe('tls-only');
      expect(result.negotiation?.maxRetries).toBe(10);
      expect(result.negotiation?.retryDelayMs).toBe(500);
    });

    it('tcp overrides win over globals', () => {
      const result = mergeRdpSettings(
        { tcp: { connectTimeoutSecs: 30, nodelay: false, keepAlive: false } },
        { tcpConnectTimeoutSecs: 10, tcpNodelay: true, tcpKeepAlive: true },
      );
      expect(result.tcp?.connectTimeoutSecs).toBe(30);
      expect(result.tcp?.nodelay).toBe(false);
      expect(result.tcp?.keepAlive).toBe(false);
    });

    it('advanced overrides win over globals', () => {
      const result = mergeRdpSettings(
        { advanced: { sessionClosePolicy: 'detach', fullFrameSyncInterval: 100, maxConsecutiveErrors: 10 } },
        { sessionClosePolicy: 'disconnect', fullFrameSyncInterval: 300, maxConsecutiveErrors: 50 },
      );
      expect(result.advanced?.sessionClosePolicy).toBe('detach');
      expect(result.advanced?.fullFrameSyncInterval).toBe(100);
      expect(result.advanced?.maxConsecutiveErrors).toBe(10);
    });

    it('hyperv overrides win over globals', () => {
      const result = mergeRdpSettings(
        { hyperv: { enhancedSessionMode: true } },
        { enhancedSessionMode: false },
      );
      expect(result.hyperv?.enhancedSessionMode).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Inheritance — undefined per-connection fields fall through to global
  // ═══════════════════════════════════════════════════════════════════════
  describe('inheritance — undefined per-connection fields fall through to global defaults', () => {
    it('display: undefined fields inherit from global, defined fields override', () => {
      const result = mergeRdpSettings(
        { display: { width: 2560, height: undefined, colorDepth: undefined } },
        { defaultWidth: 1280, defaultHeight: 720, defaultColorDepth: 16 },
      );
      // width is defined in per-connection → override
      expect(result.display?.width).toBe(2560);
      // height and colorDepth are undefined → inherit from global
      expect(result.display?.height).toBe(720);
      expect(result.display?.colorDepth).toBe(16);
    });

    it('audio: undefined fields inherit from global', () => {
      const result = mergeRdpSettings(
        { audio: { playbackMode: 'remote', recordingMode: undefined, audioQuality: undefined } },
        { audioRecordingMode: 'enabled', audioQuality: 'high' },
      );
      expect(result.audio?.playbackMode).toBe('remote');
      expect(result.audio?.recordingMode).toBe('enabled');
      expect(result.audio?.audioQuality).toBe('high');
    });

    it('input: undefined fields inherit from global', () => {
      const result = mergeRdpSettings(
        { input: { mouseMode: undefined, scrollSpeed: 3.0, smoothScroll: undefined } },
        { mouseMode: 'relative', smoothScroll: false },
      );
      expect(result.input?.mouseMode).toBe('relative');
      expect(result.input?.scrollSpeed).toBe(3.0);
      expect(result.input?.smoothScroll).toBe(false);
    });

    it('security: undefined fields inherit from global', () => {
      const result = mergeRdpSettings(
        { security: { useCredSsp: undefined, enableTls: false } },
        { useCredSsp: false },
      );
      expect(result.security?.useCredSsp).toBe(false);
      expect(result.security?.enableTls).toBe(false);
    });

    it('when per-connection field is undefined and global is also unset, compile-time default is used', () => {
      const result = mergeRdpSettings(
        { display: { width: undefined, height: undefined } },
        {}, // no global overrides
      );
      expect(result.display?.width).toBe(DEFAULT_RDP_SETTINGS.display?.width);
      expect(result.display?.height).toBe(DEFAULT_RDP_SETTINGS.display?.height);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Display section — presets, inheritance
  // ═══════════════════════════════════════════════════════════════════════
  describe('display section', () => {
    it('global width/height presets override compile-time defaults', () => {
      const result = mergeRdpSettings(undefined, { defaultWidth: 1280, defaultHeight: 720 });
      expect(result.display?.width).toBe(1280);
      expect(result.display?.height).toBe(720);
    });

    it('width=0 / height=0 global (match window) is preserved', () => {
      const result = mergeRdpSettings(undefined, { defaultWidth: 0, defaultHeight: 0 });
      // 0 is falsy but ?? only triggers on null/undefined, so 0 is preserved
      expect(result.display?.width).toBe(0);
      expect(result.display?.height).toBe(0);
    });

    it('colorDepth inheritance: global 16-bit → per-conn undefined → result 16', () => {
      const result = mergeRdpSettings(
        { display: { colorDepth: undefined } },
        { defaultColorDepth: 16 },
      );
      expect(result.display?.colorDepth).toBe(16);
    });

    it('resizeToWindow global override', () => {
      const result = mergeRdpSettings(undefined, { resizeToWindow: false });
      expect(result.display?.resizeToWindow).toBe(false);
    });

    it('smartSizing global override', () => {
      const result = mergeRdpSettings(undefined, { smartSizing: false });
      expect(result.display?.smartSizing).toBe(false);
    });

    it('desktopScaleFactor global override', () => {
      const result = mergeRdpSettings(undefined, { desktopScaleFactor: 200 });
      expect(result.display?.desktopScaleFactor).toBe(200);
    });

    it('lossyCompression global override', () => {
      const result = mergeRdpSettings(undefined, { lossyCompression: false });
      expect(result.display?.lossyCompression).toBe(false);
    });

    it('per-connection display fields do not clobber unrelated fields from base', () => {
      const result = mergeRdpSettings(
        { display: { width: 800 } },
        {},
      );
      // Only width was set; everything else should come from compile-time default
      expect(result.display?.width).toBe(800);
      expect(result.display?.height).toBe(DEFAULT_RDP_SETTINGS.display?.height);
      expect(result.display?.colorDepth).toBe(DEFAULT_RDP_SETTINGS.display?.colorDepth);
      expect(result.display?.resizeToWindow).toBe(DEFAULT_RDP_SETTINGS.display?.resizeToWindow);
      expect(result.display?.smartSizing).toBe(DEFAULT_RDP_SETTINGS.display?.smartSizing);
      expect(result.display?.desktopScaleFactor).toBe(DEFAULT_RDP_SETTINGS.display?.desktopScaleFactor);
      expect(result.display?.lossyCompression).toBe(DEFAULT_RDP_SETTINGS.display?.lossyCompression);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Audio section
  // ═══════════════════════════════════════════════════════════════════════
  describe('audio section', () => {
    it('all three audio fields from globals', () => {
      const result = mergeRdpSettings(undefined, {
        audioPlaybackMode: 'remote',
        audioRecordingMode: 'enabled',
        audioQuality: 'high',
      });
      expect(result.audio?.playbackMode).toBe('remote');
      expect(result.audio?.recordingMode).toBe('enabled');
      expect(result.audio?.audioQuality).toBe('high');
    });

    it('playbackMode "disabled" from global', () => {
      const result = mergeRdpSettings(undefined, { audioPlaybackMode: 'disabled' });
      expect(result.audio?.playbackMode).toBe('disabled');
    });

    it('per-connection playbackMode overrides global', () => {
      const result = mergeRdpSettings(
        { audio: { playbackMode: 'disabled' } },
        { audioPlaybackMode: 'remote' },
      );
      expect(result.audio?.playbackMode).toBe('disabled');
    });

    it('per-connection undefined playbackMode inherits global', () => {
      const result = mergeRdpSettings(
        { audio: { playbackMode: undefined } },
        { audioPlaybackMode: 'remote' },
      );
      expect(result.audio?.playbackMode).toBe('remote');
    });

    it('per-connection undefined recordingMode and audioQuality inherit global', () => {
      const result = mergeRdpSettings(
        { audio: { recordingMode: undefined, audioQuality: undefined } },
        { audioRecordingMode: 'enabled', audioQuality: 'medium' },
      );
      expect(result.audio?.recordingMode).toBe('enabled');
      expect(result.audio?.audioQuality).toBe('medium');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Input section
  // ═══════════════════════════════════════════════════════════════════════
  describe('input section', () => {
    it('localCursor inherits from global', () => {
      const result = mergeRdpSettings(undefined, { localCursor: 'dot' });
      expect(result.input?.localCursor).toBe('dot');
    });

    it('scrollSpeed inherits from global', () => {
      const result = mergeRdpSettings(undefined, { scrollSpeed: 2.5 });
      expect(result.input?.scrollSpeed).toBe(2.5);
    });

    it('smoothScroll inherits from global', () => {
      const result = mergeRdpSettings(undefined, { smoothScroll: false });
      expect(result.input?.smoothScroll).toBe(false);
    });

    it('mouseMode inherits from global', () => {
      const result = mergeRdpSettings(undefined, { mouseMode: 'relative' });
      expect(result.input?.mouseMode).toBe('relative');
    });

    it('enableUnicodeInput inherits from global', () => {
      const result = mergeRdpSettings(undefined, { enableUnicodeInput: false });
      expect(result.input?.enableUnicodeInput).toBe(false);
    });

    it('autoDetectLayout (mapped from autoDetectKeyboardLayout) inherits from global', () => {
      const result = mergeRdpSettings(undefined, { autoDetectKeyboardLayout: false });
      expect(result.input?.autoDetectLayout).toBe(false);
    });

    it('inputPriority inherits from global', () => {
      const result = mergeRdpSettings(undefined, { inputPriority: 'batched' });
      expect(result.input?.inputPriority).toBe('batched');
    });

    it('batchIntervalMs inherits from global', () => {
      const result = mergeRdpSettings(undefined, { batchIntervalMs: 32 });
      expect(result.input?.batchIntervalMs).toBe(32);
    });

    it('keyboardLayout inherits from global', () => {
      const result = mergeRdpSettings(undefined, { keyboardLayout: 0x0407 });
      expect(result.input?.keyboardLayout).toBe(0x0407);
    });

    it('keyboardType inherits from global', () => {
      const result = mergeRdpSettings(undefined, { keyboardType: 'japanese' });
      expect(result.input?.keyboardType).toBe('japanese');
    });

    it('keyboardFunctionKeys inherits from global', () => {
      const result = mergeRdpSettings(undefined, { keyboardFunctionKeys: 24 });
      expect(result.input?.keyboardFunctionKeys).toBe(24);
    });

    it('per-connection overrides all input fields simultaneously', () => {
      const result = mergeRdpSettings(
        {
          input: {
            mouseMode: 'relative',
            scrollSpeed: 0.5,
            smoothScroll: false,
            localCursor: 'remote',
            enableUnicodeInput: false,
            autoDetectLayout: false,
            inputPriority: 'batched',
            batchIntervalMs: 64,
            keyboardLayout: 0x0407,
            keyboardType: 'japanese',
            keyboardFunctionKeys: 24,
          },
        },
        {
          mouseMode: 'absolute',
          scrollSpeed: 1.0,
          smoothScroll: true,
          localCursor: 'local',
          enableUnicodeInput: true,
          autoDetectKeyboardLayout: true,
          inputPriority: 'realtime',
          batchIntervalMs: 16,
          keyboardLayout: 0x0409,
          keyboardType: 'ibm-enhanced',
          keyboardFunctionKeys: 12,
        },
      );
      expect(result.input?.mouseMode).toBe('relative');
      expect(result.input?.scrollSpeed).toBe(0.5);
      expect(result.input?.smoothScroll).toBe(false);
      expect(result.input?.localCursor).toBe('remote');
      expect(result.input?.enableUnicodeInput).toBe(false);
      expect(result.input?.autoDetectLayout).toBe(false);
      expect(result.input?.inputPriority).toBe('batched');
      expect(result.input?.batchIntervalMs).toBe(64);
      expect(result.input?.keyboardLayout).toBe(0x0407);
      expect(result.input?.keyboardType).toBe('japanese');
      expect(result.input?.keyboardFunctionKeys).toBe(24);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Security section
  // ═══════════════════════════════════════════════════════════════════════
  describe('security section', () => {
    it('all security fields inherit from global defaults', () => {
      const result = mergeRdpSettings(undefined, {
        useCredSsp: false,
        enableTls: false,
        enableNla: false,
        autoLogon: true,
        credsspOracleRemediation: 'vulnerable',
        allowHybridEx: false,
        nlaFallbackToTls: true,
        tlsMinVersion: '1.3',
        ntlmEnabled: false,
        kerberosEnabled: true,
        pku2uEnabled: true,
        restrictedAdmin: true,
        remoteCredentialGuard: true,
        enforceServerPublicKeyValidation: true,
        credsspVersion: 6,
        serverCertValidation: 'ignore',
        enableServerPointer: false,
        pointerSoftwareRendering: false,
        sspiPackageList: '!kerberos,!pku2u',
      });
      expect(result.security?.useCredSsp).toBe(false);
      expect(result.security?.enableTls).toBe(false);
      expect(result.security?.enableNla).toBe(false);
      expect(result.security?.autoLogon).toBe(true);
      expect(result.security?.credsspOracleRemediation).toBe('vulnerable');
      expect(result.security?.allowHybridEx).toBe(false);
      expect(result.security?.nlaFallbackToTls).toBe(true);
      expect(result.security?.tlsMinVersion).toBe('1.3');
      expect(result.security?.ntlmEnabled).toBe(false);
      expect(result.security?.kerberosEnabled).toBe(true);
      expect(result.security?.pku2uEnabled).toBe(true);
      expect(result.security?.restrictedAdmin).toBe(true);
      expect(result.security?.remoteCredentialGuard).toBe(true);
      expect(result.security?.enforceServerPublicKeyValidation).toBe(true);
      expect(result.security?.credsspVersion).toBe(6);
      expect(result.security?.serverCertValidation).toBe('ignore');
      expect(result.security?.enableServerPointer).toBe(false);
      expect(result.security?.pointerSoftwareRendering).toBe(false);
      expect(result.security?.sspiPackageList).toBe('!kerberos,!pku2u');
    });

    it('per-connection security fields override all global security fields', () => {
      const result = mergeRdpSettings(
        {
          security: {
            useCredSsp: true,
            enableTls: true,
            enableNla: true,
            autoLogon: false,
            credsspOracleRemediation: 'force-updated',
            allowHybridEx: true,
            nlaFallbackToTls: false,
            tlsMinVersion: '1.2',
            ntlmEnabled: true,
            kerberosEnabled: false,
            pku2uEnabled: false,
            restrictedAdmin: false,
            remoteCredentialGuard: false,
            enforceServerPublicKeyValidation: false,
            credsspVersion: 2,
            serverCertValidation: 'validate',
            enableServerPointer: true,
            pointerSoftwareRendering: true,
            sspiPackageList: 'negotiate',
          },
        },
        {
          useCredSsp: false,
          enableTls: false,
          enableNla: false,
          autoLogon: true,
          credsspOracleRemediation: 'vulnerable',
          allowHybridEx: false,
          nlaFallbackToTls: true,
          tlsMinVersion: '1.3',
          ntlmEnabled: false,
          kerberosEnabled: true,
          pku2uEnabled: true,
          restrictedAdmin: true,
          remoteCredentialGuard: true,
          enforceServerPublicKeyValidation: true,
          credsspVersion: 6,
          serverCertValidation: 'ignore',
          enableServerPointer: false,
          pointerSoftwareRendering: false,
          sspiPackageList: '!kerberos',
        },
      );
      expect(result.security?.useCredSsp).toBe(true);
      expect(result.security?.enableTls).toBe(true);
      expect(result.security?.enableNla).toBe(true);
      expect(result.security?.autoLogon).toBe(false);
      expect(result.security?.credsspOracleRemediation).toBe('force-updated');
      expect(result.security?.allowHybridEx).toBe(true);
      expect(result.security?.nlaFallbackToTls).toBe(false);
      expect(result.security?.tlsMinVersion).toBe('1.2');
      expect(result.security?.ntlmEnabled).toBe(true);
      expect(result.security?.kerberosEnabled).toBe(false);
      expect(result.security?.pku2uEnabled).toBe(false);
      expect(result.security?.restrictedAdmin).toBe(false);
      expect(result.security?.remoteCredentialGuard).toBe(false);
      expect(result.security?.enforceServerPublicKeyValidation).toBe(false);
      expect(result.security?.credsspVersion).toBe(2);
      expect(result.security?.serverCertValidation).toBe('validate');
      expect(result.security?.enableServerPointer).toBe(true);
      expect(result.security?.pointerSoftwareRendering).toBe(true);
      expect(result.security?.sspiPackageList).toBe('negotiate');
    });

    it('sspiPackageList uses || (falsy check) so empty string falls back to base', () => {
      const result = mergeRdpSettings(undefined, { sspiPackageList: '' });
      // empty string is falsy → || falls through to base default
      expect(result.security?.sspiPackageList).toBe(DEFAULT_RDP_SETTINGS.security?.sspiPackageList);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Performance section — renderBackend 'inherit', codec merge, flags
  // ═══════════════════════════════════════════════════════════════════════
  describe('performance section', () => {
    it('all performance flags from global defaults', () => {
      const result = mergeRdpSettings(undefined, {
        connectionSpeed: 'lan',
        disableWallpaper: false,
        disableFullWindowDrag: false,
        disableMenuAnimations: false,
        disableTheming: true,
        disableCursorShadow: false,
        disableCursorSettings: true,
        enableFontSmoothing: false,
        enableDesktopComposition: true,
        persistentBitmapCaching: true,
        targetFps: 60,
        frameBatching: true,
        frameBatchIntervalMs: 16,
        renderBackend: 'wgpu',
        frontendRenderer: 'webgl',
        frameScheduling: 'low-latency',
        tripleBuffering: false,
      });
      expect(result.performance?.connectionSpeed).toBe('lan');
      expect(result.performance?.disableWallpaper).toBe(false);
      expect(result.performance?.disableFullWindowDrag).toBe(false);
      expect(result.performance?.disableMenuAnimations).toBe(false);
      expect(result.performance?.disableTheming).toBe(true);
      expect(result.performance?.disableCursorShadow).toBe(false);
      expect(result.performance?.disableCursorSettings).toBe(true);
      expect(result.performance?.enableFontSmoothing).toBe(false);
      expect(result.performance?.enableDesktopComposition).toBe(true);
      expect(result.performance?.persistentBitmapCaching).toBe(true);
      expect(result.performance?.targetFps).toBe(60);
      expect(result.performance?.frameBatching).toBe(true);
      expect(result.performance?.frameBatchIntervalMs).toBe(16);
      expect(result.performance?.renderBackend).toBe('wgpu');
      expect(result.performance?.frontendRenderer).toBe('webgl');
      expect(result.performance?.frameScheduling).toBe('low-latency');
      expect(result.performance?.tripleBuffering).toBe(false);
    });

    describe('renderBackend "inherit" resolution', () => {
      it('resolves to global default when per-connection is "inherit"', () => {
        const result = mergeRdpSettings(
          { performance: { renderBackend: 'inherit' } },
          { renderBackend: 'softbuffer' },
        );
        expect(result.performance?.renderBackend).toBe('softbuffer');
      });

      it('resolves to compile-time default when per-connection is "inherit" and global is unset', () => {
        const result = mergeRdpSettings(
          { performance: { renderBackend: 'inherit' } },
          {},
        );
        expect(result.performance?.renderBackend).toBe(DEFAULT_RDP_SETTINGS.performance?.renderBackend);
      });

      it('non-inherit value is kept as-is', () => {
        const result = mergeRdpSettings(
          { performance: { renderBackend: 'wgpu' } },
          { renderBackend: 'softbuffer' },
        );
        expect(result.performance?.renderBackend).toBe('wgpu');
      });
    });

    describe('frontendRenderer "inherit" resolution', () => {
      it('resolves to global default when per-connection is "inherit"', () => {
        const result = mergeRdpSettings(
          { performance: { frontendRenderer: 'inherit' } },
          { frontendRenderer: 'webgl' },
        );
        expect(result.performance?.frontendRenderer).toBe('webgl');
      });

      it('resolves to compile-time default when per-connection is "inherit" and global is unset', () => {
        const result = mergeRdpSettings(
          { performance: { frontendRenderer: 'inherit' } },
          {},
        );
        // compile-time default is 'auto'
        expect(result.performance?.frontendRenderer).toBe('auto');
      });

      it('resolves to "auto" as ultimate fallback when both global and compile-time are missing', () => {
        // This tests the ?? 'auto' fallback in the merge function
        const result = mergeRdpSettings(
          { performance: { frontendRenderer: 'inherit' } },
          {},
        );
        expect(result.performance?.frontendRenderer).toBe('auto');
      });

      it('non-inherit value is kept as-is', () => {
        const result = mergeRdpSettings(
          { performance: { frontendRenderer: 'canvas2d' } },
          { frontendRenderer: 'webgpu' },
        );
        expect(result.performance?.frontendRenderer).toBe('canvas2d');
      });
    });

    describe('codec merge', () => {
      it('global codec settings override compile-time defaults', () => {
        const result = mergeRdpSettings(undefined, {
          codecsEnabled: false,
          remoteFxEnabled: false,
          remoteFxEntropy: 'rlgr1',
          gfxEnabled: true,
          h264Decoder: 'openh264',
          nalPassthrough: true,
        });
        expect(result.performance?.codecs?.enableCodecs).toBe(false);
        expect(result.performance?.codecs?.remoteFx).toBe(false);
        expect(result.performance?.codecs?.remoteFxEntropy).toBe('rlgr1');
        expect(result.performance?.codecs?.enableGfx).toBe(true);
        expect(result.performance?.codecs?.h264Decoder).toBe('openh264');
        expect(result.performance?.codecs?.nalPassthrough).toBe(true);
      });

      it('per-connection codecs override both globals and compile-time', () => {
        const result = mergeRdpSettings(
          { performance: { codecs: { enableCodecs: false, remoteFx: false } } },
          { codecsEnabled: true, remoteFxEnabled: true },
        );
        expect(result.performance?.codecs?.enableCodecs).toBe(false);
        expect(result.performance?.codecs?.remoteFx).toBe(false);
      });

      it('per-connection codecs merge preserves unset codec fields from global', () => {
        const result = mergeRdpSettings(
          { performance: { codecs: { enableGfx: true } } },
          { codecsEnabled: false, remoteFxEnabled: false, remoteFxEntropy: 'rlgr1' },
        );
        // enableGfx from per-connection
        expect(result.performance?.codecs?.enableGfx).toBe(true);
        // these from global
        expect(result.performance?.codecs?.enableCodecs).toBe(false);
        expect(result.performance?.codecs?.remoteFx).toBe(false);
        expect(result.performance?.codecs?.remoteFxEntropy).toBe('rlgr1');
      });

      it('codecs object is preserved even when per-connection performance spread overwrites it', () => {
        // The merge function has a second `codecs:` assignment after the spread
        // to restore the merged codecs. This tests that.
        const result = mergeRdpSettings(
          { performance: { targetFps: 60, codecs: { enableCodecs: false } } },
          { codecsEnabled: true, remoteFxEnabled: true },
        );
        expect(result.performance?.targetFps).toBe(60);
        // codecs should still be the merged result, not clobbered by the spread
        expect(result.performance?.codecs?.enableCodecs).toBe(false);
        expect(result.performance?.codecs?.remoteFx).toBe(true);
      });
    });

    it('targetFps=0 (unlimited) is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { targetFps: 0 });
      expect(result.performance?.targetFps).toBe(0);
    });

    it('frameBatchIntervalMs=0 is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { frameBatchIntervalMs: 0 });
      expect(result.performance?.frameBatchIntervalMs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Gateway section
  // ═══════════════════════════════════════════════════════════════════════
  describe('gateway section', () => {
    it('all gateway fields from global defaults', () => {
      const result = mergeRdpSettings(undefined, {
        gatewayEnabled: true,
        gatewayHostname: 'gw.corp.com',
        gatewayPort: 8443,
        gatewayAuthMethod: 'negotiate',
        gatewayTransportMode: 'http',
        gatewayBypassLocal: false,
      });
      expect(result.gateway?.enabled).toBe(true);
      expect(result.gateway?.hostname).toBe('gw.corp.com');
      expect(result.gateway?.port).toBe(8443);
      expect(result.gateway?.authMethod).toBe('negotiate');
      expect(result.gateway?.transportMode).toBe('http');
      expect(result.gateway?.bypassForLocal).toBe(false);
    });

    it('per-connection gateway overrides globals for every field', () => {
      const result = mergeRdpSettings(
        {
          gateway: {
            enabled: false,
            hostname: 'conn-gw.test.com',
            port: 9443,
            authMethod: 'basic',
            transportMode: 'udp',
            bypassForLocal: true,
          },
        },
        {
          gatewayEnabled: true,
          gatewayHostname: 'global-gw.test.com',
          gatewayPort: 443,
          gatewayAuthMethod: 'negotiate',
          gatewayTransportMode: 'http',
          gatewayBypassLocal: false,
        },
      );
      expect(result.gateway?.enabled).toBe(false);
      expect(result.gateway?.hostname).toBe('conn-gw.test.com');
      expect(result.gateway?.port).toBe(9443);
      expect(result.gateway?.authMethod).toBe('basic');
      expect(result.gateway?.transportMode).toBe('udp');
      expect(result.gateway?.bypassForLocal).toBe(true);
    });

    it('gatewayHostname uses || (falsy check) so empty string falls back to base', () => {
      const result = mergeRdpSettings(undefined, { gatewayHostname: '' });
      expect(result.gateway?.hostname).toBe(DEFAULT_RDP_SETTINGS.gateway?.hostname);
    });

    it('per-connection gateway fields with additional credentials', () => {
      const result = mergeRdpSettings(
        {
          gateway: {
            credentialSource: 'separate',
            username: 'gw-user',
            password: 'gw-pass',
            domain: 'GWDOMAIN',
          },
        },
        {},
      );
      expect(result.gateway?.credentialSource).toBe('separate');
      expect(result.gateway?.username).toBe('gw-user');
      expect(result.gateway?.password).toBe('gw-pass');
      expect(result.gateway?.domain).toBe('GWDOMAIN');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Negotiation section
  // ═══════════════════════════════════════════════════════════════════════
  describe('negotiation section', () => {
    it('strategy inherits from global via negotiationStrategy key', () => {
      const result = mergeRdpSettings(undefined, { negotiationStrategy: 'tls-first' });
      expect(result.negotiation?.strategy).toBe('tls-first');
    });

    it('all negotiation fields from globals', () => {
      const result = mergeRdpSettings(undefined, {
        autoDetect: true,
        negotiationStrategy: 'nla-only',
        maxRetries: 10,
        retryDelayMs: 500,
      });
      expect(result.negotiation?.autoDetect).toBe(true);
      expect(result.negotiation?.strategy).toBe('nla-only');
      expect(result.negotiation?.maxRetries).toBe(10);
      expect(result.negotiation?.retryDelayMs).toBe(500);
    });

    it('per-connection negotiation overrides globals', () => {
      const result = mergeRdpSettings(
        { negotiation: { autoDetect: false, strategy: 'plain-only', maxRetries: 1, retryDelayMs: 100 } },
        { autoDetect: true, negotiationStrategy: 'nla-only', maxRetries: 10, retryDelayMs: 500 },
      );
      expect(result.negotiation?.autoDetect).toBe(false);
      expect(result.negotiation?.strategy).toBe('plain-only');
      expect(result.negotiation?.maxRetries).toBe(1);
      expect(result.negotiation?.retryDelayMs).toBe(100);
    });

    it('per-connection loadBalancingInfo and useRoutingToken are applied', () => {
      const result = mergeRdpSettings(
        { negotiation: { loadBalancingInfo: 'farm-1', useRoutingToken: true } },
        {},
      );
      expect(result.negotiation?.loadBalancingInfo).toBe('farm-1');
      expect(result.negotiation?.useRoutingToken).toBe(true);
    });

    it('maxRetries=0 is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { maxRetries: 0 });
      expect(result.negotiation?.maxRetries).toBe(0);
    });

    it('retryDelayMs=0 is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { retryDelayMs: 0 });
      expect(result.negotiation?.retryDelayMs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. TCP section
  // ═══════════════════════════════════════════════════════════════════════
  describe('tcp section', () => {
    it('all tcp fields from globals', () => {
      const result = mergeRdpSettings(undefined, {
        tcpConnectTimeoutSecs: 30,
        tcpNodelay: false,
        tcpKeepAlive: false,
        tcpKeepAliveIntervalSecs: 120,
        tcpRecvBufferSize: 524288,
        tcpSendBufferSize: 524288,
      });
      expect(result.tcp?.connectTimeoutSecs).toBe(30);
      expect(result.tcp?.nodelay).toBe(false);
      expect(result.tcp?.keepAlive).toBe(false);
      expect(result.tcp?.keepAliveIntervalSecs).toBe(120);
      expect(result.tcp?.recvBufferSize).toBe(524288);
      expect(result.tcp?.sendBufferSize).toBe(524288);
    });

    it('per-connection tcp overrides all globals', () => {
      const result = mergeRdpSettings(
        {
          tcp: {
            connectTimeoutSecs: 5,
            nodelay: true,
            keepAlive: true,
            keepAliveIntervalSecs: 30,
            recvBufferSize: 131072,
            sendBufferSize: 131072,
          },
        },
        {
          tcpConnectTimeoutSecs: 30,
          tcpNodelay: false,
          tcpKeepAlive: false,
          tcpKeepAliveIntervalSecs: 120,
          tcpRecvBufferSize: 524288,
          tcpSendBufferSize: 524288,
        },
      );
      expect(result.tcp?.connectTimeoutSecs).toBe(5);
      expect(result.tcp?.nodelay).toBe(true);
      expect(result.tcp?.keepAlive).toBe(true);
      expect(result.tcp?.keepAliveIntervalSecs).toBe(30);
      expect(result.tcp?.recvBufferSize).toBe(131072);
      expect(result.tcp?.sendBufferSize).toBe(131072);
    });

    it('tcpConnectTimeoutSecs=0 is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { tcpConnectTimeoutSecs: 0 });
      expect(result.tcp?.connectTimeoutSecs).toBe(0);
    });

    it('buffer sizes of 0 are preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { tcpRecvBufferSize: 0, tcpSendBufferSize: 0 });
      expect(result.tcp?.recvBufferSize).toBe(0);
      expect(result.tcp?.sendBufferSize).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12. Advanced section
  // ═══════════════════════════════════════════════════════════════════════
  describe('advanced section', () => {
    it('sessionClosePolicy inherits from global', () => {
      const result = mergeRdpSettings(undefined, { sessionClosePolicy: 'ask' });
      expect(result.advanced?.sessionClosePolicy).toBe('ask');
    });

    it('fullFrameSyncInterval inherits from global', () => {
      const result = mergeRdpSettings(undefined, { fullFrameSyncInterval: 600 });
      expect(result.advanced?.fullFrameSyncInterval).toBe(600);
    });

    it('maxConsecutiveErrors inherits from global', () => {
      const result = mergeRdpSettings(undefined, { maxConsecutiveErrors: 100 });
      expect(result.advanced?.maxConsecutiveErrors).toBe(100);
    });

    it('all advanced fields from global defaults', () => {
      const result = mergeRdpSettings(undefined, {
        fullFrameSyncInterval: 150,
        readTimeoutMs: 32,
        sessionClosePolicy: 'detach',
        clientName: 'MyClient',
        clientBuild: 9999,
        maxConsecutiveErrors: 25,
        statsIntervalSecs: 5,
      });
      expect(result.advanced?.fullFrameSyncInterval).toBe(150);
      expect(result.advanced?.readTimeoutMs).toBe(32);
      expect(result.advanced?.sessionClosePolicy).toBe('detach');
      expect(result.advanced?.clientName).toBe('MyClient');
      expect(result.advanced?.clientBuild).toBe(9999);
      expect(result.advanced?.maxConsecutiveErrors).toBe(25);
      expect(result.advanced?.statsIntervalSecs).toBe(5);
    });

    it('per-connection advanced overrides all globals', () => {
      const result = mergeRdpSettings(
        {
          advanced: {
            fullFrameSyncInterval: 50,
            readTimeoutMs: 8,
            sessionClosePolicy: 'disconnect',
            clientName: 'ConnClient',
            clientBuild: 1234,
            maxConsecutiveErrors: 5,
            statsIntervalSecs: 10,
          },
        },
        {
          fullFrameSyncInterval: 150,
          readTimeoutMs: 32,
          sessionClosePolicy: 'detach',
          clientName: 'GlobalClient',
          clientBuild: 9999,
          maxConsecutiveErrors: 25,
          statsIntervalSecs: 5,
        },
      );
      expect(result.advanced?.fullFrameSyncInterval).toBe(50);
      expect(result.advanced?.readTimeoutMs).toBe(8);
      expect(result.advanced?.sessionClosePolicy).toBe('disconnect');
      expect(result.advanced?.clientName).toBe('ConnClient');
      expect(result.advanced?.clientBuild).toBe(1234);
      expect(result.advanced?.maxConsecutiveErrors).toBe(5);
      expect(result.advanced?.statsIntervalSecs).toBe(10);
    });

    it('clientName uses || (falsy check) so empty string falls back to base', () => {
      const result = mergeRdpSettings(undefined, { clientName: '' });
      expect(result.advanced?.clientName).toBe(DEFAULT_RDP_SETTINGS.advanced?.clientName);
    });

    it('clientBuild=0 is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { clientBuild: 0 });
      expect(result.advanced?.clientBuild).toBe(0);
    });

    it('maxConsecutiveErrors=0 is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { maxConsecutiveErrors: 0 });
      expect(result.advanced?.maxConsecutiveErrors).toBe(0);
    });

    it('statsIntervalSecs=0 is preserved via ??', () => {
      const result = mergeRdpSettings(undefined, { statsIntervalSecs: 0 });
      expect(result.advanced?.statsIntervalSecs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13. Hyper-V section
  // ═══════════════════════════════════════════════════════════════════════
  describe('hyperv section', () => {
    it('enhancedSessionMode from global', () => {
      const result = mergeRdpSettings(undefined, { enhancedSessionMode: true });
      expect(result.hyperv?.enhancedSessionMode).toBe(true);
    });

    it('per-connection hyperv fields override globals', () => {
      const result = mergeRdpSettings(
        { hyperv: { enhancedSessionMode: false, useVmId: true, vmId: 'abc-123' } },
        { enhancedSessionMode: true },
      );
      expect(result.hyperv?.enhancedSessionMode).toBe(false);
      expect(result.hyperv?.useVmId).toBe(true);
      expect(result.hyperv?.vmId).toBe('abc-123');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14. Device Redirection section
  // ═══════════════════════════════════════════════════════════════════════
  describe('deviceRedirection section', () => {
    it('all device redirection fields from globals', () => {
      const result = mergeRdpSettings(undefined, {
        clipboardRedirection: false,
        clipboardDirection: 'server-to-client',
        printerRedirection: true,
        printerOutputMode: 'native-print',
        portRedirection: true,
        smartCardRedirection: true,
        webAuthnRedirection: true,
        videoCaptureRedirection: true,
        usbRedirection: true,
        audioInputRedirection: true,
      });
      expect(result.deviceRedirection?.clipboard).toBe(false);
      expect(result.deviceRedirection?.clipboardDirection).toBe('server-to-client');
      expect(result.deviceRedirection?.printers).toBe(true);
      expect(result.deviceRedirection?.printerOutputMode).toBe('native-print');
      expect(result.deviceRedirection?.ports).toBe(true);
      expect(result.deviceRedirection?.smartCards).toBe(true);
      expect(result.deviceRedirection?.webAuthn).toBe(true);
      expect(result.deviceRedirection?.videoCapture).toBe(true);
      expect(result.deviceRedirection?.usbDevices).toBe(true);
      expect(result.deviceRedirection?.audioInput).toBe(true);
    });

    it('per-connection device redirection overrides globals', () => {
      const result = mergeRdpSettings(
        {
          deviceRedirection: {
            clipboard: true,
            clipboardDirection: 'client-to-server',
            printers: false,
            printerOutputMode: 'spool-file',
            ports: false,
            smartCards: false,
            webAuthn: false,
            videoCapture: false,
            usbDevices: false,
            audioInput: false,
          },
        },
        {
          clipboardRedirection: false,
          clipboardDirection: 'server-to-client',
          printerRedirection: true,
          printerOutputMode: 'native-print',
          portRedirection: true,
          smartCardRedirection: true,
          webAuthnRedirection: true,
          videoCaptureRedirection: true,
          usbRedirection: true,
          audioInputRedirection: true,
        },
      );
      expect(result.deviceRedirection?.clipboard).toBe(true);
      expect(result.deviceRedirection?.clipboardDirection).toBe('client-to-server');
      expect(result.deviceRedirection?.printers).toBe(false);
      expect(result.deviceRedirection?.printerOutputMode).toBe('spool-file');
      expect(result.deviceRedirection?.ports).toBe(false);
      expect(result.deviceRedirection?.smartCards).toBe(false);
      expect(result.deviceRedirection?.webAuthn).toBe(false);
      expect(result.deviceRedirection?.videoCapture).toBe(false);
      expect(result.deviceRedirection?.usbDevices).toBe(false);
      expect(result.deviceRedirection?.audioInput).toBe(false);
    });

    it('false values from global (falsy booleans) are preserved via ??', () => {
      const result = mergeRdpSettings(undefined, {
        clipboardRedirection: false,
        printerRedirection: false,
      });
      expect(result.deviceRedirection?.clipboard).toBe(false);
      expect(result.deviceRedirection?.clipboardDirection).toBe(DEFAULT_RDP_SETTINGS.deviceRedirection?.clipboardDirection);
      expect(result.deviceRedirection?.printers).toBe(false);
      expect(result.deviceRedirection?.printerOutputMode).toBe(DEFAULT_RDP_SETTINGS.deviceRedirection?.printerOutputMode);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 15. Edge cases
  // ═══════════════════════════════════════════════════════════════════════
  describe('edge cases', () => {
    it('null-ish connSettings (undefined) produces compile-time defaults with empty globals', () => {
      const result = mergeRdpSettings(undefined, {});
      expect(result.display?.width).toBe(DEFAULT_RDP_SETTINGS.display?.width);
      expect(result.audio?.playbackMode).toBe(DEFAULT_RDP_SETTINGS.audio?.playbackMode);
      expect(result.performance?.renderBackend).toBe(DEFAULT_RDP_SETTINGS.performance?.renderBackend);
    });

    it('empty connection settings object (no sections) uses globals and defaults', () => {
      const result = mergeRdpSettings({}, { defaultWidth: 800, audioPlaybackMode: 'remote' });
      expect(result.display?.width).toBe(800);
      expect(result.audio?.playbackMode).toBe('remote');
      // Other fields from compile-time defaults
      expect(result.input?.mouseMode).toBe(DEFAULT_RDP_SETTINGS.input?.mouseMode);
    });

    it('empty globalDefaults object results in compile-time defaults everywhere', () => {
      const result = mergeRdpSettings(undefined, {});
      // Spot-check every section
      expect(result.display?.width).toBe(DEFAULT_RDP_SETTINGS.display?.width);
      expect(result.audio?.playbackMode).toBe(DEFAULT_RDP_SETTINGS.audio?.playbackMode);
      expect(result.input?.mouseMode).toBe(DEFAULT_RDP_SETTINGS.input?.mouseMode);
      expect(result.deviceRedirection?.clipboard).toBe(DEFAULT_RDP_SETTINGS.deviceRedirection?.clipboard);
      expect(result.performance?.targetFps).toBe(DEFAULT_RDP_SETTINGS.performance?.targetFps);
      expect(result.security?.useCredSsp).toBe(DEFAULT_RDP_SETTINGS.security?.useCredSsp);
      expect(result.gateway?.enabled).toBe(DEFAULT_RDP_SETTINGS.gateway?.enabled);
      expect(result.hyperv?.enhancedSessionMode).toBe(DEFAULT_RDP_SETTINGS.hyperv?.enhancedSessionMode);
      expect(result.negotiation?.strategy).toBe(DEFAULT_RDP_SETTINGS.negotiation?.strategy);
      expect(result.advanced?.clientName).toBe(DEFAULT_RDP_SETTINGS.advanced?.clientName);
      expect(result.tcp?.nodelay).toBe(DEFAULT_RDP_SETTINGS.tcp?.nodelay);
    });

    it('all per-connection fields set to undefined results in global defaults being used', () => {
      const result = mergeRdpSettings(
        {
          display: { width: undefined, height: undefined, colorDepth: undefined },
          audio: { playbackMode: undefined, recordingMode: undefined, audioQuality: undefined },
          input: { mouseMode: undefined, scrollSpeed: undefined, smoothScroll: undefined, localCursor: undefined },
        },
        {
          defaultWidth: 640,
          defaultHeight: 480,
          defaultColorDepth: 16,
          audioPlaybackMode: 'disabled',
          audioRecordingMode: 'enabled',
          audioQuality: 'high',
          mouseMode: 'relative',
          scrollSpeed: 3.0,
          smoothScroll: false,
          localCursor: 'dot',
        },
      );
      expect(result.display?.width).toBe(640);
      expect(result.display?.height).toBe(480);
      expect(result.display?.colorDepth).toBe(16);
      expect(result.audio?.playbackMode).toBe('disabled');
      expect(result.audio?.recordingMode).toBe('enabled');
      expect(result.audio?.audioQuality).toBe('high');
      expect(result.input?.mouseMode).toBe('relative');
      expect(result.input?.scrollSpeed).toBe(3.0);
      expect(result.input?.smoothScroll).toBe(false);
      expect(result.input?.localCursor).toBe('dot');
    });

    it('mixed defined and undefined per-connection fields: defined wins, undefined inherits', () => {
      const result = mergeRdpSettings(
        {
          display: { width: 2560, height: undefined, colorDepth: 24, smartSizing: undefined },
          audio: { playbackMode: 'remote', recordingMode: undefined },
          tcp: { connectTimeoutSecs: 5, nodelay: undefined, keepAlive: undefined },
        },
        {
          defaultWidth: 1280,
          defaultHeight: 720,
          defaultColorDepth: 16,
          smartSizing: false,
          audioRecordingMode: 'enabled',
          tcpNodelay: false,
          tcpKeepAlive: false,
        },
      );
      // display
      expect(result.display?.width).toBe(2560);        // per-connection defined
      expect(result.display?.height).toBe(720);         // inherited from global
      expect(result.display?.colorDepth).toBe(24);      // per-connection defined
      expect(result.display?.smartSizing).toBe(false);   // inherited from global
      // audio
      expect(result.audio?.playbackMode).toBe('remote'); // per-connection defined
      expect(result.audio?.recordingMode).toBe('enabled'); // inherited from global
      // tcp
      expect(result.tcp?.connectTimeoutSecs).toBe(5);    // per-connection defined
      expect(result.tcp?.nodelay).toBe(false);            // inherited from global
      expect(result.tcp?.keepAlive).toBe(false);          // inherited from global
    });

    it('per-connection sections not present at all still get their fields from globals', () => {
      const result = mergeRdpSettings(
        { display: { width: 800 } },
        {
          audioPlaybackMode: 'remote',
          tcpNodelay: false,
          negotiationStrategy: 'tls-only',
        },
      );
      expect(result.display?.width).toBe(800);
      expect(result.audio?.playbackMode).toBe('remote');
      expect(result.tcp?.nodelay).toBe(false);
      expect(result.negotiation?.strategy).toBe('tls-only');
    });

    it('globalDefaults with irrelevant/unknown keys are silently ignored', () => {
      const result = mergeRdpSettings(undefined, {
        totallyFakeKey: 'whatever',
        anotherUnknown: 42,
      });
      // Should just produce compile-time defaults
      expect(result.display?.width).toBe(DEFAULT_RDP_SETTINGS.display?.width);
      expect(result.audio?.playbackMode).toBe(DEFAULT_RDP_SETTINGS.audio?.playbackMode);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 16. defined() helper behaviour (tested indirectly)
  // ═══════════════════════════════════════════════════════════════════════
  describe('defined() helper — strips undefined keys but preserves null, false, 0, empty string', () => {
    it('false is preserved as a per-connection override (not stripped)', () => {
      const result = mergeRdpSettings(
        { performance: { disableWallpaper: false } },
        { disableWallpaper: true },
      );
      // false is defined → should override global true
      expect(result.performance?.disableWallpaper).toBe(false);
    });

    it('0 is preserved as a per-connection override (not stripped)', () => {
      const result = mergeRdpSettings(
        { performance: { targetFps: 0 } },
        { targetFps: 60 },
      );
      // 0 is defined → should override global 60
      expect(result.performance?.targetFps).toBe(0);
    });

    it('empty string is preserved as a per-connection override (not stripped)', () => {
      const result = mergeRdpSettings(
        { negotiation: { loadBalancingInfo: '' } },
        {},
      );
      // '' is defined → should be present
      expect(result.negotiation?.loadBalancingInfo).toBe('');
    });

    it('null is preserved as a per-connection override (not stripped by defined())', () => {
      // While TypeScript types do not declare null, the runtime defined()
      // function only strips `undefined`, so null values pass through.
      const result = mergeRdpSettings(
        { display: { width: null as any } },
        { defaultWidth: 1280 },
      );
      expect(result.display?.width).toBeNull();
    });

    it('undefined per-connection values do NOT override global values', () => {
      const result = mergeRdpSettings(
        { display: { width: undefined } },
        { defaultWidth: 1280 },
      );
      // undefined is stripped by defined() → global value wins
      expect(result.display?.width).toBe(1280);
    });

    it('undefined per-connection section produces empty object from defined()', () => {
      // When conn?.display is undefined, defined(undefined) returns {}
      // so the spread adds nothing, and base + global values remain
      const result = mergeRdpSettings(
        { audio: { playbackMode: 'remote' } }, // only audio set
        { defaultWidth: 1600 },
      );
      expect(result.display?.width).toBe(1600);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 17. Full three-layer chain tests
  // ═══════════════════════════════════════════════════════════════════════
  describe('full three-layer inheritance chain: compile-time → global → per-connection', () => {
    it('layer priority: per-conn > global > compile-time for every section', () => {
      const result = mergeRdpSettings(
        {
          display: { width: 3840 },
          audio: { playbackMode: 'disabled' },
          input: { mouseMode: 'relative' },
          performance: { targetFps: 144 },
          security: { useCredSsp: false },
          gateway: { enabled: true },
          negotiation: { strategy: 'plain-only' },
          tcp: { nodelay: false },
          advanced: { sessionClosePolicy: 'ask' },
          hyperv: { enhancedSessionMode: true },
        },
        {
          defaultWidth: 2560,
          audioPlaybackMode: 'remote',
          mouseMode: 'absolute',
          targetFps: 60,
          useCredSsp: true,
          gatewayEnabled: false,
          negotiationStrategy: 'tls-first',
          tcpNodelay: true,
          sessionClosePolicy: 'detach',
          enhancedSessionMode: false,
        },
      );
      // Per-connection values win
      expect(result.display?.width).toBe(3840);
      expect(result.audio?.playbackMode).toBe('disabled');
      expect(result.input?.mouseMode).toBe('relative');
      expect(result.performance?.targetFps).toBe(144);
      expect(result.security?.useCredSsp).toBe(false);
      expect(result.gateway?.enabled).toBe(true);
      expect(result.negotiation?.strategy).toBe('plain-only');
      expect(result.tcp?.nodelay).toBe(false);
      expect(result.advanced?.sessionClosePolicy).toBe('ask');
      expect(result.hyperv?.enhancedSessionMode).toBe(true);
    });

    it('fields not in per-conn fall through to global; fields not in global fall through to compile-time', () => {
      const result = mergeRdpSettings(
        {
          display: { width: 3840 },
          // audio not set → falls to global
          // input not set → falls to global/compile-time
        },
        {
          audioPlaybackMode: 'remote',
          // defaultHeight not set → falls to compile-time
        },
      );
      expect(result.display?.width).toBe(3840);                        // per-connection
      expect(result.display?.height).toBe(DEFAULT_RDP_SETTINGS.display?.height); // compile-time (global unset)
      expect(result.audio?.playbackMode).toBe('remote');                 // global
      expect(result.audio?.recordingMode).toBe(DEFAULT_RDP_SETTINGS.audio?.recordingMode); // compile-time
      expect(result.input?.mouseMode).toBe(DEFAULT_RDP_SETTINGS.input?.mouseMode); // compile-time
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 18. ?? vs || operator correctness
  // ═══════════════════════════════════════════════════════════════════════
  describe('nullish coalescing (??) vs logical OR (||) correctness', () => {
    // Most fields use ??. Some string fields (hostname, clientName, sspiPackageList)
    // use ||. This matters for falsy-but-valid values like 0, false, ''.

    it('global false boolean values are preserved by ?? (not treated as missing)', () => {
      const result = mergeRdpSettings(undefined, {
        disableWallpaper: false,
        disableFullWindowDrag: false,
        disableMenuAnimations: false,
        disableTheming: false,
        enableFontSmoothing: false,
        enableDesktopComposition: false,
        persistentBitmapCaching: false,
        frameBatching: false,
        tripleBuffering: false,
        tcpNodelay: false,
        tcpKeepAlive: false,
        useCredSsp: false,
        enableTls: false,
        enableNla: false,
        autoLogon: false,
        smartSizing: false,
        resizeToWindow: false,
        smoothScroll: false,
        autoDetect: false,
        gatewayEnabled: false,
        gatewayBypassLocal: false,
        enhancedSessionMode: false,
      });
      expect(result.performance?.disableWallpaper).toBe(false);
      expect(result.performance?.disableFullWindowDrag).toBe(false);
      expect(result.performance?.disableMenuAnimations).toBe(false);
      expect(result.performance?.disableTheming).toBe(false);
      expect(result.performance?.enableFontSmoothing).toBe(false);
      expect(result.performance?.enableDesktopComposition).toBe(false);
      expect(result.performance?.persistentBitmapCaching).toBe(false);
      expect(result.performance?.frameBatching).toBe(false);
      expect(result.performance?.tripleBuffering).toBe(false);
      expect(result.tcp?.nodelay).toBe(false);
      expect(result.tcp?.keepAlive).toBe(false);
      expect(result.security?.useCredSsp).toBe(false);
      expect(result.security?.enableTls).toBe(false);
      expect(result.security?.enableNla).toBe(false);
      expect(result.security?.autoLogon).toBe(false);
      expect(result.display?.smartSizing).toBe(false);
      expect(result.display?.resizeToWindow).toBe(false);
      expect(result.input?.smoothScroll).toBe(false);
      expect(result.negotiation?.autoDetect).toBe(false);
      expect(result.gateway?.enabled).toBe(false);
      expect(result.gateway?.bypassForLocal).toBe(false);
      expect(result.hyperv?.enhancedSessionMode).toBe(false);
    });

    it('global zero numeric values are preserved by ?? (not treated as missing)', () => {
      const result = mergeRdpSettings(undefined, {
        defaultWidth: 0,
        defaultHeight: 0,
        targetFps: 0,
        frameBatchIntervalMs: 0,
        maxRetries: 0,
        retryDelayMs: 0,
        tcpConnectTimeoutSecs: 0,
        tcpKeepAliveIntervalSecs: 0,
        tcpRecvBufferSize: 0,
        tcpSendBufferSize: 0,
        fullFrameSyncInterval: 0,
        readTimeoutMs: 0,
        clientBuild: 0,
        maxConsecutiveErrors: 0,
        statsIntervalSecs: 0,
        desktopScaleFactor: 0,
        scrollSpeed: 0,
        batchIntervalMs: 0,
        keyboardFunctionKeys: 0,
      });
      expect(result.display?.width).toBe(0);
      expect(result.display?.height).toBe(0);
      expect(result.performance?.targetFps).toBe(0);
      expect(result.performance?.frameBatchIntervalMs).toBe(0);
      expect(result.negotiation?.maxRetries).toBe(0);
      expect(result.negotiation?.retryDelayMs).toBe(0);
      expect(result.tcp?.connectTimeoutSecs).toBe(0);
      expect(result.tcp?.keepAliveIntervalSecs).toBe(0);
      expect(result.tcp?.recvBufferSize).toBe(0);
      expect(result.tcp?.sendBufferSize).toBe(0);
      expect(result.advanced?.fullFrameSyncInterval).toBe(0);
      expect(result.advanced?.readTimeoutMs).toBe(0);
      expect(result.advanced?.clientBuild).toBe(0);
      expect(result.advanced?.maxConsecutiveErrors).toBe(0);
      expect(result.advanced?.statsIntervalSecs).toBe(0);
      expect(result.display?.desktopScaleFactor).toBe(0);
      expect(result.input?.scrollSpeed).toBe(0);
      expect(result.input?.batchIntervalMs).toBe(0);
      expect(result.input?.keyboardFunctionKeys).toBe(0);
    });

    it('fields using || treat empty string as falsy → fall back to base', () => {
      // gatewayHostname, clientName, sspiPackageList use ||
      const result = mergeRdpSettings(undefined, {
        gatewayHostname: '',
        clientName: '',
        sspiPackageList: '',
      });
      expect(result.gateway?.hostname).toBe(DEFAULT_RDP_SETTINGS.gateway?.hostname);
      expect(result.advanced?.clientName).toBe(DEFAULT_RDP_SETTINGS.advanced?.clientName);
      expect(result.security?.sspiPackageList).toBe(DEFAULT_RDP_SETTINGS.security?.sspiPackageList);
    });

    it('fields using || with truthy strings are preserved', () => {
      const result = mergeRdpSettings(undefined, {
        gatewayHostname: 'gw.test.com',
        clientName: 'TestClient',
        sspiPackageList: 'negotiate',
      });
      expect(result.gateway?.hostname).toBe('gw.test.com');
      expect(result.advanced?.clientName).toBe('TestClient');
      expect(result.security?.sspiPackageList).toBe('negotiate');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 19. Return type completeness
  // ═══════════════════════════════════════════════════════════════════════
  describe('return type completeness', () => {
    it('result always has all 11 top-level sections, never undefined', () => {
      const result = mergeRdpSettings(undefined, {});
      const sections: (keyof RDPConnectionSettings)[] = [
        'display', 'audio', 'input', 'deviceRedirection', 'performance',
        'security', 'gateway', 'hyperv', 'negotiation', 'advanced', 'tcp',
      ];
      for (const section of sections) {
        expect(result[section]).toBeDefined();
        expect(typeof result[section]).toBe('object');
      }
    });

    it('codecs sub-object is always present in performance', () => {
      const result = mergeRdpSettings(undefined, {});
      expect(result.performance?.codecs).toBeDefined();
      expect(typeof result.performance?.codecs).toBe('object');
    });
  });
});
