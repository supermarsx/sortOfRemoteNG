import {
  closeAllSessions,
  createCollection,
  resetAppState,
} from "../../helpers/app";
import { selectCustomOption } from "../../helpers/forms";
import { S } from "../../helpers/selectors";
import {
  openConnectionItem,
  waitForConnectionItem,
  waitForSessionTab,
} from "../../helpers/ssh";

// Tier: default (no hardware, no Docker). Exercises the Serial editor's
// "Device selection" control end to end: choose "First USB serial device",
// save, reopen (mode persisted), then open the session. The outcome branches
// deterministically on the host's real `serial_scan_ports` result, captured
// through `__TAURI_INTERNALS__` exactly as the frontend does: with no USB
// serial device attached (the CI case) the session must fail with the
// friendly PortNotFound text; with one attached it must either connect and
// show the resolved port in the header, or fail on the OS open (a port held by
// another process), which is reported but never mistaken for "no device".

const CONNECTION_NAME = "Serial Auto USB";
const MODE_SELECT = '[data-testid="serial-device-mode"]';
const FIRST_USB_LABEL = "First USB serial device";
const NO_DEVICE_TEXT = "No serial device is attached";

type ScannedPort = {
  portName: string;
  portType: string;
  displayName: string;
  inUse: boolean;
};

async function scanSerialPorts(): Promise<ScannedPort[]> {
  return browser.execute(async () => {
    type Internals = {
      invoke(command: string, args?: unknown): Promise<unknown>;
    };
    const internals = (window as unknown as { __TAURI_INTERNALS__: Internals })
      .__TAURI_INTERNALS__;
    const result = (await internals.invoke("serial_scan_ports", {
      options: {
        probePorts: false,
        nameFilter: null,
        vidFilter: null,
        pidFilter: null,
        includeVirtual: true,
      },
    })) as { ports?: ScannedPort[] };
    return (result.ports ?? []).map((port) => ({
      portName: port.portName,
      portType: port.portType,
      displayName: port.displayName,
      inUse: port.inUse,
    }));
  });
}

async function openEditorForNewSerialConnection(name: string): Promise<void> {
  await (await $(S.toolbarNewConnection)).click();
  await (await $(S.editorPanel)).waitForDisplayed({ timeout: 10_000 });
  await (await $(S.editorName)).setValue(name);
  await selectCustomOption(S.editorProtocol, ["Serial / RS-232", "Serial"]);
  await (await $(S.editorTabProtocol)).click();
  await (await $(MODE_SELECT)).waitForDisplayed({ timeout: 5_000 });
}

async function reopenConnectionEditor(name: string): Promise<void> {
  await waitForConnectionItem(name);
  const items = await $$(S.connectionItem);
  for (const item of items) {
    if (!(await item.getText()).includes(name)) continue;
    await item.click({ button: "right" });
    const menu = await $('[data-testid="connection-tree-item-menu"]');
    await menu.waitForDisplayed({ timeout: 5_000 });
    const edit = await menu.$("button=Edit");
    await edit.waitForClickable({ timeout: 5_000 });
    await edit.click();
    await (await $(S.editorPanel)).waitForDisplayed({ timeout: 10_000 });
    return;
  }
  throw new Error(`Connection ${name} was not found in the tree`);
}

async function connectionFailedText(): Promise<string | null> {
  const failed = await $(
    '//h3[normalize-space()="Connection Failed"]/parent::div',
  );
  if (!(await failed.isExisting().catch(() => false))) return null;
  return failed.getText();
}

