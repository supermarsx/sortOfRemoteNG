import { describe, it, expect } from 'vitest';
import { importFromCSV } from '../src/components/ImportExport/utils';

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
