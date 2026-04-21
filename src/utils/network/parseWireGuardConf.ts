/**
 * Parses a WireGuard .conf file content into a structured config object.
 *
 * Expected format:
 * [Interface]
 * PrivateKey = <base64>
 * Address = 10.0.0.2/32
 * DNS = 1.1.1.1, 8.8.8.8
 * MTU = 1420
 *
 * [Peer]
 * PublicKey = <base64>
 * PresharedKey = <base64>
 * Endpoint = vpn.example.com:51820
 * AllowedIPs = 0.0.0.0/0, ::/0
 * PersistentKeepalive = 25
 */

export interface ParsedWireGuardConfig {
  interface: {
    privateKey: string;
    address: string[];
    dns?: string[];
    mtu?: number;
    preUp?: string[];
    postUp?: string[];
    preDown?: string[];
    postDown?: string[];
  };
  peer: {
    publicKey: string;
    presharedKey?: string;
    endpoint?: string;
    allowedIPs: string[];
    persistentKeepalive?: number;
  };
}

export function parseWireGuardConf(content: string): ParsedWireGuardConfig {
  const lines = content.split('\n').map(l => l.trim());

  let currentSection: 'none' | 'interface' | 'peer' = 'none';
  const interfaceData: Record<string, string> = {};
  const peerData: Record<string, string> = {};

  for (const line of lines) {
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    if (line.toLowerCase() === '[interface]') {
      currentSection = 'interface';
      continue;
    }
    if (line.toLowerCase() === '[peer]') {
      currentSection = 'peer';
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;

    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();

    if (currentSection === 'interface') {
      interfaceData[key.toLowerCase()] = value;
    } else if (currentSection === 'peer') {
      peerData[key.toLowerCase()] = value;
    }
  }

  const splitCsv = (s?: string): string[] =>
    s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];

  return {
    interface: {
      privateKey: interfaceData['privatekey'] ?? '',
      address: splitCsv(interfaceData['address']),
      dns: interfaceData['dns'] ? splitCsv(interfaceData['dns']) : undefined,
      mtu: interfaceData['mtu'] ? parseInt(interfaceData['mtu'], 10) : undefined,
      preUp: interfaceData['preup'] ? [interfaceData['preup']] : undefined,
      postUp: interfaceData['postup'] ? [interfaceData['postup']] : undefined,
      preDown: interfaceData['predown'] ? [interfaceData['predown']] : undefined,
      postDown: interfaceData['postdown'] ? [interfaceData['postdown']] : undefined,
    },
    peer: {
      publicKey: peerData['publickey'] ?? '',
      presharedKey: peerData['presharedkey'] || undefined,
      endpoint: peerData['endpoint'] || undefined,
      allowedIPs: splitCsv(peerData['allowedips'] || '0.0.0.0/0'),
      persistentKeepalive: peerData['persistentkeepalive'] ? parseInt(peerData['persistentkeepalive'], 10) : undefined,
    },
  };
}
