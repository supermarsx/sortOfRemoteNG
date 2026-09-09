import { refuse } from "./boundary";
export const isTauri = () => false;
export const invoke = async (command: string) =>
  refuse(`native command ${command}`);
export const listen = async (event: string) => refuse(`native event ${event}`);
export const emit = async (event: string) => refuse(`native event ${event}`);
export const convertFileSrc = () => refuse("native file URL");
export class Channel {
  constructor() {
    refuse("native channel");
  }
}
export class Resource {
  constructor() {
    refuse("native resource");
  }
}
export class PluginListener {
  constructor() {
    refuse("native plugin listener");
  }
}
export const SERIALIZE_TO_IPC_FN = "__ISOLATED_DEMO_NO_IPC__";
export const transformCallback = () => refuse("native callback");
export const addPluginListener = () => refuse("native plugin listener");
export const checkPermissions = () => refuse("native permissions");
export const requestPermissions = () => refuse("native permissions request");
