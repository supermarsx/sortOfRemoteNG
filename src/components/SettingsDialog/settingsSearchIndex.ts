export interface SettingSearchEntry {
  key: string;
  label: string;
  description: string;
  tags: string[];
  section: string;
  sectionLabel: string;
}

export const SETTINGS_SEARCH_INDEX: SettingSearchEntry[] = [
  // ─── General ────────────────────────────────────────────────────
  { key: 'language', label: 'Language', description: 'Application display language', tags: ['locale', 'i18n', 'translation', 'english', 'spanish', 'french'], section: 'general', sectionLabel: 'General' },
  { key: 'autoSaveEnabled', label: 'Auto Save', description: 'Automatically save connections', tags: ['save', 'persist', 'automatic'], section: 'general', sectionLabel: 'General' },
  { key: 'autoSaveIntervalMinutes', label: 'Auto Save Interval', description: 'Minutes between auto saves', tags: ['save interval', 'timer'], section: 'general', sectionLabel: 'General' },
  { key: 'warnOnClose', label: 'Warn on Close', description: 'Show warning when closing tabs', tags: ['close warning', 'confirm close'], section: 'general', sectionLabel: 'General' },
  { key: 'warnOnExit', label: 'Warn on Exit', description: 'Show warning when exiting application', tags: ['exit warning', 'confirm exit', 'quit'], section: 'general', sectionLabel: 'General' },
  { key: 'warnOnDetachClose', label: 'Warn on Detach Close', description: 'Warn when closing detached windows', tags: ['detach', 'popup', 'floating'], section: 'general', sectionLabel: 'General' },
  { key: 'quickConnectHistoryEnabled', label: 'Quick Connect History', description: 'Remember quick connect entries', tags: ['history', 'recent', 'quick connect'], section: 'general', sectionLabel: 'General' },

  // ─── Behavior ───────────────────────────────────────────────────
  { key: 'singleClickConnect', label: 'Single Click Connect', description: 'Connect on single click', tags: ['click', 'one click', 'mouse'], section: 'behavior', sectionLabel: 'Behavior' },
  { key: 'singleClickDisconnect', label: 'Single Click Disconnect', description: 'Disconnect on single click', tags: ['click', 'disconnect'], section: 'behavior', sectionLabel: 'Behavior' },
  { key: 'doubleClickRename', label: 'Double Click Rename', description: 'Rename connection on double click', tags: ['rename', 'double click', 'edit name'], section: 'behavior', sectionLabel: 'Behavior' },
  { key: 'singleWindowMode', label: 'Single Window Mode', description: 'Only allow one application window', tags: ['window', 'single instance'], section: 'behavior', sectionLabel: 'Behavior' },
  { key: 'singleConnectionMode', label: 'Single Connection Mode', description: 'Only one active connection at a time', tags: ['connection', 'exclusive'], section: 'behavior', sectionLabel: 'Behavior' },
  { key: 'reconnectOnReload', label: 'Reconnect on Reload', description: 'Restore connections after reload', tags: ['reconnect', 'restore', 'refresh'], section: 'behavior', sectionLabel: 'Behavior' },
  { key: 'enableAutocomplete', label: 'Autocomplete', description: 'Enable input autocomplete', tags: ['auto complete', 'suggestions'], section: 'behavior', sectionLabel: 'Behavior' },

  // ─── Startup ────────────────────────────────────────────────────
  { key: 'startMinimized', label: 'Start Minimized', description: 'Start application minimized', tags: ['minimize', 'hidden', 'tray'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'startMaximized', label: 'Start Maximized', description: 'Start application maximized', tags: ['maximize', 'fullscreen'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'startWithSystem', label: 'Start with System', description: 'Launch on system startup', tags: ['boot', 'autostart', 'login', 'startup'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'reconnectPreviousSessions', label: 'Reconnect Previous Sessions', description: 'Restore previous sessions on start', tags: ['restore', 'sessions', 'remember'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'autoOpenLastCollection', label: 'Auto Open Last Collection', description: 'Open last used collection on start', tags: ['collection', 'recent', 'last used'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'minimizeToTray', label: 'Minimize to Tray', description: 'Minimize to system tray', tags: ['tray', 'system tray', 'minimize'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'closeToTray', label: 'Close to Tray', description: 'Close to system tray instead of exiting', tags: ['tray', 'close', 'background'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'showTrayIcon', label: 'Show Tray Icon', description: 'Show icon in system tray', tags: ['tray', 'icon', 'notification area'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'welcomeScreenTitle', label: 'Welcome Screen Title', description: 'Custom welcome screen title', tags: ['welcome', 'greeting', 'home'], section: 'startup', sectionLabel: 'Startup' },
  { key: 'welcomeScreenMessage', label: 'Welcome Screen Message', description: 'Custom welcome screen message', tags: ['welcome', 'message', 'motd'], section: 'startup', sectionLabel: 'Startup' },

  // ─── Theme ──────────────────────────────────────────────────────
  { key: 'theme', label: 'Theme', description: 'Color theme', tags: ['dark mode', 'light mode', 'appearance', 'colors', 'skin'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'colorScheme', label: 'Color Scheme', description: 'Accent color scheme', tags: ['colors', 'palette', 'accent'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'primaryAccentColor', label: 'Primary Accent Color', description: 'Primary accent color', tags: ['color', 'accent', 'tint'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'backgroundGlowEnabled', label: 'Background Glow', description: 'Enable background glow effect', tags: ['glow', 'ambient', 'effect'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'windowTransparencyEnabled', label: 'Window Transparency', description: 'Enable window transparency', tags: ['transparent', 'opacity', 'glass', 'blur'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'windowTransparencyOpacity', label: 'Transparency Opacity', description: 'Window transparency level', tags: ['opacity', 'alpha', 'transparent'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'customCss', label: 'Custom CSS', description: 'Custom CSS styles', tags: ['css', 'style', 'stylesheet', 'custom'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'animationsEnabled', label: 'Animations', description: 'Enable UI animations', tags: ['animation', 'motion', 'transitions'], section: 'theme', sectionLabel: 'Theme' },
  { key: 'reduceMotion', label: 'Reduce Motion', description: 'Reduce UI animations for accessibility', tags: ['accessibility', 'a11y', 'motion'], section: 'theme', sectionLabel: 'Theme' },

  // ─── Layout ─────────────────────────────────────────────────────
  { key: 'persistWindowSize', label: 'Persist Window Size', description: 'Remember window size', tags: ['window', 'size', 'remember'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'persistWindowPosition', label: 'Persist Window Position', description: 'Remember window position', tags: ['window', 'position', 'remember'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'persistSidebarWidth', label: 'Persist Sidebar Width', description: 'Remember sidebar width', tags: ['sidebar', 'width', 'panel'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'enableTabReorder', label: 'Tab Reorder', description: 'Allow drag-to-reorder tabs', tags: ['tabs', 'drag', 'reorder', 'sort'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'middleClickCloseTab', label: 'Middle Click Close Tab', description: 'Close tabs with middle mouse click', tags: ['middle click', 'close tab', 'mouse'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showQuickConnectIcon', label: 'Quick Connect Icon', description: 'Show quick connect in toolbar', tags: ['toolbar', 'icon', 'quick connect'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showSettingsIcon', label: 'Settings Icon', description: 'Show settings in toolbar', tags: ['toolbar', 'icon', 'settings'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showProxyMenuIcon', label: 'Proxy Menu Icon', description: 'Show proxy menu in toolbar', tags: ['toolbar', 'icon', 'proxy', 'vpn'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showWolIcon', label: 'Wake-on-LAN Icon', description: 'Show Wake-on-LAN in toolbar', tags: ['toolbar', 'icon', 'wol', 'wake'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showBulkSSHIcon', label: 'Bulk SSH Icon', description: 'Show Bulk SSH in toolbar', tags: ['toolbar', 'icon', 'bulk', 'ssh'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showScriptManagerIcon', label: 'Script Manager Icon', description: 'Show Script Manager in toolbar', tags: ['toolbar', 'icon', 'script'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showMacroManagerIcon', label: 'Macro Manager Icon', description: 'Show Macro Manager in toolbar', tags: ['toolbar', 'icon', 'macro', 'recording'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showRdpSessionsIcon', label: 'RDP Sessions Icon', description: 'Show RDP Sessions in toolbar', tags: ['toolbar', 'icon', 'rdp'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showErrorLogBar', label: 'Error Log Bar', description: 'Show error log toggle in toolbar', tags: ['toolbar', 'icon', 'error', 'log', 'debug'], section: 'layout', sectionLabel: 'Layout' },
  { key: 'showPerformanceMonitorIcon', label: 'Performance Monitor Icon', description: 'Show Performance Monitor in toolbar', tags: ['toolbar', 'icon', 'performance', 'monitor'], section: 'layout', sectionLabel: 'Layout' },

  // ─── Security ───────────────────────────────────────────────────
  { key: 'encryptionAlgorithm', label: 'Encryption Algorithm', description: 'Encryption algorithm for stored data', tags: ['encryption', 'aes', 'crypto', 'cipher'], section: 'security', sectionLabel: 'Security' },
  { key: 'blockCipherMode', label: 'Block Cipher Mode', description: 'Block cipher mode of operation', tags: ['cipher', 'gcm', 'cbc', 'encryption'], section: 'security', sectionLabel: 'Security' },
  { key: 'keyDerivationIterations', label: 'Key Derivation Iterations', description: 'PBKDF2 iterations for key derivation', tags: ['pbkdf2', 'iterations', 'password', 'key'], section: 'security', sectionLabel: 'Security' },
  { key: 'totpEnabled', label: 'TOTP Enabled', description: 'Enable TOTP two-factor authentication', tags: ['2fa', 'totp', 'authenticator', 'two factor', 'mfa'], section: 'security', sectionLabel: 'Security' },
  { key: 'totpIssuer', label: 'TOTP Issuer', description: 'Default TOTP issuer name', tags: ['2fa', 'totp', 'issuer'], section: 'security', sectionLabel: 'Security' },
  { key: 'totpDigits', label: 'TOTP Digits', description: 'Number of TOTP digits', tags: ['2fa', 'totp', 'digits', 'length'], section: 'security', sectionLabel: 'Security' },
  { key: 'totpPeriod', label: 'TOTP Period', description: 'TOTP code refresh period in seconds', tags: ['2fa', 'totp', 'period', 'interval', 'refresh'], section: 'security', sectionLabel: 'Security' },
  { key: 'totpAlgorithm', label: 'TOTP Algorithm', description: 'TOTP hash algorithm', tags: ['2fa', 'totp', 'algorithm', 'sha', 'hash'], section: 'security', sectionLabel: 'Security' },

  // ─── Trust ──────────────────────────────────────────────────────
  { key: 'tlsTrustPolicy', label: 'TLS Trust Policy', description: 'TLS certificate trust policy', tags: ['tls', 'ssl', 'certificate', 'trust', 'https'], section: 'trust', sectionLabel: 'Trust & Verification' },
  { key: 'sshTrustPolicy', label: 'SSH Trust Policy', description: 'SSH host key trust policy', tags: ['ssh', 'host key', 'trust', 'tofu', 'fingerprint'], section: 'trust', sectionLabel: 'Trust & Verification' },
  { key: 'showTrustIdentityInfo', label: 'Show Trust Info', description: 'Show trust identity information', tags: ['trust', 'identity', 'info'], section: 'trust', sectionLabel: 'Trust & Verification' },
  { key: 'certExpiryWarningDays', label: 'Certificate Expiry Warning', description: 'Days before certificate expiry to warn', tags: ['certificate', 'expiry', 'warning', 'ssl'], section: 'trust', sectionLabel: 'Trust & Verification' },

  // ─── Performance ────────────────────────────────────────────────
  { key: 'maxConcurrentConnections', label: 'Max Concurrent Connections', description: 'Maximum simultaneous connections', tags: ['limit', 'concurrent', 'connections', 'parallel'], section: 'performance', sectionLabel: 'Performance' },
  { key: 'connectionTimeout', label: 'Connection Timeout', description: 'Connection timeout in milliseconds', tags: ['timeout', 'connect', 'wait'], section: 'performance', sectionLabel: 'Performance' },
  { key: 'retryAttempts', label: 'Retry Attempts', description: 'Number of connection retry attempts', tags: ['retry', 'reconnect', 'attempts'], section: 'performance', sectionLabel: 'Performance' },
  { key: 'retryDelay', label: 'Retry Delay', description: 'Delay between retry attempts', tags: ['retry', 'delay', 'wait'], section: 'performance', sectionLabel: 'Performance' },

  // ─── RDP Defaults ───────────────────────────────────────────────
  { key: 'rdpDefaults', label: 'RDP Defaults', description: 'Default RDP connection settings', tags: ['rdp', 'remote desktop', 'default', 'resolution', 'color depth'], section: 'rdpDefaults', sectionLabel: 'RDP Defaults' },

  // ─── Backup ─────────────────────────────────────────────────────
  { key: 'backup', label: 'Backup', description: 'Backup configuration', tags: ['backup', 'save', 'export', 'restore', 'schedule'], section: 'backup', sectionLabel: 'Backup' },

  // ─── Cloud Sync ─────────────────────────────────────────────────
  { key: 'cloudSync', label: 'Cloud Sync', description: 'Cloud synchronization settings', tags: ['cloud', 'sync', 'remote', 'github', 'gist', 's3'], section: 'cloudSync', sectionLabel: 'Cloud Sync' },

  // ─── Proxy ──────────────────────────────────────────────────────
  { key: 'globalProxy', label: 'Global Proxy', description: 'Global proxy settings', tags: ['proxy', 'socks', 'http proxy', 'tunnel'], section: 'proxy', sectionLabel: 'Proxy' },

  // ─── Recording ──────────────────────────────────────────────────
  { key: 'recording.autoRecordSessions', label: 'Auto Record Sessions', description: 'Automatically record SSH sessions', tags: ['record', 'auto', 'capture', 'session'], section: 'recording', sectionLabel: 'Recording' },
  { key: 'recording.recordInput', label: 'Record Input', description: 'Record keyboard input in sessions', tags: ['record', 'input', 'keystrokes', 'capture'], section: 'recording', sectionLabel: 'Recording' },
  { key: 'recording.maxRecordingDurationMinutes', label: 'Max Recording Duration', description: 'Maximum recording duration in minutes', tags: ['recording', 'duration', 'limit', 'time'], section: 'recording', sectionLabel: 'Recording' },
  { key: 'recording.maxStoredRecordings', label: 'Max Stored Recordings', description: 'Maximum number of stored recordings', tags: ['recording', 'storage', 'limit', 'count'], section: 'recording', sectionLabel: 'Recording' },
  { key: 'recording.defaultExportFormat', label: 'Default Export Format', description: 'Default recording export format', tags: ['export', 'format', 'asciicast', 'script', 'json'], section: 'recording', sectionLabel: 'Recording' },

  // ─── Macros ─────────────────────────────────────────────────────
  { key: 'macros.defaultStepDelayMs', label: 'Default Step Delay', description: 'Default delay between macro steps', tags: ['macro', 'delay', 'speed', 'replay'], section: 'macros', sectionLabel: 'Macros' },
  { key: 'macros.confirmBeforeReplay', label: 'Confirm Before Replay', description: 'Show confirmation before replaying macros', tags: ['macro', 'confirm', 'replay', 'safety'], section: 'macros', sectionLabel: 'Macros' },
  { key: 'macros.maxMacroSteps', label: 'Max Macro Steps', description: 'Maximum steps per macro', tags: ['macro', 'limit', 'steps', 'count'], section: 'macros', sectionLabel: 'Macros' },

  // ─── SSH Terminal ───────────────────────────────────────────────
  { key: 'sshTerminal', label: 'SSH Terminal', description: 'SSH terminal configuration', tags: ['ssh', 'terminal', 'font', 'cursor', 'scrollback', 'xterm'], section: 'sshTerminal', sectionLabel: 'SSH Terminal' },
  { key: 'sshTerminal.fontFamily', label: 'Terminal Font', description: 'SSH terminal font family', tags: ['font', 'typeface', 'monospace', 'terminal'], section: 'sshTerminal', sectionLabel: 'SSH Terminal' },
  { key: 'sshTerminal.fontSize', label: 'Terminal Font Size', description: 'SSH terminal font size', tags: ['font size', 'text size', 'terminal'], section: 'sshTerminal', sectionLabel: 'SSH Terminal' },
  { key: 'sshTerminal.cursorStyle', label: 'Cursor Style', description: 'Terminal cursor style', tags: ['cursor', 'block', 'underline', 'bar'], section: 'sshTerminal', sectionLabel: 'SSH Terminal' },
  { key: 'sshTerminal.scrollback', label: 'Scrollback Lines', description: 'Terminal scrollback buffer size', tags: ['scrollback', 'buffer', 'history', 'lines'], section: 'sshTerminal', sectionLabel: 'SSH Terminal' },

  // ─── Web Browser ────────────────────────────────────────────────
  { key: 'proxyKeepaliveEnabled', label: 'Proxy Keepalive', description: 'Enable proxy connection keepalive', tags: ['proxy', 'keepalive', 'ping', 'connection'], section: 'webBrowser', sectionLabel: 'Web Browser' },
  { key: 'proxyKeepaliveIntervalSeconds', label: 'Keepalive Interval', description: 'Proxy keepalive interval in seconds', tags: ['proxy', 'keepalive', 'interval', 'timer'], section: 'webBrowser', sectionLabel: 'Web Browser' },
  { key: 'confirmDeleteAllBookmarks', label: 'Confirm Delete Bookmarks', description: 'Confirm before deleting all bookmarks', tags: ['bookmarks', 'delete', 'confirm'], section: 'webBrowser', sectionLabel: 'Web Browser' },

  // ─── Backend ────────────────────────────────────────────────────
  { key: 'backendConfig', label: 'Backend Config', description: 'Backend service configuration', tags: ['backend', 'service', 'server', 'config'], section: 'backend', sectionLabel: 'Backend' },

  // ─── Advanced ───────────────────────────────────────────────────
  { key: 'tabGrouping', label: 'Tab Grouping', description: 'Tab grouping strategy', tags: ['tabs', 'group', 'organize'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'enableTabDetachment', label: 'Tab Detachment', description: 'Allow tabs to be detached to separate windows', tags: ['tabs', 'detach', 'floating', 'popup', 'window'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'enableZoom', label: 'Zoom', description: 'Enable zoom controls', tags: ['zoom', 'scale', 'magnify'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'enableStatusChecking', label: 'Status Checking', description: 'Enable connection status checking', tags: ['status', 'ping', 'health', 'monitoring'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'statusCheckInterval', label: 'Status Check Interval', description: 'Interval for status checks', tags: ['status', 'interval', 'poll'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'networkDiscovery', label: 'Network Discovery', description: 'Network discovery settings', tags: ['network', 'scan', 'discover', 'subnet'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'enableActionLog', label: 'Action Log', description: 'Enable action logging', tags: ['log', 'audit', 'history', 'actions'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'logLevel', label: 'Log Level', description: 'Logging verbosity level', tags: ['log', 'debug', 'verbose', 'level'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'wolEnabled', label: 'Wake-on-LAN', description: 'Enable Wake-on-LAN', tags: ['wol', 'wake', 'lan', 'power'], section: 'advanced', sectionLabel: 'Advanced' },
  { key: 'exportEncryption', label: 'Export Encryption', description: 'Encrypt exported data', tags: ['export', 'encryption', 'secure', 'password'], section: 'advanced', sectionLabel: 'Advanced' },
];
