import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import RloginOptions from "../../src/components/connectionEditor/RloginOptions";
import { RLOGIN_CONNECTION_EDITOR_SEARCH_DESCRIPTORS } from "../../src/components/connectionEditor/rloginOptions/searchMetadata";
import type { ConnectionEditorSearchDescriptor } from "../../src/components/connection/editor/editorRegistry";
import type {
  RloginNetworkPathCapability,
  RloginSettings,
} from "../../src/types/connection/rloginSettings";
import {
  acknowledgeRloginPlaintext,
  createDefaultRloginSettings,
} from "../../src/utils/rlogin/rloginSettings";

const directPath: RloginNetworkPathCapability = {
  configured: false,
  supported: true,
  summary: "Direct TCP connection to the target",
  layers: [],
};

const searchFields = () =>
  (
    RLOGIN_CONNECTION_EDITOR_SEARCH_DESCRIPTORS as readonly ConnectionEditorSearchDescriptor[]
  ).flatMap((descriptor) => descriptor.fields);

const validSettings = (patch: Partial<RloginSettings> = {}) =>
  acknowledgeRloginPlaintext(
    {
      ...createDefaultRloginSettings(),
      localUsername: "alice",
      remoteUsername: "root",
      ...patch,
    },
    new Date("2026-07-15T12:00:00.000Z"),
  );

