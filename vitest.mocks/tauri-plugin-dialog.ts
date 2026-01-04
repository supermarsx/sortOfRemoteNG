// Mock for @tauri-apps/plugin-dialog
export const open = async (_options?: unknown) => null;
export const save = async (_options?: unknown) => null;
export const message = async (_message: string, _options?: unknown) => {};
export const ask = async (_message: string, _options?: unknown) => false;
export const confirm = async (_message: string, _options?: unknown) => false;

export default {
  open,
  save,
  message,
  ask,
  confirm
};
