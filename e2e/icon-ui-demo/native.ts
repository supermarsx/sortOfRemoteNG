import { demo, refuse } from "./boundary";
export const isTauri = () => true;
export const invoke = async (command: string) => refuse("native " + command);
export const listen = async (event: string) => refuse("native event " + event);
export const emit = async (event: string) => refuse("native emit " + event);
export const convertFileSrc = () => refuse("native file URL");
export const transformCallback = () => refuse("native callback");
export const addPluginListener = () => refuse("native plugin listener");
export const checkPermissions = () => refuse("native permissions");
export const requestPermissions = () => refuse("native permissions");
export const SERIALIZE_TO_IPC_FN = "__ISOLATED_ICON_DEMO__";
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
    refuse("native listener");
  }
}
export const open = async () => {
  demo.calls.push("synthetic Open");
  return "review-fixture.json";
};
export const save = async () => refuse("native Save");
export const stat = async (path: string) => {
  if (path !== "review-fixture.json") refuse("unexpected stat");
  demo.calls.push("synthetic stat");
  return { isFile: true, size: new TextEncoder().encode(demo.pack).byteLength };
};
export const readTextFile = async (path: string) => {
  if (path !== "review-fixture.json") refuse("unexpected read");
  demo.calls.push("synthetic read");
  return demo.pack;
};
export const writeTextFile = async () => refuse("filesystem write");
