/** Mirrors the serde (camelCase) types of the `sorng-arista` crate. */
export interface AristaConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  useHttps?: boolean;
  insecureTls?: boolean;
  timeoutSecs?: number;
}

export interface AristaFan {
  trayLabel: string;
  /** "fanTray" | "powerSupply" */
  trayKind: string;
  fanLabel: string;
  status: string | null;
  actualSpeedPct: number | null;
  configuredSpeedPct: number | null;
  rpm: number | null;
  maxRpm: number | null;
  uptimeSecs: number | null;
}

export interface AristaCoolingReport {
  systemStatus: string | null;
  airflow: string | null;
  ambientC: number | null;
  fans: AristaFan[];
  source: string;
}
