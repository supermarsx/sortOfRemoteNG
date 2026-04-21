import { describe, it, expect } from 'vitest';
import {
  importFromMRemoteNG,
  importFromRDCMan,
  importFromMobaXterm,
  importFromPuTTY,
  importFromTermius,
  importFromRoyalTS,
  importFromSecureCRT,
  importFromJSON,
  detectImportFormat,
  importConnections,
} from '../../src/components/ImportExport/utils';

// ──────────────────────────────────────────
// Format detection
// ──────────────────────────────────────────
describe('detectImportFormat', () => {
  it('detects mRemoteNG XML', () => {
    expect(detectImportFormat('<Connections ConfVersion="2.6">', 'confCons.xml')).toBe('mremoteng');
  });

  it('detects RDCMan XML', () => {
    expect(detectImportFormat('<RDCMan programVersion="2.7">', 'group.rdg')).toBe('rdcman');
  });

  it('detects MobaXterm INI', () => {
    expect(detectImportFormat('[Bookmarks]\nSubRep=', 'MobaXterm.ini')).toBe('mobaxterm');
  });

  it('detects PuTTY registry', () => {
    expect(detectImportFormat('[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions]', 'putty.reg')).toBe('putty');
  });

  it('detects Termius JSON by filename', () => {
    expect(detectImportFormat(JSON.stringify({ hosts: [{ address: 'a' }] }), 'termius-data.json')).toBe('termius');
  });

  it('detects Royal TS JSON', () => {
    expect(detectImportFormat(JSON.stringify({ Objects: [{ Type: 'RoyalFolder' }] }), 'export.rtsz')).toBe('royalts');
  });

  it('detects SecureCRT XML', () => {
    expect(detectImportFormat('<VanDyke><Sessions></Sessions></VanDyke>', 'sessions.xml')).toBe('securecrt');
  });

  it('detects CSV', () => {
    expect(detectImportFormat('Name,Protocol,Hostname,Port\n', 'connections.csv')).toBe('csv');
  });
});

