export const S = {
  // App shell
  appShell: '[data-testid="app-shell"]',
  splashScreen: '[data-testid="splash-screen"]',
  welcomeScreen: '[data-testid="welcome-screen"]',
  criticalError: '[data-testid="critical-error-screen"]',
  errorBoundary: '[data-testid="error-boundary-fallback"]',

  // Toolbar
  toolbar: '[data-testid="toolbar"]',
  toolbarNewConnection: '[data-testid="toolbar-new-connection"]',
  toolbarSettings: '[data-testid="toolbar-settings"]',
  toolbarImportExport: '[data-testid="toolbar-import-export"]',
  toolbarQuickConnect: '[data-testid="toolbar-quick-connect"]',
  toolbarCollection: '[data-testid="toolbar-collection"]',

  // Window controls
  windowMinimize: '[data-testid="window-minimize"]',
  windowMaximize: '[data-testid="window-maximize"]',
  windowClose: '[data-testid="window-close"]',

  // Sidebar
  sidebar: '[data-testid="sidebar"]',
  sidebarSearch: '[data-testid="sidebar-search"]',
  connectionTree: '[data-testid="connection-tree"]',
  connectionTreeItem: '[data-testid="connection-tree-item"]',
  connectionItem: '[data-testid="connection-tree-item"]',
  connectionGroup: '[data-testid="connection-group"]',

  // Tabs
  sessionTabs: '[data-testid="session-tabs"]',
  sessionTab: '[data-testid="session-tab"]',

  // Connection Editor
  editorPanel: '[data-testid="connection-editor"]',
  editorName: '[data-testid="editor-name"]',
  editorHostname: '[data-testid="editor-hostname"]',
  editorPort: '[data-testid="editor-port"]',
  editorProtocol: '[data-testid="editor-protocol"]',
  editorUsername: '[data-testid="editor-username"]',
  editorPassword: '[data-testid="editor-password"]',
  editorSave: '[data-testid="editor-save"]',
  editorParentFolder: '[data-testid="editor-parent-folder"]',

  // Collection
  collectionSelector: '[data-testid="collection-selector"]',
  collectionCreate: '[data-testid="collection-create"]',
  collectionName: '[data-testid="collection-name"]',
  collectionPassword: '[data-testid="collection-password"]',
  collectionConfirm: '[data-testid="collection-confirm"]',

  // Dialogs
  confirmDialog: '[data-testid="confirm-dialog"]',
  confirmYes: '[data-testid="confirm-yes"]',
  confirmNo: '[data-testid="confirm-no"]',
  deleteConnection: '[data-testid="delete-connection"]',
  modalClose: '[data-testid="modal-close"]',
  passwordDialog: '[data-testid="password-dialog"]',
  passwordInput: '[data-testid="password-input"]',
  passwordSubmit: '[data-testid="password-submit"]',
  passwordError: '[data-testid="password-error"]',

  // Settings
  settingsDialog: '[data-testid="settings-dialog"]',
  settingsSearch: '[data-testid="settings-search"]',

  // Import/Export
  importExportDialog: '[data-testid="import-export-dialog"]',
  importTab: '[data-testid="import-tab"]',
  exportTab: '[data-testid="export-tab"]',
  importFileInput: '[data-testid="import-file-input"]',
  importPreview: '[data-testid="import-preview"]',
  importConfirm: '[data-testid="import-confirm"]',
  exportFormat: '[data-testid="export-format"]',
  exportEncrypt: '[data-testid="export-encrypt"]',
  exportPassword: '[data-testid="export-password"]',
  exportConfirm: '[data-testid="export-confirm"]',

  // SSH Terminal
  sshTerminal: '[data-testid="ssh-terminal"]',
  terminalCanvas: '[data-testid="terminal-canvas"]',
  terminalToolbar: '[data-testid="terminal-toolbar"]',
  terminalDisconnect: '[data-testid="terminal-disconnect"]',
  terminalReconnect: '[data-testid="terminal-reconnect"]',

  // RDP
  rdpCanvas: '[data-testid="rdp-canvas"]',
  rdpStatusBar: '[data-testid="rdp-status-bar"]',
  rdpErrorScreen: '[data-testid="rdp-error-screen"]',

  // Bulk editor
  bulkEditorBtn: '[data-testid="bulk-editor-btn"]',
  bulkEditor: '[data-testid="bulk-editor"]',
  bulkSelectAll: '[data-testid="bulk-select-all"]',
  bulkDelete: '[data-testid="bulk-delete"]',
  bulkFavorite: '[data-testid="bulk-favorite"]',
  bulkDuplicate: '[data-testid="bulk-duplicate"]',

  // Templates
  templateList: '[data-testid="template-list"]',
  templateItem: '[data-testid="template-item"]',

  // Network tools
  networkDiscovery: '[data-testid="network-discovery"]',
  topologyView: '[data-testid="topology-view"]',

  // Monitoring
  healthDashboard: '[data-testid="health-dashboard"]',
  performanceMonitor: '[data-testid="performance-monitor"]',
  actionLog: '[data-testid="action-log"]',

  // Recording
  recordingStart: '[data-testid="recording-start"]',
  recordingStop: '[data-testid="recording-stop"]',
  replayViewer: '[data-testid="replay-viewer"]',

  // Scheduler
  schedulerPanel: '[data-testid="scheduler-panel"]',
  schedulerAddTask: '[data-testid="scheduler-add-task"]',

  // Marketplace
  marketplacePanel: '[data-testid="marketplace-panel"]',

  // Updater
  updaterPanel: '[data-testid="updater-panel"]',

  // Smart Filters
  smartFilterBtn: '[data-testid="smart-filter-btn"]',
  smartFilterManager: '[data-testid="smart-filter-manager"]',
  smartFilterAddCondition: '[data-testid="smart-filter-add-condition"]',
  smartFilterField: '[data-testid="smart-filter-field"]',
  smartFilterOperator: '[data-testid="smart-filter-operator"]',
  smartFilterValue: '[data-testid="smart-filter-value"]',
  smartFilterApply: '[data-testid="smart-filter-apply"]',
  smartFilterClear: '[data-testid="smart-filter-clear"]',
  smartFilterPresets: '[data-testid="smart-filter-presets"]',
  smartFilterSavePreset: '[data-testid="smart-filter-save-preset"]',
  smartFilterPresetName: '[data-testid="smart-filter-preset-name"]',
  smartFilterPresetConfirm: '[data-testid="smart-filter-preset-confirm"]',
  smartFilterLogicToggle: '[data-testid="smart-filter-logic-toggle"]',
  smartFilterRemoveCondition: '[data-testid="smart-filter-remove-condition"]',
  smartFilterPreview: '[data-testid="smart-filter-preview"]',

  // Tags
  tagManager: '[data-testid="tag-manager"]',
  tagInput: '[data-testid="tag-input"]',
  tagChip: '[data-testid="tag-chip"]',
  tagRemove: '[data-testid="tag-remove"]',
  tagCreate: '[data-testid="tag-create"]',

  // Cloud Sync
  syncStatusBar: '[data-testid="sync-status-bar"]',
  syncBackupPanel: '[data-testid="sync-backup-panel"]',
  cloudSyncStatus: '[data-testid="cloud-sync-status"]',
  syncProviderItem: '[data-testid="sync-provider-item"]',
  syncTriggerBtn: '[data-testid="sync-trigger-btn"]',
  syncTestBtn: '[data-testid="sync-test-btn"]',
  backupList: '[data-testid="backup-list"]',
  backupItem: '[data-testid="backup-item"]',
  backupCreateBtn: '[data-testid="backup-create-btn"]',
  backupRestoreBtn: '[data-testid="backup-restore-btn"]',

  // DDNS
  ddnsManager: '[data-testid="ddns-manager"]',
  ddnsAddProfile: '[data-testid="ddns-add-profile"]',
  ddnsProfileName: '[data-testid="ddns-profile-name"]',
  ddnsProvider: '[data-testid="ddns-provider"]',
  ddnsDomain: '[data-testid="ddns-domain"]',
  ddnsApiKey: '[data-testid="ddns-api-key"]',
  ddnsSaveProfile: '[data-testid="ddns-save-profile"]',
  ddnsProfileItem: '[data-testid="ddns-profile-item"]',
  ddnsUpdateBtn: '[data-testid="ddns-update-btn"]',
  ddnsTestBtn: '[data-testid="ddns-test-btn"]',
  ddnsDeleteBtn: '[data-testid="ddns-delete-btn"]',
  ddnsTabProfiles: '[data-testid="ddns-tab-profiles"]',
  ddnsTabHealth: '[data-testid="ddns-tab-health"]',
  ddnsTabCloudflare: '[data-testid="ddns-tab-cloudflare"]',
  ddnsTabIp: '[data-testid="ddns-tab-ip"]',
  ddnsTabScheduler: '[data-testid="ddns-tab-scheduler"]',
  ddnsTabConfig: '[data-testid="ddns-tab-config"]',
  ddnsTabAudit: '[data-testid="ddns-tab-audit"]',
  ddnsCurrentIp: '[data-testid="ddns-current-ip"]',
  ddnsIpVersion: '[data-testid="ddns-ip-version"]',
  ddnsAuditLog: '[data-testid="ddns-audit-log"]',

  // Synology
  synologyPanel: '[data-testid="synology-panel"]',
  synologyConnectionForm: '[data-testid="synology-connection-form"]',
  synologyHost: '[data-testid="synology-host"]',
  synologyPort: '[data-testid="synology-port"]',
  synologyUsername: '[data-testid="synology-username"]',
  synologyPassword: '[data-testid="synology-password"]',
  synologyConnectBtn: '[data-testid="synology-connect-btn"]',
  synologyDashboardTab: '[data-testid="synology-tab-dashboard"]',
  synologySystemTab: '[data-testid="synology-tab-system"]',
  synologyStorageTab: '[data-testid="synology-tab-storage"]',
  synologyFileStationTab: '[data-testid="synology-tab-filestation"]',
  synologyPackagesTab: '[data-testid="synology-tab-packages"]',
  synologyDockerTab: '[data-testid="synology-tab-docker"]',
  synologyNetworkTab: '[data-testid="synology-tab-network"]',
  synologyUsersTab: '[data-testid="synology-tab-users"]',
  synologyDashboard: '[data-testid="synology-dashboard"]',
  synologyDisconnectBtn: '[data-testid="synology-disconnect-btn"]',

  // iDRAC
  idracPanel: '[data-testid="idrac-panel"]',
  idracConnectionForm: '[data-testid="idrac-connection-form"]',
  idracHost: '[data-testid="idrac-host"]',
  idracUsername: '[data-testid="idrac-username"]',
  idracPassword: '[data-testid="idrac-password"]',
  idracConnectBtn: '[data-testid="idrac-connect-btn"]',
  idracDashboardTab: '[data-testid="idrac-tab-dashboard"]',
  idracPowerTab: '[data-testid="idrac-tab-power"]',
  idracThermalTab: '[data-testid="idrac-tab-thermal"]',
  idracHardwareTab: '[data-testid="idrac-tab-hardware"]',
  idracStorageTab: '[data-testid="idrac-tab-storage"]',
  idracNetworkTab: '[data-testid="idrac-tab-network"]',
  idracFirmwareTab: '[data-testid="idrac-tab-firmware"]',
  idracDashboard: '[data-testid="idrac-dashboard"]',
  idracPowerOn: '[data-testid="idrac-power-on"]',
  idracPowerOff: '[data-testid="idrac-power-off"]',
  idracPowerReset: '[data-testid="idrac-power-reset"]',
  idracDisconnectBtn: '[data-testid="idrac-disconnect-btn"]',

  // Proxmox
  proxmoxPanel: '[data-testid="proxmox-panel"]',
  proxmoxConnectionForm: '[data-testid="proxmox-connection-form"]',
  proxmoxHost: '[data-testid="proxmox-host"]',
  proxmoxUsername: '[data-testid="proxmox-username"]',
  proxmoxPassword: '[data-testid="proxmox-password"]',
  proxmoxConnectBtn: '[data-testid="proxmox-connect-btn"]',
  proxmoxDashboardTab: '[data-testid="proxmox-tab-dashboard"]',
  proxmoxNodesTab: '[data-testid="proxmox-tab-nodes"]',
  proxmoxQemuTab: '[data-testid="proxmox-tab-qemu"]',
  proxmoxLxcTab: '[data-testid="proxmox-tab-lxc"]',
  proxmoxStorageTab: '[data-testid="proxmox-tab-storage"]',
  proxmoxNetworkTab: '[data-testid="proxmox-tab-network"]',
  proxmoxTasksTab: '[data-testid="proxmox-tab-tasks"]',
  proxmoxSnapshotsTab: '[data-testid="proxmox-tab-snapshots"]',
  proxmoxDashboard: '[data-testid="proxmox-dashboard"]',
  proxmoxNodeItem: '[data-testid="proxmox-node-item"]',
  proxmoxVmItem: '[data-testid="proxmox-vm-item"]',
  proxmoxDisconnectBtn: '[data-testid="proxmox-disconnect-btn"]',

  // Debug Panel
  debugPanel: '[data-testid="debug-panel"]',
  debugActionList: '[data-testid="debug-action-list"]',
  debugActionItem: '[data-testid="debug-action-item"]',
  debugCategorySelect: '[data-testid="debug-category-select"]',
  debugExecuteBtn: '[data-testid="debug-execute-btn"]',
  debugOutput: '[data-testid="debug-output"]',

  // SSH Key Manager
  sshKeyManager: '[data-testid="ssh-key-manager"]',
  sshKeyList: '[data-testid="ssh-key-list"]',
  sshKeyItem: '[data-testid="ssh-key-item"]',
  sshKeyGenerate: '[data-testid="ssh-key-generate"]',
  sshKeyImport: '[data-testid="ssh-key-import"]',
  sshKeyDelete: '[data-testid="ssh-key-delete"]',
  sshKeyType: '[data-testid="ssh-key-type"]',
  sshKeyBits: '[data-testid="ssh-key-bits"]',
  sshKeyPassphrase: '[data-testid="ssh-key-passphrase"]',

  // SSH Agent Manager
  sshAgentManager: '[data-testid="ssh-agent-manager"]',
  sshAgentTabOverview: '[data-testid="ssh-agent-tab-overview"]',
  sshAgentTabKeys: '[data-testid="ssh-agent-tab-keys"]',
  sshAgentTabForwarding: '[data-testid="ssh-agent-tab-forwarding"]',
  sshAgentTabConfig: '[data-testid="ssh-agent-tab-config"]',
  sshAgentAddKey: '[data-testid="ssh-agent-add-key"]',
  sshAgentRemoveKey: '[data-testid="ssh-agent-remove-key"]',
  sshAgentKeyItem: '[data-testid="ssh-agent-key-item"]',

  // MCP Server
  mcpServerPanel: '[data-testid="mcp-server-panel"]',
  mcpConfigTab: '[data-testid="mcp-config-tab"]',
  mcpToolsTab: '[data-testid="mcp-tools-tab"]',
  mcpSessionsTab: '[data-testid="mcp-sessions-tab"]',
  mcpResourcesTab: '[data-testid="mcp-resources-tab"]',
  mcpPromptsTab: '[data-testid="mcp-prompts-tab"]',
  mcpOverviewTab: '[data-testid="mcp-overview-tab"]',
  mcpConfigSave: '[data-testid="mcp-config-save"]',
  mcpApiKeyInput: '[data-testid="mcp-api-key-input"]',
  mcpToolsSearch: '[data-testid="mcp-tools-search"]',

  // Let's Encrypt
  letsEncryptManager: '[data-testid="lets-encrypt-manager"]',
  letsEncryptOverviewTab: '[data-testid="lets-encrypt-tab-overview"]',
  letsEncryptCertsTab: '[data-testid="lets-encrypt-tab-certificates"]',
  letsEncryptAccountsTab: '[data-testid="lets-encrypt-tab-accounts"]',
  letsEncryptConfigTab: '[data-testid="lets-encrypt-tab-config"]',
  letsEncryptHealthTab: '[data-testid="lets-encrypt-tab-health"]',
  letsEncryptCertItem: '[data-testid="lets-encrypt-cert-item"]',
  letsEncryptRequestCert: '[data-testid="lets-encrypt-request-cert"]',

  // Shortcut Manager
  shortcutManagerBtn: '[data-testid="shortcut-manager-btn"]',
  shortcutManagerDialog: '[data-testid="shortcut-manager-dialog"]',
  shortcutSearch: '[data-testid="shortcut-search"]',
  shortcutItem: '[data-testid="shortcut-item"]',
  shortcutEdit: '[data-testid="shortcut-edit"]',
  shortcutReset: '[data-testid="shortcut-reset"]',
  shortcutRecordInput: '[data-testid="shortcut-record-input"]',
  shortcutSave: '[data-testid="shortcut-save"]',

  // Context Menu
  contextMenu: '[data-testid="context-menu"]',
  contextMenuConnect: '[data-testid="context-menu-connect"]',
  contextMenuEdit: '[data-testid="context-menu-edit"]',
  contextMenuDuplicate: '[data-testid="context-menu-duplicate"]',
  contextMenuDelete: '[data-testid="context-menu-delete"]',
  contextMenuFavorite: '[data-testid="context-menu-favorite"]',
  contextMenuWol: '[data-testid="context-wake-on-lan"]',
  contextMenuDetach: '[data-testid="context-menu-detach"]',

  // Connection Editor Recovery/Security sections
  editorRecoveryPhone: '[data-testid="editor-recovery-phone"]',
  editorRecoveryEmail: '[data-testid="editor-recovery-email"]',
  editorRecoverySeedPhrase: '[data-testid="editor-recovery-seed-phrase"]',
  editorBackupCodes: '[data-testid="editor-backup-codes"]',
  editorSecurityQuestions: '[data-testid="editor-security-questions"]',

  // Error Handling
  featureErrorBoundary: '[data-testid="feature-error-boundary"]',
  errorLogBar: '[data-testid="error-log-bar"]',
  errorLogExpand: '[data-testid="error-log-expand"]',
  errorLogEntry: '[data-testid="error-log-entry"]',
  errorLogClear: '[data-testid="error-log-clear"]',

  // Multi-select context menu
  multiSelectMenu: '[data-testid="multi-select-context-menu"]',
} as const;
