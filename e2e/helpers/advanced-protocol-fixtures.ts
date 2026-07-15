import dgram, { type RemoteInfo } from "node:dgram";
import net, { type AddressInfo, type Socket } from "node:net";

export const FIXTURE_HOST = "127.0.0.1";
export const FIXTURE_MAX_CONNECTIONS = 8;
export const FIXTURE_MAX_BYTES = 64 * 1024;
export const FIXTURE_WAIT_MS = 2_000;

type ClosableFixture = {
  readonly host: typeof FIXTURE_HOST;
  readonly port: number;
  close(): Promise<void>;
};

const cloneBuffers = (buffers: readonly Buffer[]): Buffer[] =>
  buffers.map((buffer) => Buffer.from(buffer));

async function waitFor<T>(
  description: string,
  read: () => T | undefined,
  timeoutMs = FIXTURE_WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function listenTcp(server: net.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: FIXTURE_HOST, port: 0, exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  if (address.address !== FIXTURE_HOST) {
    server.close();
    throw new Error(`Fixture escaped loopback: ${address.address}`);
  }
  return address.port;
}

async function closeTcpServer(
  server: net.Server,
  sockets: Set<Socket>,
): Promise<void> {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export interface RawTcpFixture extends ClosableFixture {
  snapshot(): {
    connections: number;
    activeConnections: number;
    rejectedConnections: number;
    halfCloses: number;
    payloads: Buffer[];
  };
  waitForConnections(count: number): Promise<void>;
  waitForHalfCloses(count: number): Promise<void>;
  waitForPayload(expected: Uint8Array): Promise<void>;
}

export async function startRawTcpFixture(): Promise<RawTcpFixture> {
  const sockets = new Set<Socket>();
  const payloads: Buffer[] = [];
  let connections = 0;
  let rejectedConnections = 0;
  let halfCloses = 0;
  let receivedBytes = 0;

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    if (sockets.size >= FIXTURE_MAX_CONNECTIONS) {
      rejectedConnections += 1;
      socket.destroy(new Error("fixture connection limit exceeded"));
      return;
    }
    connections += 1;
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("data", (data) => {
      receivedBytes += data.length;
      if (receivedBytes > FIXTURE_MAX_BYTES) {
        socket.destroy(new Error("fixture byte limit exceeded"));
        return;
      }
      payloads.push(Buffer.from(data));
      socket.write(data);
    });
    socket.on("end", () => {
      halfCloses += 1;
      socket.end();
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
  });
  const port = await listenTcp(server);

  const snapshot = () => ({
    connections,
    activeConnections: sockets.size,
    rejectedConnections,
    halfCloses,
    payloads: cloneBuffers(payloads),
  });

  return {
    host: FIXTURE_HOST,
    port,
    snapshot,
    async waitForConnections(count) {
      await waitFor(`${count} TCP connection(s)`, () =>
        connections >= count ? true : undefined,
      );
    },
    async waitForHalfCloses(count) {
      await waitFor(`${count} TCP half-close(s)`, () =>
        halfCloses >= count ? true : undefined,
      );
    },
    async waitForPayload(expected) {
      const needle = Buffer.from(expected);
      await waitFor(`TCP payload ${needle.toString("hex")}`, () =>
        Buffer.concat(payloads).includes(needle) ? true : undefined,
      );
    },
    close: () => closeTcpServer(server, sockets),
  };
}

export interface RawUdpFixture extends ClosableFixture {
  snapshot(): { datagrams: Buffer[]; peers: RemoteInfo[] };
  waitForDatagrams(count: number): Promise<void>;
}

export async function startRawUdpFixture(): Promise<RawUdpFixture> {
  const socket = dgram.createSocket("udp4");
  const datagrams: Buffer[] = [];
  const peers: RemoteInfo[] = [];
  let receivedBytes = 0;
  socket.on("message", (message, peer) => {
    if (datagrams.length >= FIXTURE_MAX_CONNECTIONS) return;
    receivedBytes += message.length;
    if (receivedBytes > FIXTURE_MAX_BYTES) return;
    datagrams.push(Buffer.from(message));
    peers.push({ ...peer });
    socket.send(message, peer.port, peer.address);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind({ address: FIXTURE_HOST, port: 0, exclusive: true }, () => {
      socket.off("error", reject);
      resolve();
    });
  });
  const address = socket.address();
  if (address.address !== FIXTURE_HOST) {
    socket.close();
    throw new Error(`Fixture escaped loopback: ${address.address}`);
  }

  return {
    host: FIXTURE_HOST,
    port: address.port,
    snapshot: () => ({ datagrams: cloneBuffers(datagrams), peers: [...peers] }),
    async waitForDatagrams(count) {
      await waitFor(`${count} UDP datagram(s)`, () =>
        datagrams.length >= count ? true : undefined,
      );
    },
    async close() {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}

export type RloginFixtureMode =
  | { kind: "accept"; greeting?: Uint8Array }
  | { kind: "diagnostic"; message: string };

export type CapturedWindowSize = {
  rows: number;
  columns: number;
  widthPixels: number;
  heightPixels: number;
};

export interface RloginFixture extends ClosableFixture {
  snapshot(): {
    connections: number;
    activeConnections: number;
    rejectedConnections: number;
    handshakes: Buffer[];
    terminalInput: Buffer[];
    windowSizes: CapturedWindowSize[];
  };
  waitForConnections(count: number): Promise<void>;
  waitForHandshakes(count: number): Promise<void>;
  waitForTerminalInput(expected: Uint8Array): Promise<void>;
  waitForWindowSizes(count: number): Promise<void>;
}

const WINDOW_MAGIC = Buffer.from([0xff, 0xff, 0x73, 0x73]);

function captureRloginData(
  socket: Socket,
  payload: Buffer,
  terminalInput: Buffer[],
  windowSizes: CapturedWindowSize[],
  pending: Buffer,
): Buffer {
  const data = pending.length ? Buffer.concat([pending, payload]) : payload;
  const emitTerminal = (terminal: Buffer) => {
    if (terminal.length === 0) return;
    terminalInput.push(Buffer.from(terminal));
    socket.write(terminal);
  };
  let cursor = 0;
  while (cursor < data.length) {
    const magicAt = data.indexOf(WINDOW_MAGIC, cursor);
    if (magicAt < 0) {
      let carryLength = 0;
      const maxPrefix = Math.min(WINDOW_MAGIC.length - 1, data.length - cursor);
      for (let length = maxPrefix; length > 0; length -= 1) {
        if (
          data
            .subarray(data.length - length)
            .equals(WINDOW_MAGIC.subarray(0, length))
        ) {
          carryLength = length;
          break;
        }
      }
      const terminalEnd = data.length - carryLength;
      emitTerminal(data.subarray(cursor, terminalEnd));
      return Buffer.from(data.subarray(terminalEnd));
    }
    if (magicAt > cursor) {
      emitTerminal(data.subarray(cursor, magicAt));
    }
    if (data.length - magicAt < 12) {
      return Buffer.from(data.subarray(magicAt));
    }
    windowSizes.push({
      rows: data.readUInt16BE(magicAt + 4),
      columns: data.readUInt16BE(magicAt + 6),
      widthPixels: data.readUInt16BE(magicAt + 8),
      heightPixels: data.readUInt16BE(magicAt + 10),
    });
    cursor = magicAt + 12;
  }
  return Buffer.alloc(0);
}

export async function startRloginFixture(
  mode: RloginFixtureMode = { kind: "accept" },
): Promise<RloginFixture> {
  const sockets = new Set<Socket>();
  const handshakes: Buffer[] = [];
  const terminalInput: Buffer[] = [];
  const windowSizes: CapturedWindowSize[] = [];
  let connections = 0;
  let rejectedConnections = 0;
  let receivedBytes = 0;

  const server = net.createServer((socket) => {
    if (sockets.size >= FIXTURE_MAX_CONNECTIONS) {
      rejectedConnections += 1;
      socket.destroy(new Error("fixture connection limit exceeded"));
      return;
    }
    connections += 1;
    sockets.add(socket);
    socket.setNoDelay(true);
    let handshake = Buffer.alloc(0);
    let pendingApplicationData: Buffer = Buffer.alloc(0);
    let accepted = false;

    socket.on("data", (chunk) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += data.length;
      if (receivedBytes > FIXTURE_MAX_BYTES) {
        socket.destroy(new Error("fixture byte limit exceeded"));
        return;
      }
      if (accepted) {
        pendingApplicationData = captureRloginData(
          socket,
          data,
          terminalInput,
          windowSizes,
          pendingApplicationData,
        );
        return;
      }

      handshake = Buffer.concat([handshake, data]);
      let nulCount = 0;
      let end = -1;
      for (let index = 0; index < handshake.length; index += 1) {
        if (handshake[index] === 0 && ++nulCount === 4) {
          end = index + 1;
          break;
        }
      }
      if (end < 0) return;

      handshakes.push(Buffer.from(handshake.subarray(0, end)));
      const remainder = Buffer.from(handshake.subarray(end));
      handshake = Buffer.alloc(0);
      if (mode.kind === "diagnostic") {
        socket.end(
          Buffer.concat([Buffer.from([1]), Buffer.from(`${mode.message}\r\n`)]),
        );
        return;
      }

      accepted = true;
      socket.write(Buffer.from([0]));
      if (mode.greeting?.length) socket.write(mode.greeting);
      if (remainder.length) {
        pendingApplicationData = captureRloginData(
          socket,
          remainder,
          terminalInput,
          windowSizes,
          pendingApplicationData,
        );
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
  });
  const port = await listenTcp(server);

  const snapshot = () => ({
    connections,
    activeConnections: sockets.size,
    rejectedConnections,
    handshakes: cloneBuffers(handshakes),
    terminalInput: cloneBuffers(terminalInput),
    windowSizes: windowSizes.map((size) => ({ ...size })),
  });

  return {
    host: FIXTURE_HOST,
    port,
    snapshot,
    async waitForConnections(count) {
      await waitFor(`${count} RLogin connection(s)`, () =>
        connections >= count ? true : undefined,
      );
    },
    async waitForHandshakes(count) {
      await waitFor(`${count} RLogin handshake(s)`, () =>
        handshakes.length >= count ? true : undefined,
      );
    },
    async waitForTerminalInput(expected) {
      const needle = Buffer.from(expected);
      await waitFor(`RLogin input ${needle.toString("hex")}`, () =>
        Buffer.concat(terminalInput).includes(needle) ? true : undefined,
      );
    },
    async waitForWindowSizes(count) {
      await waitFor(`${count} RLogin resize frame(s)`, () =>
        windowSizes.length >= count ? true : undefined,
      );
    },
    close: () => closeTcpServer(server, sockets),
  };
}
