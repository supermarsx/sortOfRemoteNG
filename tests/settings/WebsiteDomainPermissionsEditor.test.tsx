import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WebsiteDomainPermissionsEditor, {
  type WebsiteDomainPermissionsEditorProps,
} from "../../src/components/SettingsDialog/sections/webBrowser/WebsiteDomainPermissionsEditor";
import type { WebsiteDomainPermissionsSettings } from "../../src/types/settings/websiteDomainPermissions";
import {
  MAX_WEBSITE_PERMISSION_DESTINATIONS,
  MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS,
  MAX_WEBSITE_PERMISSION_WEBSITES,
  normalizeWebsiteDomainPermissions,
} from "../../src/utils/settings/websiteDomainPermissions";

const WEBSITE = "https://example.com";
const DESTINATION = "https://cdn.example.com";
const saved = (): WebsiteDomainPermissionsSettings => ({
  version: 1,
  websites: [
    {
      origin: WEBSITE,
      requestClasses: { script: "allow" },
      destinations: [
        {
          origin: DESTINATION,
          requestClasses: { script: "deny", font: "allow" },
        },
      ],
    },
  ],
});
function setup(props: Partial<WebsiteDomainPermissionsEditorProps> = {}) {
  const change = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(props.settings);
    return (
      <WebsiteDomainPermissionsEditor
        {...props}
        settings={settings}
        onChange={(next) => {
          change(next);
          setSettings(next);
        }}
      />
    );
  }
  return { ...render(<Harness />), change };
}
function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
function input(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function effective(label: string) {
  return within(screen.getByRole("group", { name: label }));
}

describe("WebsiteDomainPermissionsEditor", () => {
  it("uses shared field labels, themed actions and semantic notices with no raw dropdowns", () => {
    const { container } = setup({ settings: saved() });
    for (const label of [
      "New website origin",
      "New destination origin",
      "Website origin",
      "Rule target",
    ]) {
      const control = screen.getByLabelText(label);
      const field = control.closest(".sor-form-field");
      expect(field).not.toBeNull();
      expect(field?.querySelector("label")).toHaveClass("sor-form-field-label");
      expect(field?.querySelector("label")).toHaveTextContent(label);
    }
    for (const button of screen.getAllByRole("button"))
      expect(button).toHaveClass("sor-btn", "sor-btn-secondary");
    expect(container.querySelector("select")).toBeNull();
    expect(screen.getByRole("note")).toHaveClass(
      "sor-alert-warning",
      "text-[var(--color-text)]",
    );
    input("New website origin", "http://invalid.test");
    fireEvent.click(screen.getByRole("button", { name: "Add website" }));
    expect(screen.getByRole("alert")).toHaveClass(
      "sor-alert-error",
      "text-[var(--color-text)]",
    );
  });
  it("does not save defaults on render, and adds only canonical public rules", () => {
    const { change } = setup();
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent(
      "The legacy rewrite browser does not enforce these rules.",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "Enforcement requires native request-class integration",
    );
    expect(
      screen.getByText(
        "No website rules. Requests inherit application defaults.",
      ),
    ).toBeVisible();
    input("New website origin", "HTTPS://BÜCHER.example:443/");
    fireEvent.click(screen.getByRole("button", { name: "Add website" }));
    expect(change).toHaveBeenLastCalledWith({
      version: 1,
      websites: [
        {
          origin: "https://xn--bcher-kva.example",
          requestClasses: {},
          destinations: [],
        },
      ],
    });
    expect(
      screen.getByRole("combobox", { name: "Website origin" }),
    ).toHaveTextContent("https://xn--bcher-kva.example");
    expect(screen.getAllByRole("group")).toHaveLength(10); // fieldset + nine classes
    expect(
      effective("Scripts").getByText(
        "Effective default: Deny · Application default",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/credentials, login consent and certificate/),
    ).toBeVisible();
  });

  it("edits all nine request classes with themed Inherit, Allow and Deny controls", () => {
    const { change } = setup({ settings: saved() });
    const labels = [
      "Scripts",
      "Stylesheets",
      "Fonts",
      "Images and media",
      "Fetch and XHR",
      "Frames",
      "Workers",
      "WebSockets",
      "Navigation",
    ];
    for (const label of labels) {
      expect(screen.getByRole("combobox", { name: label })).toHaveClass(
        "sor-form-select-sm",
      );
    }
    choose("Scripts", "Deny");
    expect(
      effective("Scripts").getByText(
        "Effective default: Deny · Shared request class",
      ),
    ).toBeVisible();
    choose("Scripts", "Inherit");
    expect(
      effective("Scripts").getByText(
        "Effective default: Deny · Application default",
      ),
    ).toBeVisible();
    choose("Workers", "Allow");
    expect(change.mock.lastCall?.[0].websites[0].requestClasses).toEqual({
      script: "inherit",
      worker: "allow",
    });
    expect(change.mock.lastCall?.[0].websites[0].destinations).toEqual(
      saved().websites[0].destinations,
    );
  });

  it("displays exact destination sources and restores lower-priority rules on removal", () => {
    const { change } = setup({ settings: saved() });
    choose("Rule target", DESTINATION);
    expect(
      effective("Scripts").getByText(
        "Effective: Deny · Shared destination rule",
      ),
    ).toBeVisible();
    choose("Scripts", "Inherit");
    expect(
      effective("Scripts").getByText("Effective: Allow · Shared request class"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove destination" }));
    expect(change.mock.lastCall?.[0].websites[0].destinations).toEqual([]);
    expect(
      effective("Scripts").getByText(
        "Effective default: Allow · Shared request class",
      ),
    ).toBeVisible();
  });

  it("uses shared website/destination rules without copying them into a connection", () => {
    const shared = saved();
    const { change } = setup({ scope: "connection", sharedSettings: shared });
    expect(change).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove website overrides" }),
    ).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Scripts" })).toHaveTextContent(
      "Inherit",
    );
    expect(
      effective("Scripts").getByText(
        "Effective default: Allow · Shared request class",
      ),
    ).toBeVisible();
    choose("Rule target", DESTINATION);
    expect(
      effective("Scripts").getByText(
        "Effective: Deny · Shared destination rule",
      ),
    ).toBeVisible();
    choose("Scripts", "Allow");
    expect(change.mock.lastCall?.[0]).toEqual({
      version: 1,
      websites: [
        {
          origin: WEBSITE,
          requestClasses: {},
          destinations: [
            { origin: DESTINATION, requestClasses: { script: "allow" } },
          ],
        },
      ],
    });
    expect(
      effective("Scripts").getByText(
        "Effective: Allow · Connection destination rule",
      ),
    ).toBeVisible();
    expect(
      effective("Fonts").getByText(
        "Effective: Allow · Shared destination rule",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove destination overrides" }),
    );
    expect(
      effective("Scripts").getByText(
        "Effective: Deny · Shared destination rule",
      ),
    ).toBeVisible();
    expect(shared).toEqual(saved());
  });

  it("shows connection classes ahead of shared destinations and native constraints above both", () => {
    const { change } = setup({
      scope: "connection",
      sharedSettings: saved(),
      nativeDeniedClasses: ["worker"],
    });
    choose("Scripts", "Allow");
    choose("Workers", "Allow");
    expect(
      effective("Workers").getByText(
        "Effective default: Deny · Native restriction",
      ),
    ).toBeVisible();
    choose("Rule target", DESTINATION);
    expect(
      effective("Scripts").getByText(
        "Effective: Allow · Connection request class",
      ),
    ).toBeVisible();
    expect(
      effective("Workers").getByText("Effective: Deny · Native restriction"),
    ).toBeVisible();
    expect(change.mock.lastCall?.[0]).not.toHaveProperty("nativeDeniedClasses");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove website overrides" }),
    );
    expect(change.mock.lastCall?.[0]).toEqual({ version: 1, websites: [] });
    expect(
      effective("Scripts").getByText(
        "Effective: Deny · Shared destination rule",
      ),
    ).toBeVisible();
  });

  it("shows caller-supplied application defaults for inherited classes", () => {
    setup({ settings: saved(), applicationDefaults: { worker: "allow" } });
    expect(
      effective("Workers").getByText(
        "Effective default: Allow · Application default",
      ),
    ).toBeVisible();
  });

  it("adds an exact destination without a grant and preserves defaults", () => {
    const { change } = setup({ settings: saved() });
    input("New destination origin", "https://ASSETS.example:8443/");
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }));
    expect(change.mock.lastCall?.[0].websites[0].destinations[1]).toEqual({
      origin: "https://assets.example:8443",
      requestClasses: {},
    });
    expect(
      effective("Scripts").getByText("Effective: Allow · Shared request class"),
    ).toBeVisible();
    choose("Scripts", "Deny");
    expect(
      effective("Scripts").getByText(
        "Effective: Deny · Shared destination rule",
      ),
    ).toBeVisible();
    expect(change.mock.lastCall?.[0].websites[0].requestClasses.script).toBe(
      "allow",
    );
  });

  it.each(["New website origin", "New destination origin"])(
    "rejects secrets, URL paths and duplicate %s without echoing input",
    (label) => {
      const { change } = setup({ settings: saved() });
      const button = screen.getByRole("button", {
        name:
          label === "New website origin" ? "Add website" : "Add destination",
      });
      for (const value of [
        "https://user:secret@evil.example",
        "https://evil.example/?token=secret",
        "https://evil.example/path",
        "http://evil.example",
        "https://*.example",
        label === "New website origin"
          ? "https://EXAMPLE.com:443/"
          : "https://CDN.example.com/",
      ]) {
        input(label, value);
        fireEvent.click(button);
        expect(change).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent(
          "unique exact HTTPS origins",
        );
        expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
      }
      input(label, "https://valid.example");
      fireEvent.click(button);
      expect(change).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("keeps changes scoped to the selected website and clears the destination view when switching", () => {
    const initial = saved();
    initial.websites.push({
      origin: "https://other.example",
      requestClasses: {},
      destinations: [],
    });
    const { change } = setup({ settings: initial });
    choose("Rule target", DESTINATION);
    choose("Website origin", /^https:\/\/other\.example/);
    expect(
      screen.getByRole("combobox", { name: "Rule target" }),
    ).toHaveTextContent("Request-class defaults");
    choose("Scripts", "Deny");
    expect(change.mock.lastCall?.[0].websites[0]).toEqual(saved().websites[0]);
    expect(change.mock.lastCall?.[0].websites[1].requestClasses).toEqual({
      script: "deny",
    });
  });

  it("disables real controls and ignores user actions when read-only", () => {
    const { change } = setup({ settings: saved(), disabled: true });
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    for (const combo of screen.getAllByRole("combobox"))
      expect(combo).toBeDisabled();
    for (const textbox of screen.getAllByRole("textbox"))
      expect(textbox).toBeDisabled();
    fireEvent.click(screen.getByRole("combobox", { name: "Scripts" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  it.each(["settings", "sharedSettings"] as const)(
    "shows corrupt %s without writing a permissive reset",
    (key) => {
      const { change } = setup({
        scope: "connection",
        [key]: {
          version: 99,
          websites: [],
        } as unknown as WebsiteDomainPermissionsSettings,
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "permissions are invalid",
      );
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(change).not.toHaveBeenCalled();
    },
  );

  it("enforces website and destination row limits in the controls", () => {
    const initial = normalizeWebsiteDomainPermissions(undefined);
    initial.websites = Array.from(
      { length: MAX_WEBSITE_PERMISSION_WEBSITES },
      (_, i) => ({
        origin: `https://site${i}.example`,
        requestClasses: {},
        destinations: [],
      }),
    );
    initial.websites[0].destinations = Array.from(
      { length: MAX_WEBSITE_PERMISSION_DESTINATIONS },
      (_, i) => ({ origin: `https://cdn${i}.example`, requestClasses: {} }),
    );
    const { change } = setup({ settings: initial });
    input("New website origin", "https://extra.example");
    input("New destination origin", "https://extra.example");
    expect(screen.getByRole("button", { name: "Add website" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add destination" }),
    ).toBeDisabled();
    expect(screen.getByText(/64-website limit/)).toBeVisible();
    expect(screen.getByText(/Destination limit reached/)).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove website" }));
    expect(screen.getByRole("button", { name: "Add website" })).toBeEnabled();
  });

  it("enforces the aggregate destination limit across websites", () => {
    const initial = saved();
    const destinations = Array.from(
      { length: MAX_WEBSITE_PERMISSION_DESTINATIONS },
      (_, i) => ({ origin: `https://cdn${i}.example`, requestClasses: {} }),
    );
    initial.websites = Array.from(
      {
        length:
          MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS /
          MAX_WEBSITE_PERMISSION_DESTINATIONS,
      },
      (_, i) => ({
        origin: `https://site${i}.example`,
        requestClasses: {},
        destinations,
      }),
    );
    initial.websites.unshift({
      origin: WEBSITE,
      requestClasses: {},
      destinations: [],
    });
    const { change } = setup({ settings: initial });
    input("New destination origin", "https://extra.example");
    expect(
      screen.getByRole("button", { name: "Add destination" }),
    ).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
  });
});
