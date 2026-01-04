// Mock for @tauri-apps/plugin-fs
export const readTextFile = async (_path: string) => '';
export const writeTextFile = async (_path: string, _content: string) => {};
export const exists = async (_path: string) => false;
export const mkdir = async (_path: string, _options?: { recursive?: boolean }) => {};
export const readDir = async (_path: string) => [];
export const remove = async (_path: string, _options?: { recursive?: boolean }) => {};
export const rename = async (_from: string, _to: string) => {};
export const copyFile = async (_from: string, _to: string) => {};
export const stat = async (_path: string) => ({ isFile: true, isDirectory: false, size: 0 });

export default {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  readDir,
  remove,
  rename,
  copyFile,
  stat
};
