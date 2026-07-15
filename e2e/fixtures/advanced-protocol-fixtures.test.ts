import dgram from "node:dgram";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_HOST,
  startRawTcpFixture,
  startRawUdpFixture,
  startRloginFixture,
  type RawTcpFixture,
  type RawUdpFixture,
  type RloginFixture,
} from "../helpers/advanced-protocol-fixtures";

const openFixtures: Array<RawTcpFixture | RawUdpFixture | RloginFixture> = [];

afterEach(async () => {
  await Promise.all(openFixtures.splice(0).map((fixture) => fixture.close()));
});

function connectTcp(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: FIXTURE_HOST, port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readExactly(socket: net.Socket, byteLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length >= byteLength) {
        cleanup();
        resolve(bytes.subarray(0, byteLength));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

describe("advanced protocol loopback fixtures", () => {
  it("echoes binary TCP data and observes a client write half-close", async () => {
    const fixture = await startRawTcpFixture();
    openFixtures.push(fixture);
    expect(fixture.host).toBe(FIXTURE_HOST);

    const socket = await connectTcp(fixture.port);
    const payload = Buffer.from([0x74, 0x65, 0x78, 0x74, 0x00, 0xff]);
    const echoed = readExactly(socket, payload.length);
    socket.end(payload);

    expect(await echoed).toEqual(payload);
    await fixture.waitForPayload(payload);
    await fixture.waitForHalfCloses(1);
    expect(fixture.snapshot()).toMatchObject({ connections: 1, halfCloses: 1 });
  });

  it("bounds concurrent TCP clients without exhausting sequential reconnects", async () => {
    const fixture = await startRawTcpFixture();
    openFixtures.push(fixture);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const socket = await connectTcp(fixture.port);
      const payload = Buffer.from([attempt]);
      const echoed = readExactly(socket, payload.length);
      socket.end(payload);
      expect(await echoed).toEqual(payload);
      await new Promise<void>((resolve) => socket.once("close", resolve));
    }

    expect(fixture.snapshot()).toMatchObject({
      connections: 12,
      activeConnections: 0,
      rejectedConnections: 0,
    });

    await fixture.close();
    const freshFixture = await startRawTcpFixture();
    openFixtures.push(freshFixture);
    const socket = await connectTcp(freshFixture.port);
    expect(freshFixture.snapshot()).toMatchObject({
      connections: 1,
      rejectedConnections: 0,
    });
    socket.end();
  });

  it("preserves binary and empty UDP datagram boundaries", async () => {
    const fixture = await startRawUdpFixture();
    openFixtures.push(fixture);
    const client = dgram.createSocket("udp4");
    const replies: Buffer[] = [];
    client.on("message", (message) => replies.push(Buffer.from(message)));
    await new Promise<void>((resolve) => client.bind(0, FIXTURE_HOST, resolve));

    const send = (payload: Buffer) =>
      new Promise<void>((resolve, reject) =>
        client.send(payload, fixture.port, fixture.host, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    await send(Buffer.from([0x00, 0xff, 0x41]));
    await send(Buffer.alloc(0));
    await fixture.waitForDatagrams(2);
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("UDP echo timed out")),
        2_000,
      );
      const poll = () => {
        if (replies.length >= 2) {
          clearTimeout(deadline);
          resolve();
        } else setTimeout(poll, 5);
      };
      poll();
    });

    expect(fixture.snapshot().datagrams).toEqual([
      Buffer.from([0x00, 0xff, 0x41]),
      Buffer.alloc(0),
    ]);
    expect(replies).toEqual([Buffer.from([0x00, 0xff, 0x41]), Buffer.alloc(0)]);
    await new Promise<void>((resolve) => client.close(resolve));
  });

  it("captures exact RLogin handshakes, remote echo, resize frames, and reconnects", async () => {
    const greeting = Buffer.from("fixture-ready\r\n");
    const fixture = await startRloginFixture({ kind: "accept", greeting });
    openFixtures.push(fixture);
    const handshake = Buffer.from("\0alice\0root\0xterm/38400\0", "binary");

    const first = await connectTcp(fixture.port);
    const firstReply = readExactly(first, 1 + greeting.length);
    first.write(handshake);
    expect(await firstReply).toEqual(
      Buffer.concat([Buffer.from([0]), greeting]),
    );

    const terminal = Buffer.from("whoami\r");
    const remoteEcho = readExactly(first, terminal.length);
    first.write(terminal);
    expect(await remoteEcho).toEqual(terminal);

    const resize = Buffer.from([
      0xff, 0xff, 0x73, 0x73, 0x00, 0x28, 0x00, 0x78, 0x03, 0x20, 0x02, 0x58,
    ]);
    first.write(resize.subarray(0, 6));
    await new Promise((resolve) => setTimeout(resolve, 10));
    first.write(resize.subarray(6));
    await fixture.waitForWindowSizes(1);
    first.end();

    const second = await connectTcp(fixture.port);
    const ack = readExactly(second, 1 + greeting.length);
    second.write(handshake);
    expect(await ack).toEqual(Buffer.concat([Buffer.from([0]), greeting]));
    second.end();

    await fixture.waitForConnections(2);
    await fixture.waitForHandshakes(2);
    await fixture.waitForTerminalInput(terminal);
    expect(fixture.snapshot()).toMatchObject({
      connections: 2,
      handshakes: [handshake, handshake],
      windowSizes: [
        { rows: 40, columns: 120, widthPixels: 800, heightPixels: 600 },
      ],
    });
  });

  it("returns a bounded server diagnostic rejection", async () => {
    const fixture = await startRloginFixture({
      kind: "diagnostic",
      message: "policy rejected this fixture account",
    });
    openFixtures.push(fixture);
    const socket = await connectTcp(fixture.port);
    const response = readExactly(socket, 39);
    socket.write(Buffer.from("\0alice\0root\0xterm/38400\0", "binary"));
    expect((await response).toString("binary")).toBe(
      "\x01policy rejected this fixture account\r\n",
    );
    await fixture.waitForHandshakes(1);
  });
});
