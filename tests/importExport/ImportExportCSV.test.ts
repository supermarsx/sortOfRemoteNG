import { describe, it, expect } from 'vitest';
import { importFromCSV, parseCSVLine, detectImportFormat } from '../../src/components/ImportExport/utils';

const csvHeaders = 'ID,Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags,CreatedAt,UpdatedAt';
const csvRow = '1,Test,RDP,example.com,3389,user,,desc,,false,tag1;tag2,2024-01-01T00:00:00.000Z,2024-01-01T00:00:00.000Z';

describe('importFromCSV', () => {
  it('imports CSV with LF line endings', async () => {
    const csv = `${csvHeaders}\n${csvRow}\n`;
    const connections = await importFromCSV(csv);
    expect(connections).toHaveLength(1);
    expect(connections[0].hostname).toBe('example.com');
  });

  it('imports CSV with CRLF line endings', async () => {
    const csv = `${csvHeaders}\r\n${csvRow}\r\n`;
    const connections = await importFromCSV(csv);
    expect(connections).toHaveLength(1);
    expect(connections[0].hostname).toBe('example.com');
  });
});

describe('exports connections as CSV', () => {
  it('importFromCSV round-trips a CSV row back to connection fields', async () => {
    const csv = [
      csvHeaders,
      'abc-123,Web Server,ssh,10.0.0.1,22,root,,Production server,,false,web;prod,2025-06-01T00:00:00.000Z,2025-06-01T00:00:00.000Z',
    ].join('\n');
    const connections = await importFromCSV(csv);
    expect(connections).toHaveLength(1);
    expect(connections[0].name).toBe('Web Server');
    expect(connections[0].protocol).toBe('ssh');
    expect(connections[0].hostname).toBe('10.0.0.1');
    expect(connections[0].port).toBe(22);
    expect(connections[0].username).toBe('root');
    expect(connections[0].tags).toEqual(['web', 'prod']);
  });
});

describe('imports connections from CSV', () => {
  it('imports multiple rows', async () => {
    const csv = [
      csvHeaders,
      '1,Server A,ssh,10.0.0.1,22,root,,,,,,,',
      '2,Server B,rdp,10.0.0.2,3389,admin,,,,,,,',
      '3,Server C,vnc,10.0.0.3,5900,viewer,,,,,,,',
    ].join('\n');
    const connections = await importFromCSV(csv);
    expect(connections).toHaveLength(3);
    expect(connections[0].name).toBe('Server A');
    expect(connections[1].protocol).toBe('rdp');
    expect(connections[2].port).toBe(5900);
  });

  it('handles quoted fields with commas', async () => {
    const csv = [
      csvHeaders,
      '1,"Server, Main",rdp,host.local,3389,admin,,,"",false,,2024-01-01T00:00:00.000Z,2024-01-01T00:00:00.000Z',
    ].join('\n');
    const connections = await importFromCSV(csv);
    expect(connections).toHaveLength(1);
    expect(connections[0].name).toBe('Server, Main');
  });

  it('assigns default protocol when missing', async () => {
    const csv = [
      csvHeaders,
      '1,NoProto,,host.local,,,,,,false,,,',
    ].join('\n');
    const connections = await importFromCSV(csv);
    expect(connections).toHaveLength(1);
    expect(connections[0].protocol).toBe('rdp');
  });
});

describe('handles import errors gracefully', () => {
  it('throws on empty CSV (no data rows)', async () => {
    await expect(importFromCSV('')).rejects.toThrow('CSV file must have headers and at least one data row');
  });

  it('throws on CSV with only headers', async () => {
    await expect(importFromCSV(csvHeaders)).rejects.toThrow('CSV file must have headers and at least one data row');
  });

  it('skips rows with mismatched column count', async () => {
    const csv = [
      csvHeaders,
      '1,Valid,rdp,host.com,3389,user,,desc,,false,,2024-01-01T00:00:00.000Z,2024-01-01T00:00:00.000Z',
      '2,Invalid,rdp',  // too few columns — should be skipped
    ].join('\n');
    const connections = await importFromCSV(csv);
    expect(connections).toHaveLength(1);
    expect(connections[0].name).toBe('Valid');
  });
});

describe('validates import data format', () => {
  it('parseCSVLine splits simple values', () => {
    const result = parseCSVLine('a,b,c');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('parseCSVLine handles quoted values with embedded commas', () => {
    const result = parseCSVLine('"hello, world",foo,bar');
    expect(result).toEqual(['hello, world', 'foo', 'bar']);
  });

  it('parseCSVLine handles escaped double quotes', () => {
    const result = parseCSVLine('"say ""hi""",b,c');
    expect(result).toEqual(['say "hi"', 'b', 'c']);
  });

  it('detectImportFormat identifies CSV from content', () => {
    const format = detectImportFormat(csvHeaders + '\n' + csvRow);
    expect(format).toBe('csv');
  });

  it('detectImportFormat identifies CSV from filename', () => {
    expect(detectImportFormat('any content', 'connections.csv')).toBe('csv');
  });

  it('detectImportFormat identifies JSON from content', () => {
    expect(detectImportFormat('[{"name":"test"}]')).toBe('json');
  });

  it('detectImportFormat identifies mRemoteNG XML', () => {
    const xml = '<?xml version="1.0"?><Connections ConfVersion="2.6" />';
    expect(detectImportFormat(xml)).toBe('mremoteng');
  });

  it('assigns isGroup correctly from CSV', async () => {
    const csv = [
      csvHeaders,
      '1,MyFolder,rdp,,,,,,,true,,2024-01-01T00:00:00.000Z,2024-01-01T00:00:00.000Z',
    ].join('\n');
    const connections = await importFromCSV(csv);
    expect(connections[0].isGroup).toBe(true);
  });

  it('parses tags from semicolon-delimited string', async () => {
    const csv = [
      csvHeaders,
      '1,Test,rdp,host,3389,,,,,,alpha;beta;gamma,2024-01-01T00:00:00.000Z,2024-01-01T00:00:00.000Z',
    ].join('\n');
    const connections = await importFromCSV(csv);
    expect(connections[0].tags).toEqual(['alpha', 'beta', 'gamma']);
  });
});