function StatefulRloginOptions({
  initialSettings = createDefaultRloginSettings(),
  initialPort = 513,
  networkPath = directPath,
  section = "all" as const,
}: {
  initialSettings?: RloginSettings;
  initialPort?: number;
  networkPath?: RloginNetworkPathCapability;
  section?: ComponentProps<typeof RloginOptions>["section"];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [port, setPort] = useState(initialPort);
  return (
    <RloginOptions
      settings={settings}
      port={port}
      onSettingsChange={setSettings}
      onPortChange={setPort}
      networkPath={networkPath}
      section={section}
      now={() => new Date("2026-07-15T13:00:00.000Z")}
    />
  );
}

describe("RloginOptions", () => {
  it("composes rapid identity and terminal edits before the parent rerenders", () => {
    const onSettingsChange = vi.fn();
    render(
      <RloginOptions
        settings={createDefaultRloginSettings()}
        port={513}
        onSettingsChange={onSettingsChange}
        onPortChange={vi.fn()}
        networkPath={directPath}
      />,
    );

    const changeRapidly = (label: string, values: readonly string[]) => {
      const input = screen.getByLabelText(label);
      values.forEach((value) => fireEvent.change(input, { target: { value } }));
    };

    changeRapidly("Local username", ["a", "al", "ali", "alic", "alice"]);
    changeRapidly("Remote username", ["r", "ro", "roo", "root"]);
    changeRapidly("Terminal type", ["x", "xt", "xte", "xter", "xterm"]);
    changeRapidly("Terminal speed", ["9", "96", "960", "9600"]);

    expect(onSettingsChange.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        localUsername: "alice",
        remoteUsername: "root",
        terminalType: "xterm",
        terminalSpeed: 9600,
      }),
    );
  });

  it("renders five semantic sections with the required safety copy", () => {
    const { container } = render(<StatefulRloginOptions />);
    for (const heading of [
      "Connection",
      "Terminal",
      "Network Path",
      "Security",
      "Advanced",
    ]) {
      expect(
        screen.getByRole("heading", { name: heading }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(/port 513 by default/i)).toBeInTheDocument();
    expect(
      screen.getByText(/usernames and terminal traffic are sent in plaintext/i),
    ).toBeInTheDocument();
    expect(screen.getByText("No password automation")).toBeInTheDocument();
    expect(
      screen.getByText(/reserved client ports cannot be guaranteed/i),
    ).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it("gives every global-search focus target a real accessible element", () => {
    const { container } = render(<StatefulRloginOptions />);
    const fields = searchFields();
    for (const field of fields) {
      const focusId = field.focusId ?? field.id;
      const target = document.getElementById(focusId);
      expect(target, focusId).not.toBeNull();
    }

    const sections = container.querySelectorAll('section[id^="rlogin-"]');
    expect(sections).toHaveLength(5);
    sections.forEach((section) => {
      const headingId = section.getAttribute("aria-labelledby");
      const descriptionId = section.getAttribute("aria-describedby");
      expect(headingId && document.getElementById(headingId)).toBeTruthy();
      expect(
        descriptionId && document.getElementById(descriptionId),
      ).toBeTruthy();
    });
  });

  it("exports exact protocol subtab routing and safe searchable values", () => {
    const entries = searchFields();
    expect(entries.every((entry) => entry.protocols?.includes("rlogin"))).toBe(
      true,
    );
    expect(entries.map((entry) => entry.protocolSubtabId)).toEqual(
      expect.arrayContaining([
        "connection",
        "terminal",
        "network-path",
        "security",
        "advanced",
      ]),
    );
    expect(JSON.stringify(entries)).not.toMatch(/password(?:value|path)/i);
  });

  it("updates identity fields and keeps inactive values intact", () => {
    render(
      <StatefulRloginOptions
        initialSettings={{
          ...createDefaultRloginSettings(),
          escapeCharacter: "^]",
          tcpKeepAliveSeconds: 17,
          reservedPortStart: 600,
          reservedPortEnd: 700,
        }}
      />,
    );
    const localUsername = screen.getByLabelText("Local username");
    fireEvent.change(localUsername, { target: { value: "client-user" } });
    expect(localUsername).toHaveValue("client-user");

    const escapeToggle = screen.getByLabelText(
      /enable line-start escape commands/i,
    );
    fireEvent.click(escapeToggle);
    const escapeCharacter = screen.getByLabelText("Escape character");
    expect(escapeCharacter).toBeDisabled();
    expect(escapeCharacter).toHaveValue("^]");

    const keepaliveToggle = screen.getByLabelText(
      /operating-system TCP keepalive/i,
    );
    fireEvent.click(keepaliveToggle);
    const keepaliveInterval = screen.getByLabelText(
      "TCP keepalive interval in seconds",
    );
    expect(keepaliveInterval).toBeDisabled();
    expect(keepaliveInterval).toHaveValue(17);

    const reservedStart = screen.getByLabelText("Reserved range start");
    expect(reservedStart).toBeDisabled();
    expect(reservedStart).toHaveValue(600);
    fireEvent.click(
      screen.getByRole("combobox", { name: "Client source port" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Reserved 512–1023" }),
    );
    expect(reservedStart).toBeEnabled();
    expect(reservedStart).toHaveValue(600);
  });

  it("records and resets a scoped plaintext acknowledgement", () => {
    render(<StatefulRloginOptions section="security" />);
    const acknowledgement = screen.getByLabelText(
      /I understand and accept the plaintext risk/i,
    );
    expect(acknowledgement).not.toBeChecked();
    expect(acknowledgement).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(acknowledgement);
    expect(acknowledgement).toBeChecked();
    expect(screen.getByText(/2026-07-15T13:00:00.000Z/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Reset acknowledgement" }),
    );
    expect(acknowledgement).not.toBeChecked();
  });

  it("fails closed and explains reserved-port Network Path incompatibility", () => {
    render(
      <StatefulRloginOptions
        section="network-path"
        initialSettings={validSettings({ sourcePortMode: "reserved" })}
        networkPath={{
          configured: true,
          supported: false,
          summary: "Dynamic proxy command is unsupported",
          layers: [{ kind: "unsupported", label: "Dynamic proxy command" }],
        }}
      />,
    );
    expect(screen.getByText("Connection blocked")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot provide an RLogin TCP stream/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/use a direct path or ephemeral mode/i),
    ).toBeInTheDocument();
  });

  it("links invalid port errors to the numeric control", () => {
    render(
      <RloginOptions
        settings={validSettings()}
        port={0}
        onSettingsChange={vi.fn()}
        onPortChange={vi.fn()}
        networkPath={directPath}
        section="connection"
      />,
    );
    const port = screen.getByLabelText("Target port");
    expect(port).toHaveAttribute("aria-invalid", "true");
    expect(port).toHaveAttribute("aria-describedby", "rlogin-port-error");
    expect(document.getElementById("rlogin-port-error")).toHaveTextContent(
      /between 1 and 65535/i,
    );
  });

  it("renders an individual section without hidden accordion state", () => {
    render(<StatefulRloginOptions section="terminal" />);
    expect(
      screen.getByRole("heading", { name: "Terminal" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Connection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /expand|collapse/i }),
    ).toBeNull();
  });
});
