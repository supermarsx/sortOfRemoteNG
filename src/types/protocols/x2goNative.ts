import type {
  X2goClipboardMode,
  X2goCompression,
  X2goSessionType,
  X2goSharedFolder,
} from "../x2go";

/** Persisted editor options consumed by the native X2Go handoff. */
export interface X2goNativeSavedOptions {
  x2goSessionType?: X2goSessionType;
  x2goCommand?: string;
  x2goNativeClientPath?: string;
  x2goAuthMode?: "password" | "privateKey" | "agent" | "gssapi";
  x2goFullscreen?: boolean;
  x2goWidth?: number;
  x2goHeight?: number;
  x2goCompression?: X2goCompression;
  x2goDpi?: number;
  x2goKeyboardLayout?: string;
  x2goKeyboardModel?: string;
  x2goAudioEnabled?: boolean;
  x2goPrintingEnabled?: boolean;
  x2goClipboard?: X2goClipboardMode;
  x2goRootless?: boolean;
  x2goPublishedApplications?: boolean;
  x2goSharedFolders?: X2goSharedFolder[];
}

/** Truthful process-level status returned by `get_x2go_session_info`. */
export interface X2goNativeSessionInfo {
  id: string;
  host: string;
  username: string;
  state: "Running" | "Ended" | "Failed" | string;
  native_client_pid?: number | null;
  runtime_mode: "native-x2goclient-handoff";
  remote_authentication_confirmed: false;
  last_activity: string;
}