// ──────────────────────────────────────────
// mRemoteNG
// ──────────────────────────────────────────
describe('importFromMRemoteNG', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" Export="false" ConfVersion="2.6">
  <Node Name="Production" Type="Container">
    <Node Name="Web Server" Type="Connection" Protocol="SSH2"
      Hostname="web.example.com" Port="22" Username="root"
      Domain="" Description="Main web server" />
    <Node Name="RDP Server" Type="Connection" Protocol="RDP"
      Hostname="rdp.example.com" Port="3389" Username="admin"
      Domain="CORP" Description="Windows server" />
  </Node>
  <Node Name="PowerShell Host" Type="Connection" Protocol="PowerShell"
    Hostname="ps.example.com" Port="5985" Username="psadmin" />
</Connections>`;

  it('imports connections with correct protocol mapping', async () => {
    const conns = await importFromMRemoteNG(xml);
    expect(conns.length).toBeGreaterThanOrEqual(3);

    const web = conns.find((c) => c.name === 'Web Server');
    expect(web).toBeDefined();
    expect(web!.protocol).toBe('ssh');
    expect(web!.hostname).toBe('web.example.com');
    expect(web!.port).toBe(22);
    expect(web!.username).toBe('root');
  });

  it('handles PowerShell protocol', async () => {
    const conns = await importFromMRemoteNG(xml);
    const ps = conns.find((c) => c.name === 'PowerShell Host');
    expect(ps).toBeDefined();
    expect(ps!.protocol).toBe('ssh'); // PowerShell mapped to ssh (no powershell protocol type)
    expect(ps!.hostname).toBe('ps.example.com');
  });

  it('creates folder groups for containers', async () => {
    const conns = await importFromMRemoteNG(xml);
    const folder = conns.find((c) => c.name === 'Production');
    expect(folder).toBeDefined();
    expect(folder!.isGroup).toBe(true);
  });

  it('maps RDP protocol with domain', async () => {
    const conns = await importFromMRemoteNG(xml);
    const rdp = conns.find((c) => c.name === 'RDP Server');
    expect(rdp).toBeDefined();
    expect(rdp!.protocol).toBe('rdp');
    expect(rdp!.port).toBe(3389);
    expect(rdp!.domain).toBe('CORP');
  });
});

// ──────────────────────────────────────────
// RDCMan
// ──────────────────────────────────────────
describe('importFromRDCMan', () => {
  const rdcmanXml = `<?xml version="1.0" encoding="utf-8"?>
<RDCMan programVersion="2.7" schemaVersion="3">
  <file>
    <properties>
      <name>Servers</name>
    </properties>
    <group>
      <properties>
        <name>Production</name>
      </properties>
      <server>
        <properties>
          <displayName>Web Server</displayName>
          <name>web.example.com</name>
          <comment>Main web server</comment>
          <logonCredentials inherit="None">
            <userName>admin</userName>
            <domain>CORP</domain>
          </logonCredentials>
          <connectionSettings inherit="None">
            <port>3390</port>
          </connectionSettings>
        </properties>
      </server>
      <server>
        <properties>
          <displayName>DB Server</displayName>
          <name>db.example.com</name>
        </properties>
      </server>
    </group>
  </file>
</RDCMan>`;

  it('imports servers from nested groups', async () => {
    const conns = await importFromRDCMan(rdcmanXml);
    const servers = conns.filter((c) => !c.isGroup);
    expect(servers.length).toBe(2);
  });

  it('extracts logon credentials', async () => {
    const conns = await importFromRDCMan(rdcmanXml);
    const web = conns.find((c) => c.name === 'Web Server');
    expect(web).toBeDefined();
    expect(web!.username).toBe('admin');
    expect(web!.domain).toBe('CORP');
  });

  it('extracts custom port from connectionSettings', async () => {
    const conns = await importFromRDCMan(rdcmanXml);
    const web = conns.find((c) => c.name === 'Web Server');
    expect(web!.port).toBe(3390);
  });

  it('extracts comments as description', async () => {
    const conns = await importFromRDCMan(rdcmanXml);
    const web = conns.find((c) => c.name === 'Web Server');
    expect(web!.description).toBe('Main web server');
  });

  it('creates group entries', async () => {
    const conns = await importFromRDCMan(rdcmanXml);
    const group = conns.find((c) => c.name === 'Production');
    expect(group).toBeDefined();
    expect(group!.isGroup).toBe(true);
  });

  it('defaults to port 3389 when no connectionSettings', async () => {
    const conns = await importFromRDCMan(rdcmanXml);
    const db = conns.find((c) => c.name === 'DB Server');
    expect(db!.port).toBe(3389);
  });
});

// ──────────────────────────────────────────
// MobaXterm
// ──────────────────────────────────────────
describe('importFromMobaXterm', () => {
  const ini = `[Bookmarks]
SubRep=Production
ImgNum=42

[Bookmarks_1]
SubRep=Production
ImgNum=42
SSH Server=#0#ssh.example.com%22%root%%-1%%%%%0
RDP Server=#4#rdp.example.com%3389%admin%%-1%%%%%0
VNC Server=#5#vnc.example.com%5900%%%-1%%%%%0
Mosh Host=#8#mosh.example.com%60001%user%%-1%%%%%0`;

  it('imports SSH connections', async () => {
    const conns = await importFromMobaXterm(ini);
    const ssh = conns.find((c) => c.name === 'SSH Server');
    expect(ssh).toBeDefined();
    expect(ssh!.protocol).toBe('ssh');
    expect(ssh!.hostname).toBe('ssh.example.com');
    expect(ssh!.port).toBe(22);
    expect(ssh!.username).toBe('root');
  });

  it('imports RDP connections (type 6)', async () => {
    const conns = await importFromMobaXterm(ini);
    const rdp = conns.find((c) => c.name === 'RDP Server');
    expect(rdp).toBeDefined();
    expect(rdp!.protocol).toBe('rdp');
    expect(rdp!.hostname).toBe('rdp.example.com');
  });

  it('imports VNC connections (type 4)', async () => {
    const conns = await importFromMobaXterm(ini);
    const vnc = conns.find((c) => c.name === 'VNC Server');
    expect(vnc).toBeDefined();
    expect(vnc!.protocol).toBe('vnc');
  });

  it('imports Mosh connections (type 8)', async () => {
    const conns = await importFromMobaXterm(ini);
    const mosh = conns.find((c) => c.name === 'Mosh Host');
    expect(mosh).toBeDefined();
    expect(mosh!.protocol).toBe('ssh');
  });

  it('creates folder for SubRep groups', async () => {
    const conns = await importFromMobaXterm(ini);
    const group = conns.find((c) => c.isGroup && c.name === 'Production');
    expect(group).toBeDefined();
  });
});

