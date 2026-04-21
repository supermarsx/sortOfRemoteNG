import { Connection } from '../../types/connection/connection';
import { generateId } from '../../utils/core/id';

export const parseCSVLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/\r$/, ''));
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim().replace(/\r$/, ''));
  return values;
};

export const importFromCSV = async (content: string): Promise<Connection[]> => {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('CSV file must have headers and at least one data row');

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const connections: Connection[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;

    const conn: any = {};
    headers.forEach((header, index) => {
      conn[header] = values[index];
    });

    connections.push({
      id: conn.ID || generateId(),
      name: conn.Name || 'Imported Connection',
      protocol: (conn.Protocol?.toLowerCase() || 'rdp') as Connection['protocol'],
      hostname: conn.Hostname || '',
      port: parseInt(conn.Port || '3389'),
      username: conn.Username || undefined,
      domain: conn.Domain || undefined,
      description: conn.Description || undefined,
      parentId: conn.ParentId || undefined,
      isGroup: conn.IsGroup === 'true',
      tags: conn.Tags?.split(';').filter((t: string) => t.trim()) || [],
      createdAt: new Date(conn.CreatedAt || Date.now()).toISOString(),
      updatedAt: new Date(conn.UpdatedAt || Date.now()).toISOString()
    });
  }

  return connections;
};

/**
 * Supported import formats
 */
export type ImportFormat = 
  | 'mremoteng'      // mRemoteNG XML format
  | 'rdcman'         // Remote Desktop Connection Manager
  | 'royalts'        // Royal TS/TSX JSON format
  | 'mobaxterm'      // MobaXterm INI format
  | 'putty'          // PuTTY registry export
  | 'securecrt'      // SecureCRT XML sessions
  | 'termius'        // Termius JSON export
  | 'csv'            // Generic CSV
  | 'json';          // Generic JSON

/**
 * Detect import format from file content
 */
export const detectImportFormat = (content: string, filename?: string): ImportFormat => {
  const trimmed = content.trim();
  
  // Check filename extension first
  if (filename) {
    const lower = filename.toLowerCase();
    const ext = lower.split('.').pop();
    if (ext === 'csv') return 'csv';
    if (ext === 'rtsz' || ext === 'rtsx' || lower.includes('royalts')) return 'royalts';
    if (lower.includes('termius')) return 'termius';
    if (ext === 'rdg') return 'rdcman';
    if (ext === 'reg') return 'putty';
    if (ext === 'ini' && lower.includes('moba')) return 'mobaxterm';
  }

  // mRemoteNG detection - look for their specific XML structure
  if (trimmed.includes('<Connections') && trimmed.includes('ConfVersion')) {
    return 'mremoteng';
  }
  
  // RDCMan detection
  if (trimmed.includes('<RDCMan') || (trimmed.includes('<file') && trimmed.includes('<group'))) {
    return 'rdcman';
  }
  
  // Royal TS JSON format
  if (trimmed.startsWith('{') && (trimmed.includes('"Objects"') || trimmed.includes('"RoyalFolder"'))) {
    return 'royalts';
  }
  
  // MobaXterm INI format
  if (trimmed.includes('[Bookmarks') || trimmed.includes('SubRep=')) {
    return 'mobaxterm';
  }
  
  // PuTTY registry format
  if (trimmed.includes('REGEDIT') || trimmed.includes('[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY')) {
    return 'putty';
  }
  
  // SecureCRT XML sessions
  if (trimmed.includes('<VanDyke') || trimmed.includes('S:"Protocol Name"')) {
    return 'securecrt';
  }
  
  // Termius JSON
  if (trimmed.startsWith('{') && trimmed.includes('"hosts"')) {
    return 'termius';
  }

  // Generic XML check
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
    // Could be mRemoteNG without the standard header
    if (trimmed.includes('Node') && (trimmed.includes('Protocol=') || trimmed.includes('Hostname='))) {
      return 'mremoteng';
    }
  }
  
  // Generic JSON check
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }
  
  // Default to CSV
  return 'csv';
};

/**
 * Map mRemoteNG protocol names to our format
 */
