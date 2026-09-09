/** Isolated documentation fixture: no native events, windows or transports. */
import { refuse } from "./failures";
export const listen = async () => () => {};
export const once = listen;
export const emit = async () => refuse("native event emission");
export const emitTo = emit;
export const TauriEvent = {
  WINDOW_CLOSE_REQUESTED: "tauri://close-requested",
  WINDOW_RESIZED: "tauri://resize",
  WINDOW_FOCUS: "tauri://focus",
  WINDOW_BLUR: "tauri://blur",
};