// ──────────────────────────────────────────
// PuTTY Registry
// ──────────────────────────────────────────
describe('importFromPuTTY', () => {
  const reg = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Production%20Server]
"HostName"="prod.example.com"
"PortNumber"=dword:00000016
"UserName"="admin"
"Protocol"="ssh"

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Telnet%20Gateway]
"HostName"="gateway.example.com"
"PortNumber"=dword:00000017
"Protocol"="telnet"`;

  it('imports SSH sessions', async () => {
    const conns = await importFromPuTTY(reg);
    const prod = conns.find((c) => c.name === 'Production Server');
    expect(prod).toBeDefined();
    expect(prod!.protocol).toBe('ssh');
    expect(prod!.hostname).toBe('prod.example.com');
    expect(prod!.port).toBe(22);
    expect(prod!.username).toBe('admin');
  });

  it('imports Telnet sessions', async () => {
    const conns = await importFromPuTTY(reg);
    const gw = conns.find((c) => c.name === 'Telnet Gateway');
    expect(gw).toBeDefined();
    expect(gw!.protocol).toBe('telnet');
    expect(gw!.port).toBe(23);
  });

  it('decodes URL-encoded session names', async () => {
    const conns = await importFromPuTTY(reg);
    const prod = conns.find((c) => c.name === 'Production Server');
    expect(prod).toBeDefined();
  });
});

// ──────────────────────────────────────────
// Termius
// ──────────────────────────────────────────
describe('importFromTermius', () => {
  const termiusJson = JSON.stringify({
    hosts: [
      {
        label: 'Web Server',
        address: 'web.example.com',
        port: 22,
        ssh_config: {
          username: 'webadmin',
        },
      },
      {
        label: 'DB Host',
        address: 'db.example.com',
        port: 5432,
        username: 'dbadmin',
      },
    ],
    groups: [
      {
        label: 'Infrastructure',
      },
    ],
  });

  it('imports hosts with ssh_config.username', async () => {
    const conns = await importFromTermius(termiusJson);
    const web = conns.find((c) => c.name === 'Web Server');
    expect(web).toBeDefined();
    expect(web!.hostname).toBe('web.example.com');
    expect(web!.username).toBe('webadmin');
  });

  it('falls back to top-level username', async () => {
    const conns = await importFromTermius(termiusJson);
    const db = conns.find((c) => c.name === 'DB Host');
    expect(db).toBeDefined();
    expect(db!.username).toBe('dbadmin');
  });

  it('creates group entries for Termius groups', async () => {
    const conns = await importFromTermius(termiusJson);
    const group = conns.find((c) => c.isGroup);
    expect(group).toBeDefined();
    expect(group!.name).toBe('Infrastructure');
  });
});

// ──────────────────────────────────────────
// Royal TS
// ──────────────────────────────────────────
describe('importFromRoyalTS', () => {
  const royalJson = JSON.stringify({
    Objects: [
      {
        Type: 'RoyalFolder',
        Name: 'Infrastructure',
        Objects: [
          {
            Type: 'RoyalRDSConnection',
            Name: 'Windows Server 2022',
            URI: 'win2022.example.com',
            Port: 3389,
            CredentialUsername: 'admin',
          },
          {
            Type: 'RoyalSSHConnection',
            Name: 'Linux Server',
            URI: 'linux.example.com',
            Port: 22,
            CredentialUsername: 'root',
          },
        ],
      },
      {
        Type: 'RoyalVNCConnection',
        Name: 'VNC Host',
        URI: 'vnc.example.com',
        Port: 5900,
      },
    ],
  });

  it('imports RDP connections', async () => {
    const conns = await importFromRoyalTS(royalJson);
    const win = conns.find((c) => c.name === 'Windows Server 2022');
    expect(win).toBeDefined();
    expect(win!.protocol).toBe('rdp');
    expect(win!.hostname).toBe('win2022.example.com');
    expect(win!.port).toBe(3389);
    expect(win!.username).toBe('admin');
  });

  it('imports SSH connections', async () => {
    const conns = await importFromRoyalTS(royalJson);
    const linux = conns.find((c) => c.name === 'Linux Server');
    expect(linux).toBeDefined();
    expect(linux!.protocol).toBe('ssh');
  });

  it('imports VNC connections at root level', async () => {
    const conns = await importFromRoyalTS(royalJson);
    const vnc = conns.find((c) => c.name === 'VNC Host');
    expect(vnc).toBeDefined();
    expect(vnc!.protocol).toBe('vnc');
    expect(vnc!.port).toBe(5900);
  });

  it('creates folder groups', async () => {
    const conns = await importFromRoyalTS(royalJson);
    const folder = conns.find((c) => c.name === 'Infrastructure');
    expect(folder).toBeDefined();
    expect(folder!.isGroup).toBe(true);
  });

  it('assigns parentId to children of folders', async () => {
    const conns = await importFromRoyalTS(royalJson);
    const folder = conns.find((c) => c.name === 'Infrastructure');
    const win = conns.find((c) => c.name === 'Windows Server 2022');
    expect(win!.parentId).toBe(folder!.id);
  });
});

// ──────────────────────────────────────────
// SecureCRT
// ──────────────────────────────────────────
describe('importFromSecureCRT', () => {
  const securecrtXml = `<?xml version="1.0" encoding="UTF-8"?>
