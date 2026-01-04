import { ProxyConfig } from "./settings";
export interface Connection {
  id: string;
  name: string;
  protocol: 'rdp' | 'ssh' | 'vnc' | 'anydesk' | 'http' | 'https' | 'telnet' | 'rlogin' | 'mysql' | 'ftp' | 'sftp' | 'scp' | 'winrm' | 'rustdesk' | 'smb' | 'gcp' | 'azure' | 'ibm-csp' | 'digital-ocean' | 'heroku' | 'scaleway' | 'linode' | 'ovhcloud';
  hostname: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  description?: string;
  parentId?: string;
  isGroup: boolean;
  expanded?: boolean;
  lastConnected?: Date;
  connectionCount?: number;
  icon?: string;
  tags?: string[];
  colorTag?: string; // Color classification
  order?: number;
  createdAt: Date;
  updatedAt: Date;
  
  // Advanced Connection Settings
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  warnOnClose?: boolean;
  hostnameOverride?: boolean;
  
  // Authentication
  authType?: 'password' | 'key' | 'totp' | 'basic' | 'header';
  privateKey?: string;
  passphrase?: string;
  totpSecret?: string;
  ignoreSshSecurityErrors?: boolean;
  httpHeaders?: Record<string, string>;
  basicAuthRealm?: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  
  // Database specific
  database?: string;
  
  // File transfer specific
  localPath?: string;
  remotePath?: string;
  
  // Wake on LAN
  macAddress?: string;
  wolPort?: number;
  
  // RustDesk specific
  rustdeskId?: string;
  rustdeskPassword?: string;
  
  // SMB specific
  shareName?: string;
  workgroup?: string;
  
  // Cloud Provider specific
  cloudProvider?: {
    provider: 'gcp' | 'azure' | 'ibm-csp' | 'digital-ocean' | 'heroku' | 'scaleway' | 'linode' | 'ovhcloud';
    projectId?: string; // GCP, Azure resource group
    subscriptionId?: string; // Azure
    region?: string;
    zone?: string; // GCP
    resourceGroup?: string; // Azure
    instanceId?: string;
    instanceName?: string;
    apiKey?: string;
    accessToken?: string;
    clientId?: string; // Azure
    clientSecret?: string; // Azure
    tenantId?: string; // Azure
    serviceAccountKey?: string; // GCP
    vpcId?: string; // AWS, but can be used for others
    subnetId?: string;
    securityGroup?: string;
    appName?: string; // Heroku
    dynoName?: string; // Heroku
    organizationId?: string; // Scaleway
    projectName?: string; // Scaleway, OVH
    serviceId?: string; // OVH
  };
  
  // Status Checking
  statusCheck?: {
    enabled: boolean;
    method: 'ping' | 'socket' | 'http';
    interval: number;
    timeout: number;
  };
  
  // Performance Monitoring
  performanceMonitoring?: {
    enabled: boolean;
    pingInterval: number;
    trackLatency: boolean;
    trackThroughput: boolean;
    alertThresholds: {
      latency: number;
      packetLoss: number;
    };
  };
  
  // Security Settings
  security?: {
    encryptionAlgorithm?: string;
    blockCipherMode?: string;
    keyDerivationIterations?: number;
    proxy?: ProxyConfig;
    openvpn?: {
      enabled: boolean;
      configId?: string; // Reference to OpenVPN configuration
      chainPosition?: number; // Order in VPN chain (0 = first, higher = chained after)
    };
    sshTunnel?: {
      enabled: boolean;
      connectionId: string;
      localPort: number;
      remotePort: number;
    };
  };
  
  // Custom Scripts
  scripts?: {
    onConnect?: string[];
    onDisconnect?: string[];
  };

  // Proxy/VPN chaining
  proxyChainId?: string;
  connectionChainId?: string;
}

export interface ConnectionSession {
  id: string;
  connectionId: string;
  name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';
  startTime: Date;
  lastActivity?: Date;
  protocol: string;
  hostname: string;
  
  // Tab Layout
  layout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    isDetached: boolean;
    windowId?: string;
  };

  // Backend session handles
  backendSessionId?: string;
  shellId?: string;
  
  // Zoom level
  zoomLevel?: number;
  
  // Performance Metrics
  metrics?: {
    connectionTime: number;
    dataTransferred: number;
    latency: number;
    throughput: number;
    packetLoss?: number;
    jitter?: number;
  };
  
  // Tab Grouping
  group?: string;
  
  // Reconnection
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
}

export interface TabLayout {
  mode: 'tabs' | 'sideBySide' | 'mosaic' | 'miniMosaic';
  sessions: {
    sessionId: string;
    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[];
}


export interface ConnectionFilter {
  searchTerm: string;
  protocols: string[];
  tags: string[];
  colorTags: string[];
  showRecent: boolean;
  showFavorites: boolean;
  status?: 'online' | 'offline' | 'unknown';
  groupBy?: 'none' | 'protocol' | 'status' | 'hostname' | 'colorTag';
}

export interface StorageSettings {
  isEncrypted: boolean;
  hasPassword: boolean;
}

export interface ConnectionStatus {
  connectionId: string;
  status: 'online' | 'offline' | 'checking' | 'unknown' | 'timeout' | 'error';
  lastChecked: Date;
  responseTime?: number;
  error?: string;
}


export interface DiscoveredHost {
  ip: string;
  hostname?: string;
  openPorts: number[];
  services: DiscoveredService[];
  responseTime: number;
  macAddress?: string;
}

export interface DiscoveredService {
  port: number;
  protocol: string;
  service: string;
  version?: string;
  banner?: string;
}

export interface FileTransferSession {
  id: string;
  connectionId: string;
  type: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  progress: number;
  status: 'pending' | 'active' | 'completed' | 'error' | 'cancelled';
  error?: string;
  startTime: Date;
  endTime?: Date;
  totalSize: number;
  transferredSize: number;
}

export interface ConnectionCollection {
  id: string;
  name: string;
  description?: string;
  isEncrypted: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastAccessed: Date;
}

