export function refuse(operation: string): never {
  window.__WEB_AUTOMATION_DEMO__.refused.push(operation);
  throw new Error(`Isolated fixture refuses ${operation}`);
}
export const invoke = (command: string) => refuse(`native ${command}`);
export const listen = (event: string) => refuse(`native event ${event}`);
