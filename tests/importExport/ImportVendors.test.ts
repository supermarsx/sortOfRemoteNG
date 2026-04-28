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
  getFormatName,
} from '../../src/components/ImportExport/utils';

// ──────────────────────────────────────────
// Format detection
// ──────────────────────────────────────────
describe('detectImportFormat', () => {
  it('detects mRemoteNG XML', () => {
    expect(detectImportFormat('<Connections ConfVersion="2.6">', 'confCons.xml')).toBe('mremoteng');
  });

  it('detects generic mRemoteNG node XML without a Connections root', () => {
    expect(
      detectImportFormat('<Node Name="Direct" Protocol="SSH2" Hostname="direct.example.com" />'),
    ).toBe('mremoteng');
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

  it('defaults unmatched plain text to CSV', () => {
    expect(detectImportFormat('plain text export with no structured markers')).toBe('csv');
  });

  it('treats lowercase Royal TS object keys as generic JSON', () => {
    expect(detectImportFormat(JSON.stringify({ objects: [] }))).toBe('json');
  });

  it('detects content-only vendor markers that rely on secondary branches', () => {
    expect(detectImportFormat('<file><group></group></file>')).toBe('rdcman');
    expect(detectImportFormat(JSON.stringify({ Type: 'RoyalFolder' }))).toBe('royalts');
    expect(detectImportFormat('SubRep=Nested\\Folder')).toBe('mobaxterm');
    expect(detectImportFormat('REGEDIT4')).toBe('putty');
    expect(detectImportFormat(JSON.stringify({ hosts: [] }))).toBe('termius');
    expect(detectImportFormat('<Node Name="Direct" Hostname="host-only.example.com" />')).toBe('mremoteng');
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

  it('imports root-level nodes and preserves custom display attributes', async () => {
    const directXml = `<?xml version="1.0" encoding="utf-8"?>
<Node Name="Edge Router" Protocol="Winbox" Hostname="router.example.com"
  Resolution="1920x1080" Colors="32" UseCredSsp="True" RenderingEngine="DirectX" />`;

    const conns = await importFromMRemoteNG(directXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('Edge Router');
    expect(conns[0].protocol).toBe('rdp');
    expect((conns[0] as any).resolution).toBe('1920x1080');
    expect((conns[0] as any).colorDepth).toBe('32');
    expect((conns[0] as any).useCredSsp).toBe(true);
    expect((conns[0] as any).renderingEngine).toBe('DirectX');
  });

  it('defaults missing node attributes to a basic RDP connection', async () => {
    const minimalXml = `<?xml version="1.0" encoding="utf-8"?>
<Connections ConfVersion="2.6">
  <Node Name="Bare Node" />
</Connections>`;

    const conns = await importFromMRemoteNG(minimalXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('Bare Node');
    expect(conns[0].protocol).toBe('rdp');
    expect(conns[0].hostname).toBe('');
    expect(conns[0].port).toBe(3389);
  });

  it('defaults unknown mRemoteNG protocols and unnamed nodes to safe RDP fallbacks', async () => {
    const oddXml = `<?xml version="1.0" encoding="utf-8"?>
<Connections ConfVersion="2.6">
  <Node Protocol="CustomProto" Hostname="odd.example.com" />
</Connections>`;

    const conns = await importFromMRemoteNG(oddXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('Unnamed');
    expect(conns[0].protocol).toBe('rdp');
    expect(conns[0].hostname).toBe('odd.example.com');
  });

  it('throws when mRemoteNG XML is invalid', async () => {
    await expect(importFromMRemoteNG('<Connections><Node></Connections>')).rejects.toThrow(
      'Invalid XML format:',
    );
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

  it('imports root-level servers outside groups', async () => {
    const rootServerXml = `<?xml version="1.0" encoding="utf-8"?>
<RDCMan programVersion="2.7" schemaVersion="3">
  <file>
    <server>
      <properties>
        <displayName>Root Server</displayName>
        <name>root.example.com</name>
      </properties>
    </server>
  </file>
</RDCMan>`;

    const conns = await importFromRDCMan(rootServerXml);
    const rootServer = conns.find((c) => c.name === 'Root Server');
    expect(rootServer).toBeDefined();
    expect(rootServer!.hostname).toBe('root.example.com');
    expect(rootServer!.parentId).toBeUndefined();
  });

  it('falls back to displayName when an RDCMan server is missing its name field', async () => {
    const displayOnlyXml = `<?xml version="1.0" encoding="utf-8"?>
<RDCMan programVersion="2.7" schemaVersion="3">
  <file>
    <server>
      <properties>
        <displayName>Display Only Server</displayName>
      </properties>
    </server>
  </file>
</RDCMan>`;

    const conns = await importFromRDCMan(displayOnlyXml);

    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('Display Only Server');
    expect(conns[0].hostname).toBe('');
  });

  it('falls back to port 3389 when RDCMan provides port 0 and no credentials', async () => {
    const zeroPortXml = `<?xml version="1.0" encoding="utf-8"?>
<RDCMan programVersion="2.7" schemaVersion="3">
  <file>
    <server>
      <properties>
        <displayName>Zero Port Server</displayName>
        <name>zero.example.com</name>
      </properties>
      <connectionSettings>
        <port>0</port>
      </connectionSettings>
    </server>
  </file>
</RDCMan>`;

    const conns = await importFromRDCMan(zeroPortXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].port).toBe(3389);
    expect(conns[0].username).toBeUndefined();
    expect(conns[0].domain).toBeUndefined();
  });

  it('throws when RDCMan XML is invalid', async () => {
    await expect(importFromRDCMan('<RDCMan><file></RDCMan>')).rejects.toThrow(
      'Invalid XML format:',
    );
  });

  it('creates an unnamed group when RDCMan group metadata is missing', async () => {
    const unnamedGroupXml = `<?xml version="1.0" encoding="utf-8"?>
<RDCMan programVersion="2.7" schemaVersion="3">
  <file>
    <group>
      <server>
        <properties>
          <name>unnamed.example.com</name>
        </properties>
      </server>
    </group>
  </file>
</RDCMan>`;

    const conns = await importFromRDCMan(unnamedGroupXml);
    const group = conns.find((c) => c.isGroup);
    const server = conns.find((c) => !c.isGroup);

    expect(group).toBeDefined();
    expect(group!.name).toBe('Unnamed Group');
    expect(server!.parentId).toBe(group!.id);
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

  it('defaults unknown MobaXterm session types to SSH', async () => {
    const unknownTypeIni = `[Bookmarks]\nUnknown Host=#99#odd.example.com%2022%ops%%-1%%%%%0`;

    const conns = await importFromMobaXterm(unknownTypeIni);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('odd.example.com');
    expect(conns[0].port).toBe(2022);
  });

  it('maps Telnet and SFTP MobaXterm session types explicitly', async () => {
    const mixedIni = `[Bookmarks]\nTelnet Host=#1#telnet.example.com%0%ops%%-1%%%%%0\nSFTP Host=#7#sftp.example.com%0%sftpuser%%-1%%%%%0`;

    const conns = await importFromMobaXterm(mixedIni);
    const telnet = conns.find((c) => c.name === 'Telnet Host');
    const sftp = conns.find((c) => c.name === 'SFTP Host');

    expect(telnet).toBeDefined();
    expect(telnet!.protocol).toBe('telnet');
    expect(telnet!.port).toBe(23);
    expect(sftp).toBeDefined();
    expect(sftp!.protocol).toBe('sftp');
    expect(sftp!.port).toBe(22);
  });

  it('preserves trailing SubRep paths and allows bookmark entries without hostnames', async () => {
    const sparseIni = `[Bookmarks]\nSubRep=Nested\\\nHostless SSH=#0#%22%ops%%-1%%%%%0`;

    const conns = await importFromMobaXterm(sparseIni);
    const group = conns.find((c) => c.isGroup);
    const hostless = conns.find((c) => c.name === 'Hostless SSH');

    expect(group).toBeDefined();
    expect(group!.name).toBe('Nested\\');
    expect(hostless).toBeDefined();
    expect(hostless!.hostname).toBe('');
    expect(hostless!.parentId).toBe(group!.id);
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

  it('defaults missing PuTTY telnet ports to the protocol default', async () => {
    const missingPortReg = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Telnet%20Default]
"HostName"="telnet.example.com"
"Protocol"="telnet"`;

    const conns = await importFromPuTTY(missingPortReg);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('telnet');
    expect(conns[0].port).toBe(23);
  });

  it('decodes URL-encoded session names', async () => {
    const conns = await importFromPuTTY(reg);
    const prod = conns.find((c) => c.name === 'Production Server');
    expect(prod).toBeDefined();
  });

  it('skips PuTTY sessions that do not define a HostName', async () => {
    const missingHostReg = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Missing%20Host]
"Protocol"="ssh"`;

    const conns = await importFromPuTTY(missingHostReg);
    expect(conns).toHaveLength(0);
  });

  it('defaults PuTTY sessions without a known protocol to SSH', async () => {
    const oddProtocolReg = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Odd%20Protocol]
"HostName"="odd-protocol.example.com"
"Protocol"="custom"`;

    const conns = await importFromPuTTY(oddProtocolReg);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('odd-protocol.example.com');
  });

  it('defaults PuTTY sessions with no Protocol entry to SSH', async () => {
    const noProtocolReg = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\No%20Protocol]
"HostName"="ssh-default.example.com"`;

    const conns = await importFromPuTTY(noProtocolReg);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('ssh-default.example.com');
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

  it('assigns parentId from host group_id references', async () => {
    const groupedJson = JSON.stringify({
      groups: [{ id: 'grp-1', label: 'Shared Hosts' }],
      hosts: [{ label: 'Grouped Host', address: 'grouped.example.com', group_id: 'grp-1' }],
    });

    const conns = await importFromTermius(groupedJson);
    const group = conns.find((c) => c.isGroup && c.name === 'Shared Hosts');
    const host = conns.find((c) => c.name === 'Grouped Host');

    expect(group).toBeDefined();
    expect(host).toBeDefined();
    expect(host!.parentId).toBe(group!.id);
  });

  it('returns an empty list when Termius exports omit groups and hosts', async () => {
    const conns = await importFromTermius(JSON.stringify({ version: '1.0' }));
    expect(conns).toHaveLength(0);
  });

  it('creates unnamed Termius groups when labels are missing', async () => {
    const conns = await importFromTermius(JSON.stringify({ groups: [{ id: 'grp-1' }] }));
    expect(conns).toHaveLength(1);
    expect(conns[0].isGroup).toBe(true);
    expect(conns[0].name).toBe('Unnamed Group');
  });

  it('falls back to unnamed hosts, default port 22, and unresolved parent IDs', async () => {
    const sparseJson = JSON.stringify({
      hosts: [{ port: 0, group_id: 'missing-group' }],
    });

    const conns = await importFromTermius(sparseJson);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('Unnamed');
    expect(conns[0].hostname).toBe('');
    expect(conns[0].port).toBe(22);
    expect(conns[0].parentId).toBeUndefined();
  });

  it('normalizes invalid JSON ports to the protocol default', async () => {
    const conns = await importFromJSON(
      JSON.stringify([
        {
          name: 'JSON SSH',
          protocol: 'ssh',
          hostname: 'json-ssh.example.com',
          port: 'not-a-port',
        },
      ]),
    );

    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].port).toBe(22);
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

  it('handles root array exports with ComputerName fallback and default web port', async () => {
    const webArrayJson = JSON.stringify([
      {
        Type: 'RoyalWebConnection',
        Name: 'Portal',
        ComputerName: 'portal.example.com',
        CredentialDomain: 'CORP',
        Description: 'Portal access',
      },
    ]);

    const conns = await importFromRoyalTS(webArrayJson);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('https');
    expect(conns[0].hostname).toBe('portal.example.com');
    expect(conns[0].port).toBe(443);
    expect(conns[0].domain).toBe('CORP');
    expect(conns[0].description).toBe('Portal access');
  });

  it('defaults missing Royal TS types to RDP and falls back to URI for the name', async () => {
    const minimalRoyalJson = JSON.stringify([
      {
        URI: 'fallback.example.com',
      },
    ]);

    const conns = await importFromRoyalTS(minimalRoyalJson);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('fallback.example.com');
    expect(conns[0].protocol).toBe('rdp');
    expect(conns[0].port).toBe(3389);
  });

  it('falls back to Username and the default SSH port when Royal TS provides port 0', async () => {
    const sparseRoyalJson = JSON.stringify([
      {
        Type: 'RoyalSSHConnection',
        URI: 'ssh-zero.example.com',
        Port: 0,
        Username: 'ops',
      },
    ]);

    const conns = await importFromRoyalTS(sparseRoyalJson);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].username).toBe('ops');
    expect(conns[0].port).toBe(22);
  });

  it('handles empty Royal TS Objects arrays without producing connections', async () => {
    const conns = await importFromRoyalTS(JSON.stringify({ Objects: [] }));
    expect(conns).toHaveLength(0);
  });

  it('fills unnamed Royal TS folders and sparse connections with safe fallbacks', async () => {
    const sparseRoyalJson = JSON.stringify({
      Objects: [
        {
          Type: 'RoyalFolder',
        },
        {
          Type: 'RoyalSSHConnection',
          ComputerName: 'computer-only.example.com',
          Username: 'ops',
        },
        {
          Type: 'RoyalSSHConnection',
        },
      ],
    });

    const conns = await importFromRoyalTS(sparseRoyalJson);
    const folder = conns.find((c) => c.isGroup);
    const computerOnly = conns.find((c) => c.hostname === 'computer-only.example.com');
    const blankHost = conns.filter((c) => !c.isGroup && c.hostname === '');

    expect(folder).toBeDefined();
    expect(folder!.name).toBe('Unnamed Folder');
    expect(computerOnly).toBeDefined();
    expect(computerOnly!.name).toBe('Unnamed');
    expect(computerOnly!.username).toBe('ops');
    expect(blankHost).toHaveLength(1);
    expect(blankHost[0].name).toBe('Unnamed');
  });

  it('returns an empty list when Royal TS exports do not define Objects', async () => {
    const conns = await importFromRoyalTS(JSON.stringify({ version: '1.0' }));
    expect(conns).toHaveLength(0);
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

  it('maps RLogin sessions to the rlogin protocol', async () => {
    const rloginXml = `<?xml version="1.0" encoding="UTF-8"?>
<VanDyke>
  <Sessions>
    <Session Name="Legacy/Rlogin Host">
      <S:"Protocol Name">RLogin</S:"Protocol Name">
      <S:"Hostname">rlogin.example.com</S:"Hostname">
      <D:"Port">513</D:"Port">
    </Session>
  </Sessions>
</VanDyke>`;

    const conns = await importFromSecureCRT(rloginXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('rlogin');
    expect(conns[0].hostname).toBe('rlogin.example.com');
    expect(conns[0].port).toBe(513);
  });

  it('defaults unknown SecureCRT protocols to SSH and keeps the session name when hostname is missing', async () => {
    const oddProtocolXml = `<?xml version="1.0" encoding="UTF-8"?>
<VanDyke>
  <Sessions>
    <Session Name="Odd/Unknown Session">
      <S:"Protocol Name">CustomProto</S:"Protocol Name">
    </Session>
  </Sessions>
</VanDyke>`;

    const conns = await importFromSecureCRT(oddProtocolXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('Unknown Session');
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('');
    expect(conns[0].port).toBe(22);
  });

  it('falls back to the original SecureCRT name attribute when the leaf segment is empty', async () => {
    const trailingSlashXml = `<?xml version="1.0" encoding="UTF-8"?>
<VanDyke>
  <Sessions>
    <Session Name="Trailing/">
      <S:"Protocol Name">SSH2</S:"Protocol Name">
      <S:"Hostname">trailing.example.com</S:"Hostname">
    </Session>
  </Sessions>
</VanDyke>`;

    const conns = await importFromSecureCRT(trailingSlashXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('Trailing/');
  });

  it('uses the hostname as the SecureCRT name when the session name is blank', async () => {
    const blankNameXml = `<?xml version="1.0" encoding="UTF-8"?>
<VanDyke>
  <Sessions>
    <Session Name="">
      <S:"Protocol Name">SSH2</S:"Protocol Name">
      <S:"Hostname">host-only.example.com</S:"Hostname">
    </Session>
  </Sessions>
</VanDyke>`;

    const conns = await importFromSecureCRT(blankNameXml);
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe('host-only.example.com');
    expect(conns[0].hostname).toBe('host-only.example.com');
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

  it('imports direct array JSON with host aliases and folder flags', async () => {
    const arrayJson = JSON.stringify([
      {
        host: 'array.example.com',
        isFolder: true,
        tags: ['alpha'],
      },
    ]);

    const conns = await importFromJSON(arrayJson);
    expect(conns).toHaveLength(1);
    expect(conns[0].hostname).toBe('array.example.com');
    expect(conns[0].protocol).toBe('rdp');
    expect(conns[0].isGroup).toBe(true);
    expect(conns[0].tags).toEqual(['alpha']);
    expect(conns[0].id).toBeTruthy();
  });

  it('throws for unsupported JSON object shapes', async () => {
    await expect(importFromJSON(JSON.stringify({ invalid: true }))).rejects.toThrow(
      'Invalid JSON format: expected array or object with connections array',
    );
  });

  it('returns an empty list for JSON exports with an empty connections array', async () => {
    const conns = await importFromJSON(JSON.stringify({ connections: [] }));
    expect(conns).toHaveLength(0);
  });

  it('falls back to an empty hostname when JSON connections omit both hostname and host', async () => {
    const conns = await importFromJSON(
      JSON.stringify([
        {
          name: 'No Host Fields',
          protocol: 'ssh',
        },
      ]),
    );

    expect(conns).toHaveLength(1);
    expect(conns[0].hostname).toBe('');
    expect(conns[0].name).toBe('No Host Fields');
  });

  it('preserves passwords and explicit timestamps from direct-array JSON imports', async () => {
    const conns = await importFromJSON(
      JSON.stringify([
        {
          name: 'Secret Host',
          protocol: 'ssh',
          hostname: 'secret.example.com',
          password: 'hunter2',
          createdAt: '2024-01-02T03:04:05.000Z',
          updatedAt: '2024-06-07T08:09:10.000Z',
        },
      ]),
    );

    expect(conns).toHaveLength(1);
    expect(conns[0].password).toBe('hunter2');
    expect(conns[0].createdAt).toBe('2024-01-02T03:04:05.000Z');
    expect(conns[0].updatedAt).toBe('2024-06-07T08:09:10.000Z');
  });
});

// ──────────────────────────────────────────
// importConnections router
// ──────────────────────────────────────────
describe('importConnections router', () => {
  it('routes mremoteng format to the mRemoteNG parser', async () => {
    const content = `<?xml version="1.0"?>
<Connections ConfVersion="2.6">
  <Node Name="Direct SSH" Protocol="SSH2" Hostname="mremoteng.example.com" />
</Connections>`;

    const conns = await importConnections(content, 'mremoteng.xml', 'mremoteng');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('mremoteng.example.com');
  });

  it('routes rdcman format to the RDCMan parser', async () => {
    const content = `<?xml version="1.0"?>
<RDCMan>
  <file>
    <server>
      <properties>
        <name>rdcman.example.com</name>
      </properties>
    </server>
  </file>
</RDCMan>`;

    const conns = await importConnections(content, 'servers.rdg', 'rdcman');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('rdp');
    expect(conns[0].hostname).toBe('rdcman.example.com');
  });

  it('routes mobaxterm format to the MobaXterm parser', async () => {
    const content = `[Bookmarks]
SSH Test=#0#mobaxterm.example.com%22%root%%-1%%%%%0`;

    const conns = await importConnections(content, 'MobaXterm.ini', 'mobaxterm');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('mobaxterm.example.com');
  });

  it('routes putty format to the PuTTY parser', async () => {
    const content = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Router%20Admin]
"HostName"="putty.example.com"
"PortNumber"=dword:00000017
"Protocol"="telnet"`;

    const conns = await importConnections(content, 'putty.reg', 'putty');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('telnet');
    expect(conns[0].hostname).toBe('putty.example.com');
  });

  it('routes termius format to the Termius parser', async () => {
    const content = JSON.stringify({
      hosts: [{ label: 'Termius Host', address: 'termius.example.com', port: 22 }],
    });

    const conns = await importConnections(content, 'termius.json', 'termius');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('termius.example.com');
  });

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

  it('routes json format to the JSON parser', async () => {
    const content = JSON.stringify([
      { name: 'JSON Host', protocol: 'ssh', hostname: 'json.example.com', port: 22 },
    ]);

    const conns = await importConnections(content, 'connections.json', 'json');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('json.example.com');
  });

  it('routes csv format to the CSV parser', async () => {
    const content = [
      'Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags',
      'CSV Host,SSH,csv.example.com,22,root,,, ,false,prod',
    ].join('\n');

    const conns = await importConnections(content, 'connections.csv', 'csv');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('csv.example.com');
  });

  it('auto-detects CSV when no explicit format is provided', async () => {
    const content = [
      'Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags',
      'Auto CSV,RDP,auto.example.com,3389,admin,,, ,false,ops',
    ].join('\n');

    const conns = await importConnections(content, 'auto.csv');
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('rdp');
    expect(conns[0].hostname).toBe('auto.example.com');
  });

  it('falls back to the CSV parser when an unsupported format is forced', async () => {
    const content = [
      'Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags',
      'Fallback CSV,SSH,fallback.example.com,22,root,,, ,false,ops',
    ].join('\n');

    const conns = await importConnections(content, 'connections.csv', 'bogus' as any);
    expect(conns).toHaveLength(1);
    expect(conns[0].protocol).toBe('ssh');
    expect(conns[0].hostname).toBe('fallback.example.com');
  });
});

describe('getFormatName', () => {
  it('returns human-readable labels for each supported import format', () => {
    expect(getFormatName('mremoteng')).toBe('mRemoteNG');
    expect(getFormatName('rdcman')).toBe('Remote Desktop Connection Manager');
    expect(getFormatName('royalts')).toBe('Royal TS/TSX');
    expect(getFormatName('mobaxterm')).toBe('MobaXterm');
    expect(getFormatName('putty')).toBe('PuTTY');
    expect(getFormatName('securecrt')).toBe('SecureCRT');
    expect(getFormatName('termius')).toBe('Termius');
    expect(getFormatName('csv')).toBe('CSV');
    expect(getFormatName('json')).toBe('JSON');
  });

  it('falls back to the raw format string for unknown values', () => {
    expect(getFormatName('custom' as any)).toBe('custom');
  });
});
