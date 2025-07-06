export const DEFAULT_PORTS: Record<string, number> = {
  rdp: 3389,
  ssh: 22,
  vnc: 5900,
  http: 80,
  https: 443,
  telnet: 23,
  rlogin: 513,
};

export const getDefaultPort = (protocol: string): number => {
  return DEFAULT_PORTS[protocol] ?? 22;
};

export default getDefaultPort;