<VanDyke>
  <Sessions>
    <Session Name="Production/WebServer">
      <S:"Protocol Name">SSH2</S:"Protocol Name">
      <S:"Hostname">web.prod.example.com</S:"Hostname">
      <D:"[SSH2] Port">22</D:"[SSH2] Port">
      <S:"Username">webadmin</S:"Username">
    </Session>
    <Session Name="Legacy/Telnet Gateway">
      <S:"Protocol Name">Telnet</S:"Protocol Name">
      <S:"Hostname">gateway.legacy.example.com</S:"Hostname">
      <D:"Port">23</D:"Port">
    </Session>
  </Sessions>
</VanDyke>`;

  it('imports SSH sessions', async () => {
    const conns = await importFromSecureCRT(securecrtXml);
    const web = conns.find((c) => c.name === 'WebServer');
    expect(web).toBeDefined();
    expect(web!.protocol).toBe('ssh');
    expect(web!.hostname).toBe('web.prod.example.com');
    expect(web!.port).toBe(22);
    expect(web!.username).toBe('webadmin');
  });

  it('imports Telnet sessions', async () => {
    const conns = await importFromSecureCRT(securecrtXml);
    const gw = conns.find((c) => c.name === 'Telnet Gateway');
    expect(gw).toBeDefined();
    expect(gw!.protocol).toBe('telnet');
    expect(gw!.hostname).toBe('gateway.legacy.example.com');
    expect(gw!.port).toBe(23);
  });

  it('extracts leaf name from folder path', async () => {
    const conns = await importFromSecureCRT(securecrtXml);
    // "Production/WebServer" => "WebServer"
    const web = conns.find((c) => c.name === 'WebServer');
    expect(web).toBeDefined();
  });
});

// ──────────────────────────────────────────
// Generic JSON
// ──────────────────────────────────────────
describe('importFromJSON', () => {
  const json = JSON.stringify({
    connections: [
      {
        name: 'Test Server',
        protocol: 'ssh',
        hostname: 'test.example.com',
        port: 22,
        username: 'testuser',
      },
    ],
  });

  it('imports connections from JSON', async () => {
    const conns = await importFromJSON(json);
    expect(conns.length).toBeGreaterThanOrEqual(1);
    const test = conns.find((c) => c.name === 'Test Server');
    expect(test).toBeDefined();
    expect(test!.hostname).toBe('test.example.com');
  });
});

// ──────────────────────────────────────────
// importConnections router
// ──────────────────────────────────────────
describe('importConnections router', () => {
  it('routes royalts format to Royal TS parser', async () => {
    const content = JSON.stringify({
      Objects: [
        { Type: 'RoyalSSHConnection', Name: 'Test', URI: 'example.com', Port: 22 },
      ],
    });
    const conns = await importConnections(content, 'export.rtsz', 'royalts');
    expect(conns.length).toBe(1);
    expect(conns[0].protocol).toBe('ssh');
  });

  it('routes securecrt format to SecureCRT parser', async () => {
    const content = `<VanDyke><Sessions>
      <Session Name="Test">
        <S:"Protocol Name">SSH2</S:"Protocol Name">
        <S:"Hostname">example.com</S:"Hostname">
        <D:"[SSH2] Port">22</D:"[SSH2] Port">
      </Session>
    </Sessions></VanDyke>`;
    const conns = await importConnections(content, 'sessions.xml', 'securecrt');
    expect(conns.length).toBe(1);
    expect(conns[0].hostname).toBe('example.com');
  });
});
