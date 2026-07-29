import { invoke } from "@tauri-apps/api/core";

import type { Connection } from "../../types/connection/connection";
import type { BuiltInManagementRuntimeProtocol } from "./builtInManagementRuntimeRegistry";

export interface BmcRuntimeAdapter {
  protocol: Exclude<BuiltInManagementRuntimeProtocol, "idrac">;
  displayName: string;
  connect: (connection: Connection) => Promise<void>;
  disconnect: () => Promise<void>;
}

export const iloRuntimeAdapter: BmcRuntimeAdapter = {
  protocol: "ilo",
  displayName: "HPE iLO",
  async connect(connection) {
    const settings = connection.iloSettings;
    await invoke<string>("ilo_connect", {
      host: connection.hostname,
      port: connection.port ?? 443,
      username: connection.username ?? "",
      password: connection.password ?? "",
      authMethod: settings?.authMethod ?? "session",
      protocol: settings?.protocol,
      insecure: settings?.insecure ?? true,
      timeoutSecs: settings?.timeoutSecs ?? 30,
      ipmiPort: settings?.ipmiPort ?? 623,
      generation: settings?.generation,
    });
  },
  async disconnect() {
    await invoke<void>("ilo_disconnect");
  },
};

export const lenovoRuntimeAdapter: BmcRuntimeAdapter = {
  protocol: "lenovo",
  displayName: "Lenovo XClarity",
  async connect(connection) {
    const settings = connection.lenovoSettings;
    await invoke<string>("lenovo_connect", {
      host: connection.hostname,
      port: connection.port ?? 443,
      username: connection.username ?? "",
      password: connection.password ?? "",
      protocol: settings?.protocol,
      insecure: settings?.insecure ?? true,
      timeoutSecs: settings?.timeoutSecs ?? 30,
      ipmiPort: settings?.ipmiPort ?? 623,
      generation: settings?.generation,
    });
  },
  async disconnect() {
    await invoke<void>("lenovo_disconnect");
  },
};

export const supermicroRuntimeAdapter: BmcRuntimeAdapter = {
  protocol: "supermicro",
  displayName: "Supermicro BMC",
  async connect(connection) {
    const settings = connection.supermicroSettings;
    await invoke<void>("smc_connect", {
      config: {
        host: connection.hostname,
        port: connection.port ?? 443,
        username: connection.username ?? "",
        password: connection.password ?? "",
        useSsl: settings?.useSsl ?? true,
        verifyCert: settings?.verifyCert ?? false,
        platform: settings?.platform ?? "unknown",
        authMethod: settings?.authMethod ?? "session",
        timeoutSecs: settings?.timeoutSecs ?? 30,
      },
    });
  },
  async disconnect() {
    await invoke<void>("smc_disconnect");
  },
};
