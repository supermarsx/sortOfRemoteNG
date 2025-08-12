export function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const randomPart = Math.random().toString(36).slice(2);
  const timePart = Date.now().toString(36);
  return randomPart + timePart;
}
