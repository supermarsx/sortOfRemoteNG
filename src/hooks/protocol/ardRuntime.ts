import type { Connection } from "../../types/connection/connection";
import type { ArdFrameMetadata } from "../../types/protocols/ard";

export interface ArdDeliveredFrame {
  metadata: ArdFrameMetadata;
  data: Uint8Array;
}

export type ArdBinaryPayload = ArrayBuffer | Uint8Array | number[];

const asBytes = (value: ArdBinaryPayload): Uint8Array =>
  Array.isArray(value)
    ? Uint8Array.from(value)
    : value instanceof Uint8Array
      ? value.slice()
      : new Uint8Array(value.slice(0));

/** Pairs Tauri's binary frame channel with its ordered rectangle metadata. */
export class ArdFrameAssembler {
  private readonly dataQueue: Uint8Array[] = [];
  private readonly metadataQueue: ArdFrameMetadata[] = [];

  constructor(private readonly deliver: (frame: ArdDeliveredFrame) => void) {}

  acceptData(value: ArdBinaryPayload): void {
    this.dataQueue.push(asBytes(value));
    this.drain();
  }

  acceptMetadata(value: ArdFrameMetadata): void {
    this.metadataQueue.push(value);
    this.drain();
  }

  clear(): void {
    this.dataQueue.length = 0;
    this.metadataQueue.length = 0;
  }

  private drain(): void {
    while (this.dataQueue.length > 0 && this.metadataQueue.length > 0) {
      const data = this.dataQueue.shift();
      const metadata = this.metadataQueue.shift();
      if (data && metadata) this.deliver({ data, metadata });
    }
  }
}

/** The embedded ARD engine is direct TCP only; reject saved routes explicitly. */
export function ardUnsupportedNetworkPath(
  connection: Connection,
): string | null {
  const security = connection.security;
  const hasLegacyRoute =
    security?.proxy?.enabled === true ||
    security?.openvpn?.enabled === true ||
    security?.sshTunnel?.enabled === true ||
    (security?.tunnelChain?.length ?? 0) > 0;
  if (
    connection.proxyChainId ||
    connection.connectionChainId ||
    connection.tunnelChainId ||
    hasLegacyRoute
  ) {
    return "Apple Remote Desktop currently supports direct TCP connections only. Remove the configured proxy/tunnel chain or connect through an externally established route.";
  }
  return null;
}

const NAMED_KEYSYMS: Readonly<Record<string, number>> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  Shift: 0xffe1,
  Control: 0xffe3,
  Meta: 0xffe7,
  Alt: 0xffe9,
  CapsLock: 0xffe5,
};

for (let index = 1; index <= 12; index += 1) {
  (NAMED_KEYSYMS as Record<string, number>)[`F${index}`] = 0xffbd + index;
}

export function ardKeysymForKey(key: string): number | null {
  const named = NAMED_KEYSYMS[key];
  if (named !== undefined) return named;
  const codePoint = Array.from(key)[0]?.codePointAt(0);
  if (codePoint === undefined || Array.from(key).length !== 1) return null;
  return codePoint >= 0x20 && codePoint <= 0xff
    ? codePoint
    : 0x0100_0000 + codePoint;
}
