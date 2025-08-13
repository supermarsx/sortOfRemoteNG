import fs from 'fs';
import path from 'path';

function dateReviver(key: string, value: any): any {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime()) && value.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\./)) {
      return date;
    }
  }
  return value;
}

export function loadJson<T>(filePath: string, defaultValue: T): T {
  try {
    const fullPath = path.resolve(filePath);
    const data = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(data, dateReviver) as T;
  } catch {
    return defaultValue;
  }
}

export function saveJson<T>(filePath: string, data: T): void {
  const fullPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
}