const mapMRemoteNGProtocol = (protocol: string): Connection['protocol'] => {
  const protocolMap: Record<string, Connection['protocol']> = {
    'RDP': 'rdp',
    'SSH1': 'ssh',
    'SSH2': 'ssh',
    'Telnet': 'telnet',
    'Rlogin': 'rlogin',
    'VNC': 'vnc',
    'HTTP': 'http',
    'HTTPS': 'https',
    'ICA': 'rdp',           // Citrix ICA mapped to RDP
    'RAW': 'telnet',
    'IntApp': 'rdp',
    'PowerShell': 'ssh',    // mRemoteNG PowerShell remoting → ssh
    'Winbox': 'rdp',        // MikroTik Winbox → rdp
  };
  return protocolMap[protocol] || 'rdp';
};

/**
 * Parse mRemoteNG XML format
 * mRemoteNG uses a nested Node structure with attributes for connection properties
 */
export const importFromMRemoteNG = async (content: string): Promise<Connection[]> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');
  
  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML format: ' + parseError.textContent);
  }

  const connections: Connection[] = [];
  const folderIdMap = new Map<Element, string>();

  // Recursive function to parse nodes
  const parseNode = (node: Element, parentId?: string): void => {
    const nodeType = node.getAttribute('Type') || 'Connection';
    const name = node.getAttribute('Name') || 'Unnamed';
    
    if (nodeType === 'Container') {
      // This is a folder
      const folderId = generateId();
      folderIdMap.set(node, folderId);
      
      connections.push({
        id: folderId,
        name: name,
        protocol: 'rdp',
        hostname: '',
        port: 0,
        isGroup: true,
        parentId: parentId,
        description: node.getAttribute('Descr') || undefined,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Parse child nodes
      const children = node.querySelectorAll(':scope > Node');
      children.forEach(child => parseNode(child, folderId));
    } else {
      // This is a connection
      const protocol = node.getAttribute('Protocol') || 'RDP';
      const hostname = node.getAttribute('Hostname') || '';
      const port = parseInt(node.getAttribute('Port') || '0') || getDefaultPort(protocol);
      const username = node.getAttribute('Username') || undefined;
      const domain = node.getAttribute('Domain') || undefined;
      const description = node.getAttribute('Descr') || node.getAttribute('Description') || undefined;
      
      // mRemoteNG specific fields
      const resolution = node.getAttribute('Resolution') || undefined;
      const colors = node.getAttribute('Colors') || undefined;
      const useCredSsp = node.getAttribute('UseCredSsp') === 'True';
      const renderingEngine = node.getAttribute('RenderingEngine') || undefined;
      
      connections.push({
        id: generateId(),
        name: name,
        protocol: mapMRemoteNGProtocol(protocol),
        hostname: hostname,
        port: port,
        username: username,
        domain: domain,
        description: description,
        parentId: parentId,
        isGroup: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Store mRemoteNG-specific settings in custom fields
        ...(resolution && { resolution }),
        ...(colors && { colorDepth: colors }),
        ...(useCredSsp !== undefined && { useCredSsp }),
        ...(renderingEngine && { renderingEngine }),
      });
    }
  };

  // Get the root Connections element or find Node elements directly
  const rootConnections = doc.querySelector('Connections');
  const rootNodes = rootConnections 
    ? rootConnections.querySelectorAll(':scope > Node')
    : doc.querySelectorAll('Node');

  rootNodes.forEach(node => parseNode(node));

  return connections;
};

/**
 * Parse Remote Desktop Connection Manager (RDCMan) XML format
 */
export const importFromRDCMan = async (content: string): Promise<Connection[]> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');
  
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML format: ' + parseError.textContent);
  }

  const connections: Connection[] = [];

  // Parse groups
  const parseGroup = (groupEl: Element, parentId?: string): void => {
    const properties = groupEl.querySelector(':scope > properties');
    const name = properties?.querySelector('name')?.textContent || 'Unnamed Group';
    const groupId = generateId();
    
    connections.push({
      id: groupId,
      name: name,
      protocol: 'rdp',
      hostname: '',
      port: 0,
      isGroup: true,
      parentId: parentId,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Parse servers in this group
    groupEl.querySelectorAll(':scope > server').forEach(serverEl => {
      parseRDCManServer(serverEl, connections, groupId);
    });

    // Recursively parse subgroups
    groupEl.querySelectorAll(':scope > group').forEach(subGroupEl => {
      parseGroup(subGroupEl, groupId);
    });
  };

  // Start parsing from file > group elements
  doc.querySelectorAll('file > group').forEach(groupEl => {
    parseGroup(groupEl);
  });

  // Also check for servers at root level
  doc.querySelectorAll('file > server').forEach(serverEl => {
    parseRDCManServer(serverEl, connections);
  });

  return connections;
};

/** Extract a single RDCMan server element into a Connection. */
const parseRDCManServer = (
  serverEl: Element,
  connections: Connection[],
  parentId?: string,
): void => {
  const props = serverEl.querySelector('properties');
  const displayName = props?.querySelector('displayName')?.textContent;
  const serverName = props?.querySelector('name')?.textContent || '';

  // RDCMan stores credentials in <logonCredentials> (group or server level)
  const creds = serverEl.querySelector('logonCredentials');
  const username = creds?.querySelector('userName')?.textContent || undefined;
  const domain = creds?.querySelector('domain')?.textContent || undefined;

  // Port lives in <connectionSettings>
  const connSettings = serverEl.querySelector('connectionSettings');
  const port = parseInt(connSettings?.querySelector('port')?.textContent || '3389') || 3389;

  // Comment/description
  const comment = props?.querySelector('comment')?.textContent || undefined;

  connections.push({
    id: generateId(),
    name: displayName || serverName,
    protocol: 'rdp',
    hostname: serverName,
    port,
    username,
    domain,
    description: comment,
    isGroup: false,
    parentId,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Parse MobaXterm bookmarks INI format
 */
export const importFromMobaXterm = async (content: string): Promise<Connection[]> => {
  const connections: Connection[] = [];
  const lines = content.split(/\r?\n/);
  let currentSection = '';
  let currentSubRep = '';
  const folderMap = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Section header
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }
    
    if (currentSection === 'Bookmarks' || currentSection.startsWith('Bookmarks_')) {
      // Parse SubRep (folder path)
      if (trimmed.startsWith('SubRep=')) {
        currentSubRep = trimmed.slice(7);
        if (currentSubRep && !folderMap.has(currentSubRep)) {
          const folderId = generateId();
          folderMap.set(currentSubRep, folderId);
          connections.push({
            id: folderId,
            name: currentSubRep.split('\\').pop() || currentSubRep,
            protocol: 'ssh',
            hostname: '',
            port: 0,
            isGroup: true,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        continue;
      }
      
      // Parse bookmark entry
      // Format: Name=#sessionType#hostname%port%username%...
      const match = trimmed.match(/^(.+?)=#(\d+)#(.+)/);
      if (match) {
        const [, name, typeNum, params] = match;
        const parts = params.split('%');
        const hostname = parts[0] || '';
        const port = parseInt(parts[1]) || 22;
        const username = parts[2] || undefined;
        
        // Map MobaXterm session types
        const protocolMap: Record<string, Connection['protocol']> = {
          '0': 'ssh',    // SSH
          '1': 'telnet', // Telnet
          '2': 'rlogin', // Rlogin
          '4': 'rdp',    // RDP
          '5': 'vnc',    // VNC
          '3': 'rdp',    // XDMCP (remote display → rdp)
          '6': 'ftp',    // FTP
          '7': 'sftp',   // SFTP (map to SSH)
          '8': 'ssh',    // Mosh (→ ssh)
          '9': 'telnet', // Serial (→ telnet)
          '10': 'ssh',   // WSL
        };
        
        connections.push({
          id: generateId(),
          name: name,
          protocol: protocolMap[typeNum] || 'ssh',
          hostname: hostname,
          port: port,
          username: username,
          isGroup: false,
          parentId: currentSubRep ? folderMap.get(currentSubRep) : undefined,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  return connections;
};

/**
 * Parse PuTTY registry export format
 */
export const importFromPuTTY = async (content: string): Promise<Connection[]> => {
  const connections: Connection[] = [];
  const lines = content.split(/\r?\n/);
  let currentSession: string | null = null;
  let currentProps: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Session header
    const sessionMatch = trimmed.match(/\[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\(.+)\]/);
    if (sessionMatch) {
      // Save previous session
      if (currentSession && currentProps.HostName) {
        connections.push(createPuTTYConnection(currentSession, currentProps));
      }
      currentSession = decodeURIComponent(sessionMatch[1].replace(/%([0-9A-F]{2})/gi, (_, hex) => 
        String.fromCharCode(parseInt(hex, 16))
      ));
      currentProps = {};
      continue;
    }
    
    // Property line
    const propMatch = trimmed.match(/"(.+?)"=(?:"(.*)"|dword:([0-9a-f]+))/);
    if (propMatch && currentSession) {
      const [, key, strValue, dwordValue] = propMatch;
      currentProps[key] = strValue ?? String(parseInt(dwordValue || '0', 16));
    }
  }

  // Save last session
  if (currentSession && currentProps.HostName) {
    connections.push(createPuTTYConnection(currentSession, currentProps));
  }

  return connections;
};

const createPuTTYConnection = (name: string, props: Record<string, string>): Connection => {
  const protocolMap: Record<string, Connection['protocol']> = {
    'ssh': 'ssh',
    'serial': 'telnet',
    'telnet': 'telnet',
    'rlogin': 'rlogin',
    'raw': 'telnet',
  };
  
  return {
    id: generateId(),
    name: name,
    protocol: protocolMap[props.Protocol?.toLowerCase() || 'ssh'] || 'ssh',
    hostname: props.HostName || '',
    port: parseInt(props.PortNumber || '22'),
    username: props.UserName || undefined,
    isGroup: false,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Parse Termius JSON export format
 */
export const importFromTermius = async (content: string): Promise<Connection[]> => {
  const data = JSON.parse(content);
  const connections: Connection[] = [];
  const groupMap = new Map<string, string>();

  // Parse groups first
  if (data.groups) {
    for (const group of data.groups) {
      const groupId = generateId();
      groupMap.set(group.id || group.label, groupId);
      connections.push({
        id: groupId,
        name: group.label || 'Unnamed Group',
        protocol: 'ssh',
        hostname: '',
        port: 0,
        isGroup: true,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Parse hosts
  if (data.hosts) {
    for (const host of data.hosts) {
      // Termius stores username either at top-level or inside ssh_config
      const username = host.username
        || host.ssh_config?.username
        || undefined;

      connections.push({
        id: generateId(),
        name: host.label || host.address || 'Unnamed',
        protocol: 'ssh',
        hostname: host.address || '',
        port: host.port || 22,
        username,
        isGroup: false,
        parentId: host.group_id ? groupMap.get(host.group_id) : undefined,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return connections;
};

/**
 * Parse Royal TS/TSX JSON export format.
 * Royal TS exports nested Objects arrays with Type indicating the object kind.
 */
export const importFromRoyalTS = async (content: string): Promise<Connection[]> => {
  const data = JSON.parse(content);
  const connections: Connection[] = [];

  const mapRoyalType = (type: string): Connection['protocol'] => {
    const map: Record<string, Connection['protocol']> = {
      'RoyalRDSConnection': 'rdp',
      'RoyalSSHConnection': 'ssh',
      'RoyalVNCConnection': 'vnc',
      'RoyalSFTPConnection': 'ssh',
      'RoyalFTPConnection': 'ftp',
      'RoyalTelnetConnection': 'telnet',
      'RoyalWebConnection': 'https',
    };
    return map[type] || 'rdp';
  };

  const parseObjects = (objects: any[], parentId?: string): void => {
    for (const obj of objects) {
      if (obj.Type === 'RoyalFolder') {
        const folderId = generateId();
        connections.push({
          id: folderId,
          name: obj.Name || 'Unnamed Folder',
          protocol: 'rdp',
          hostname: '',
          port: 0,
          isGroup: true,
          parentId,
          description: obj.Description || undefined,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        if (obj.Objects && Array.isArray(obj.Objects)) {
          parseObjects(obj.Objects, folderId);
        }
      } else {
        const protocol = mapRoyalType(obj.Type || '');
        connections.push({
          id: generateId(),
          name: obj.Name || obj.URI || 'Unnamed',
          protocol,
          hostname: obj.URI || obj.ComputerName || '',
          port: obj.Port || getDefaultPort(protocol.toUpperCase()),
          username: obj.CredentialUsername || obj.Username || undefined,
          domain: obj.CredentialDomain || undefined,
          description: obj.Description || undefined,
          isGroup: false,
          parentId,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  };

  const objects = data.Objects || (Array.isArray(data) ? data : []);
  parseObjects(objects);
  return connections;
};

/**
 * Parse SecureCRT XML session export format.
 * SecureCRT uses non-standard XML tag names like <S:"Hostname"> which DOMParser
 * cannot handle, so we use regex-based parsing instead.
 */
export const importFromSecureCRT = async (content: string): Promise<Connection[]> => {
  const connections: Connection[] = [];

  // Match each <Session Name="...">...</Session> block
  const sessionRegex = /<Session\s+Name="([^"]*)">([\s\S]*?)<\/Session>/g;
  let match;

  while ((match = sessionRegex.exec(content)) !== null) {
    const nameAttr = match[1];
    const body = match[2];

    const nameParts = nameAttr.split('/');
    const name = nameParts[nameParts.length - 1] || nameAttr;

    let hostname = '';
    let port = 22;
    let username = '';
    let protocol: Connection['protocol'] = 'ssh';

    // Extract string values: <S:"Key">value</S:"Key">
    const strRegex = /<S:"([^"]+)">([^<]*)<\/S:"[^"]+">/g;
    let strMatch;
    while ((strMatch = strRegex.exec(body)) !== null) {
      const key = strMatch[1];
      const value = strMatch[2];
      if (key === 'Hostname') hostname = value;
      else if (key === 'Username') username = value;
      else if (key === 'Protocol Name') {
        const lower = value.toLowerCase();
        if (lower.includes('ssh')) protocol = 'ssh';
        else if (lower.includes('telnet')) protocol = 'telnet';
        else if (lower.includes('rlogin')) protocol = 'rlogin';
      }
    }

    // Extract integer values: <D:"Key">value</D:"Key">
    const intRegex = /<D:"([^"]+)">([^<]*)<\/D:"[^"]+">/g;
    let intMatch;
    while ((intMatch = intRegex.exec(body)) !== null) {
      const key = intMatch[1];
      const value = intMatch[2];
      if (key === '[SSH2] Port' || key === 'Port') {
        port = parseInt(value) || 22;
      }
    }

    if (hostname || name) {
      connections.push({
        id: generateId(),
        name: name || hostname,
        protocol,
        hostname,
        port,
        username: username || undefined,
        isGroup: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return connections;
};

/**
 * Parse generic JSON format
 */
export const importFromJSON = async (content: string): Promise<Connection[]> => {
  const data = JSON.parse(content);
  
  // Handle array format
  if (Array.isArray(data)) {
    return data.map(conn => ({
      id: conn.id || generateId(),
      name: conn.name || 'Imported Connection',
      protocol: (conn.protocol?.toLowerCase() || 'rdp') as Connection['protocol'],
      hostname: conn.hostname || conn.host || '',
      port: parseInt(conn.port || '3389'),
      username: conn.username || undefined,
      password: conn.password || undefined,
      domain: conn.domain || undefined,
      description: conn.description || undefined,
      parentId: conn.parentId || undefined,
      isGroup: conn.isGroup || conn.isFolder || false,
      tags: conn.tags || [],
      createdAt: new Date(conn.createdAt || Date.now()).toISOString(),
      updatedAt: new Date(conn.updatedAt || Date.now()).toISOString(),
    }));
  }
  
  // Handle object with connections array
  if (data.connections && Array.isArray(data.connections)) {
    return importFromJSON(JSON.stringify(data.connections));
  }

  throw new Error('Invalid JSON format: expected array or object with connections array');
};

/**
 * Get default port for a protocol
 */
const getDefaultPort = (protocol: string): number => {
  const defaults: Record<string, number> = {
    'RDP': 3389,
    'SSH1': 22,
    'SSH2': 22,
    'SSH': 22,
    'Telnet': 23,
    'Rlogin': 513,
    'VNC': 5900,
    'HTTP': 80,
    'HTTPS': 443,
    'FTP': 21,
    'SFTP': 22,
  };
  return defaults[protocol] || 3389;
};

/**
 * Main import function that auto-detects format
 */
export const importConnections = async (
  content: string, 
  filename?: string,
  format?: ImportFormat
): Promise<Connection[]> => {
  const detectedFormat = format || detectImportFormat(content, filename);
  
  switch (detectedFormat) {
    case 'mremoteng':
      return importFromMRemoteNG(content);
    case 'rdcman':
      return importFromRDCMan(content);
    case 'mobaxterm':
      return importFromMobaXterm(content);
    case 'putty':
      return importFromPuTTY(content);
    case 'termius':
      return importFromTermius(content);
    case 'royalts':
      return importFromRoyalTS(content);
    case 'securecrt':
      return importFromSecureCRT(content);
    case 'json':
      return importFromJSON(content);
    case 'csv':
    default:
      return importFromCSV(content);
  }
};

/**
 * Get human-readable format name
 */
export const getFormatName = (format: ImportFormat): string => {
  const names: Record<ImportFormat, string> = {
    'mremoteng': 'mRemoteNG',
    'rdcman': 'Remote Desktop Connection Manager',
    'royalts': 'Royal TS/TSX',
    'mobaxterm': 'MobaXterm',
    'putty': 'PuTTY',
    'securecrt': 'SecureCRT',
    'termius': 'Termius',
    'csv': 'CSV',
    'json': 'JSON',
  };
  return names[format] || format;
};
