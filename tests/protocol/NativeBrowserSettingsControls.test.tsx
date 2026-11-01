import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NativeBrowserSettingsControls, {
  NativeBrowserSettingsSaveAfterCloseError,
  type NativeBrowserSettingsControlsProps,
} from "../../src/components/protocol/webBrowser/NativeBrowserSettingsControls";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

vi.mock("../../src/hooks/protocol/useBrowserRetentionCapabilities", () => ({
  useBrowserRetentionCapabilities: () => ({
    memory: true,
    encryptedDatabase: true,
    policyExpiration: true,
    clearOnDatabaseLock: true,
    httpDiskCache: { available: true },
  }),
}));
vi.mock("../../src/utils/window/reclaimShellFocus", () => ({
  reclaimShellFocus: vi.fn(),
}));
afterEach(cleanup);
const fixture = (): Connection => ({
  id: "website",
  name: "Router",
  hostname: "192.0.2.1",
  port: 443,
  protocol: "https",
  isGroup: false,
  createdAt: "2026-11-01",
  updatedAt: "2026-11-01",
});
function props(
  overrides: Partial<NativeBrowserSettingsControlsProps> = {},
): NativeBrowserSettingsControlsProps {
  return {
    session: { id: "session", connectionId: "website" } as ConnectionSession,
    connection: fixture(),
    config: normalizeWebBrowserSettings(undefined),
    owner: "db:website:1",
    visible: true,
    available: true,
    onSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Browser settings" }));
  return await screen.findByRole("dialog", { name: "Browser settings" });
}
function tab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}
async function choose(label: string, option: string) {
  const trigger = screen.getByRole("combobox", { name: label });
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  const choice = await screen.findByRole("option", { name: option });
  expect(
    screen.getByRole("dialog", { name: "Browser settings" }).contains(choice),
  ).toBe(true);
  fireEvent.mouseDown(choice);
  fireEvent.click(choice);
}
describe("NativeBrowserSettingsControls", () => {
  it("rejects changed saved fields and adopts latest values on deliberate reopening", async () => {
    const p = props();
    const view = render(<NativeBrowserSettingsControls {...p} />);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
      { target: { value: "125" } },
    );
    const changed = {
      ...p,
      connection: {
        ...p.connection,
        browserSession: { version: 1 as const, defaultZoomPercent: 150 },
      },
    };
    view.rerender(<NativeBrowserSettingsControls {...changed} />);
    expect(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
    ).toHaveValue(125);
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "changed while you were editing",
    );
    expect(p.onSave).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Close browser settings" }),
    );
    await open();
    expect(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
    ).toHaveValue(150);
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalled());
  });
  it("refreshes app defaults after close and reopen and supports opening directly at Permissions", async () => {
    const p = props({ initialTab: "Permissions" });
    const view = render(<NativeBrowserSettingsControls {...p} />);
    await open();
    expect(screen.getByRole("tab", { name: "Permissions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const config = { ...p.config, defaultZoomPercent: 125 };
    view.rerender(<NativeBrowserSettingsControls {...p} config={config} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("defaults changed");
    fireEvent.click(
      screen.getByRole("button", { name: "Close browser settings" }),
    );
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    await waitFor(() => expect(p.onSave).toHaveBeenCalled());
  });
  it("removes preference overrides to inherit app defaults and preserves sparse cache fields", async () => {
    const p = props({
      connection: {
        ...fixture(),
        browserSession: {
          version: 1,
          defaultZoomPercent: 125,
          cookiesEnabled: false,
          httpCache: { enabled: false },
        },
      },
    });
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    );
    tab("Privacy");
    await choose("Website cookies", "Use app default (on)");
    tab("Network");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override page cache size" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Page cache limit (MiB)" }),
      { target: { value: "512" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          browserSession: {
            version: 1,
            httpCache: { enabled: false, perConnectionMb: 512 },
          },
        }),
        false,
      ),
    );
  });
  it("keeps drafts across subtabs and saves only sparse preferences with explicit reconnect", async () => {
    const p = props();
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
      { target: { value: "125" } },
    );
    tab("Automation");
    await choose("Require manual form submission", "On for this connection");
    tab("General");
    expect(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
    ).toHaveValue(125);
    expect(p.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith(
        {
          browserSession: {
            version: 1,
            defaultZoomPercent: 125,
            manualFormSubmit: true,
          },
          httpProxyPolicy: undefined,
          websiteDomainPermissions: undefined,
        },
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("preserves existing request extras and permissions when selecting a supported browsing mode", async () => {
    const permissions = { version: 1 as const, websites: [] };
    const config = normalizeWebBrowserSettings(undefined);
    const p = props({
      config,
      connection: {
        ...fixture(),
        httpProxyPolicy: {
          ...config.defaultPolicy,
          queryParameters: [{ name: "token", value: "secret-never-visible" }],
        },
        websiteDomainPermissions: permissions,
      },
    });
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    tab("Network");
    expect(screen.queryByText(/secret-never-visible/)).toBeNull();
    await choose("Browsing mode", "Strict browsing");
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          httpProxyPolicy: expect.objectContaining({
            nativeBrowsingMode: "strict",
            sameOriginOnly: true,
            pageScripts: "allow",
            queryParameters: [{ name: "token", value: "secret-never-visible" }],
          }),
          websiteDomainPermissions: permissions,
        }),
        false,
      ),
    );
  });
  it("rejects inherited combined timing conflicts without calling persistence", async () => {
    const config = normalizeWebBrowserSettings(undefined);
    config.minimumFormFillDelayMs = 30000;
    const p = props({ config });
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    tab("Automation");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Override delay before submitting forms (ms)",
      }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Delay before submitting forms (ms)",
      }),
      { target: { value: "30000" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(screen.getByRole("alert")).toHaveTextContent("52,000");
    expect(p.onSave).not.toHaveBeenCalled();
  });
  it("rejects empty and out-of-range numeric drafts rather than saving the previous value", async () => {
    const p = props();
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    );
    const input = screen.getByRole("spinbutton", { name: "Default zoom (%)" });
    for (const value of ["", "201", "12.5"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(
        screen.getByRole("button", { name: "Save and reconnect" }),
      );
      expect(p.onSave).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeVisible();
    }
  });
  it("retains a same-owner draft while unavailable and hides on active-tab loss without resurrecting", async () => {
    const p = props();
    const view = render(<NativeBrowserSettingsControls {...p} />);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
      { target: { value: "140" } },
    );
    view.rerender(<NativeBrowserSettingsControls {...p} available={false} />);
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save and reconnect" }),
    ).toBeDisabled();
    view.rerender(<NativeBrowserSettingsControls {...p} />);
    expect(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
    ).toHaveValue(140);
    view.rerender(<NativeBrowserSettingsControls {...p} visible={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<NativeBrowserSettingsControls {...p} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await open();
    expect(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
    ).toHaveValue(p.config.defaultZoomPercent);
  });
  it("closes a controlled popup on owner change and resets the draft", async () => {
    function Host({ owner }: { owner: string }) {
      const [isOpen, setOpen] = React.useState(false);
      return (
        <NativeBrowserSettingsControls
          {...props()}
          owner={owner}
          open={isOpen}
          onOpenChange={setOpen}
        />
      );
    }
    const view = render(<Host owner="a" />);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    );
    view.rerender(<Host owner="b" />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await open();
    expect(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    ).not.toBeChecked();
  });
  it("blocks duplicate saves and every close path while pending, then keeps draft after a close-stage failure", async () => {
    let reject!: (value: Error) => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
    );
    const p = props({ onSave });
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Override default zoom (%)" }),
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
      { target: { value: "130" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    expect(
      screen.getByRole("button", { name: "Close browser settings" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Browser settings" }),
    ).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () =>
      reject(new NativeBrowserSettingsSaveAfterCloseError()),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("browser was closed");
    expect(
      screen.getByRole("spinbutton", { name: "Default zoom (%)" }),
    ).toHaveValue(130);
  });
  it("uses keyboard tabs and nested Select Escape, then closes outer popup with Escape", async () => {
    render(<NativeBrowserSettingsControls {...props()} />);
    await open();
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), {
      key: "End",
    });
    expect(screen.getByRole("tab", { name: "Permissions" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Permissions" }), {
      key: "Home",
    });
    const trigger = screen.getByRole("combobox", { name: "Bookmarks bar" });
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    await screen.findByRole("listbox");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("keeps outside focus when a nonmodal popup is dismissed", async () => {
    render(
      <>
        <NativeBrowserSettingsControls {...props()} />
        <button>Outside control</button>
      </>,
    );
    await open();
    const outside = screen.getByRole("button", { name: "Outside control" });
    act(() => {
      screen.getByRole("tab", { name: "General" }).focus();
      outside.focus();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(outside).toHaveFocus();
  });
  it("edits native-supported cookie retention and keeps unexposed fields intact", async () => {
    const p = props({
      connection: {
        ...fixture(),
        browserSession: {
          version: 1,
          httpCache: { perConnectionMb: 256 },
          webglEnabled: true,
        },
      },
    });
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    tab("Privacy");
    await choose("Cookie retention", "Save in encrypted database");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Maximum cookie age (hours)" }),
      { target: { value: "24" } },
    );
    await choose("Clear saved cookies on database lock", "Clear on lock");
    fireEvent.click(
      screen.getByRole("button", { name: "Save for next connection" }),
    );
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          browserSession: expect.objectContaining({
            httpCache: { perConnectionMb: 256 },
            webglEnabled: true,
            sessionRetention: expect.objectContaining({
              mode: "encrypted-database",
              maxAgeHours: 24,
              clearOnDatabaseLock: true,
            }),
          }),
        }),
        false,
      ),
    );
  });
  it("retains the destination permission editor and its nested menus", async () => {
    const p = props();
    render(<NativeBrowserSettingsControls {...p} />);
    await open();
    tab("Permissions");
    fireEvent.change(
      screen.getByRole("textbox", { name: "New website origin" }),
      { target: { value: "https://example.test" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add website" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "New destination origin" }),
      { target: { value: "https://cdn.example.test" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }));
    await choose("Scripts", "Deny");
    fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          websiteDomainPermissions: {
            version: 1,
            websites: [
              {
                origin: "https://example.test",
                requestClasses: {},
                destinations: [
                  {
                    origin: "https://cdn.example.test",
                    requestClasses: { script: "deny" },
                  },
                ],
              },
            ],
          },
        }),
        true,
      ),
    );
  });
});