describe("Serial first-USB device selection", () => {
  beforeEach(async () => {
    await resetAppState();
    await createCollection("Serial E2E");
  });

  afterEach(async () => {
    await closeAllSessions().catch(() => undefined);
  });

  it("persists the auto mode through save and reopen and resolves it at connect time", async () => {
    await openEditorForNewSerialConnection(CONNECTION_NAME);

    // The fixed-mode device input is the default and is replaced by the
    // explanatory copy once an auto mode is chosen.
    expect(await (await $("#serial-device")).isExisting()).toBe(true);
    await selectCustomOption(MODE_SELECT, FIRST_USB_LABEL);
    await (
      await $('[data-testid="serial-device-auto-copy"]')
    ).waitForDisplayed({ timeout: 5_000 });
    expect(await (await $("#serial-device")).isExisting()).toBe(false);
    expect(await (await $(MODE_SELECT)).getText()).toContain(FIRST_USB_LABEL);

    await (await $(S.editorSave)).click();
    await waitForConnectionItem(CONNECTION_NAME);

    await reopenConnectionEditor(CONNECTION_NAME);
    await (await $(S.editorTabProtocol)).click();
    const mode = await $(MODE_SELECT);
    await mode.waitForDisplayed({ timeout: 5_000 });
    expect(await mode.getText()).toContain(FIRST_USB_LABEL);
    expect(await (await $("#serial-device")).isExisting()).toBe(false);
    // The hostname mirror carries the auto token, never a device path.
    expect(await $(S.editorHostname)).toHaveValue("auto:first-usb");
    await (await $(S.editorSave)).click();

    const ports = await scanSerialPorts();
    const usbPorts = ports.filter(
      (port) => port.portType === "usbSerial" && !port.inUse,
    );

    await openConnectionItem(CONNECTION_NAME);
    await waitForSessionTab(CONNECTION_NAME, 10_000);

    if (usbPorts.length === 0) {
      await browser.waitUntil(
        async () =>
          ((await connectionFailedText()) ?? "").includes(NO_DEVICE_TEXT),
        {
          timeout: 15_000,
          timeoutMsg: `Expected the session to fail with "${NO_DEVICE_TEXT}" (scan saw ${JSON.stringify(ports)})`,
        },
      );
      const text = (await connectionFailedText()) ?? "";
      expect(text).toContain("SERIAL to auto:first-usb");
      expect(text).toContain('"first USB"');
      return;
    }

    // A USB serial adapter is attached on this host: the resolver must pick
    // it (lowest natural name) and the header must show the concrete port.
    let outcome: "connected" | "open-failed" | null = null;
    await browser.waitUntil(
      async () => {
        const header = await $('[data-testid="serial-client-port"]');
        const status = await $('[data-testid="serial-client"] [role="status"]');
        if (
          (await header.isExisting().catch(() => false)) &&
          (await status.getText().catch(() => "")).toLowerCase() === "connected"
        ) {
          outcome = "connected";
          return true;
        }
        const failed = await connectionFailedText();
        if (failed !== null) {
          outcome = "open-failed";
          return true;
        }
        return false;
      },
      {
        timeout: 20_000,
        timeoutMsg: `Serial session neither connected nor failed (usb=${JSON.stringify(usbPorts)})`,
      },
    );

    if (outcome === "connected") {
      const expected = [...usbPorts]
        .map((port) => port.portName)
        .sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
        )[0];
      expect(
        await (await $('[data-testid="serial-client-port"]')).getText(),
      ).toContain(`Serial · ${expected}`);
      expect(
        await (await $('[data-testid="serial-client-auto-badge"]')).getText(),
      ).toBe("auto · first USB");
      const client = await $('[data-testid="serial-client"]');
      const disconnect = await client.$("button=Disconnect");
      if (await disconnect.isClickable().catch(() => false)) {
        await disconnect.click().catch(() => undefined);
      }
      return;
    }

    // The device exists but the OS refused to open it (typically held by
    // another program). That is a real open failure, not a resolver miss.
    const text = (await connectionFailedText()) ?? "";
    expect(text).not.toContain(NO_DEVICE_TEXT);
    console.warn(
      `[serial-auto-device] USB port present but open failed on this host: ${text}`,
    );
  });
});
