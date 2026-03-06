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

export async function loadJson<T>(
  filePath: string,
  defaultValue: T
): Promise<T> {
  try {
    const fullPath = path.resolve(filePath);
    const data = await fs.promises.readFile(fullPath, 'utf8');
    return JSON.parse(data, dateReviver) as T;
  } catch {
    return defaultValue;
  }
}

export async function saveJson<T>(
  filePath: string,
  data: T
): Promise<void> {
  const fullPath = path.resolve(filePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(
    fullPath,
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

