import { Connection } from '../../types/connection';
import { generateId } from '../../utils/id';

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
      createdAt: new Date(conn.CreatedAt || Date.now()),
      updatedAt: new Date(conn.UpdatedAt || Date.now())
    });
  }

  return connections;
};