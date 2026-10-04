import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExternalResourceOriginsEditor from "../../src/components/security/ExternalResourceOriginsEditor";
import {
  DEFAULT_EXTERNAL_RESOURCE_ORIGINS,
  type HttpExternalResourceOrigin,
  type HttpProxyPolicy,
} from "../../src/types/connection/httpProxyPolicy";

function setup({
  initial = [],
  sameOriginOnly = false,
  pageScripts = "allow",
  accept = true,
}: {
  initial?: HttpExternalResourceOrigin[];
  sameOriginOnly?: boolean;
  pageScripts?: HttpProxyPolicy["pageScripts"];
  accept?: boolean;
} = {}) {
  const change = vi.fn();
  function Harness() {
    const [origins, setOrigins] = useState(initial);
    return (
      <ExternalResourceOriginsEditor
        origins={origins}
        sameOriginOnly={sameOriginOnly}
        pageScripts={pageScripts}
        onChange={(next) => {
          change(next);
          if (accept) setOrigins(next);
          return accept;
        }}
      />
    );
  }
  return { ...render(<Harness />), change };
}

describe("External resource origins editor", () => {
  it.each([
    ["Scripts", ["script"]],
    ["Stylesheets", ["stylesheet"]],
  ])(
    "requires an explicit resource kind and saves %s alone",
    (label, kinds) => {
      const { change } = setup();
      const input = screen.getByLabelText("External resource origin");
      expect(input).toHaveClass("sor-form-input");
      expect(input).toHaveAccessibleDescription(
        /without cookies or saved login credentials/,
      );
      fireEvent.change(input, {
        target: { value: " HTTPS://CDN.Example.test:443/ " },
      });
      const add = screen.getByRole("button", { name: "Add resource origin" });
      expect(add).toBeDisabled();
      fireEvent.click(screen.getByRole("checkbox", { name: String(label) }));
      fireEvent.click(add);
      expect(change).toHaveBeenCalledExactlyOnceWith([
        { origin: "https://cdn.example.test", kinds },
      ]);
      expect(input).toHaveValue("");
      expect(screen.getByRole("listitem")).toHaveTextContent(String(label));
      fireEvent.click(
        screen.getByRole("button", {
          name: "Remove resource origin https://cdn.example.test",
        }),
      );
      expect(change).toHaveBeenLastCalledWith([]);
    },
  );

  it("rejects unsafe and duplicate origins without discarding the draft or saved list", () => {
    const { change } = setup({
      initial: [{ origin: "https://cdn.example.test", kinds: ["script"] }],
    });
    const input = screen.getByLabelText("External resource origin");
    fireEvent.click(screen.getByRole("checkbox", { name: "Stylesheets" }));
    for (const value of [
      "http://assets.example.test",
      "https://*.example.test",
      "https://assets.example.test/file.css",
      "https://user:synthetic@assets.example.test",
      "https://assets.example.test?token=synthetic",
      "https://assets.example.test#fragment",
      "https://assets.example.test\\path",
      "https://CDN.example.test:443/",
    ]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(
        screen.getByRole("button", { name: "Add resource origin" }),
      );
      expect(input).toHaveValue(value);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "unique exact HTTPS origins",
      );
      expect(change).not.toHaveBeenCalled();
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    }
    fireEvent.change(input, {
      target: { value: "https://other.example.test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add resource origin" }),
    );
    expect(change).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a valid draft when its parent rejects the policy update", () => {
    const { change } = setup({ accept: false });
    const input = screen.getByLabelText("External resource origin");
    fireEvent.change(input, { target: { value: "https://cdn.example.test" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Scripts" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add resource origin" }),
    );
    expect(change).toHaveBeenCalledOnce();
    expect(input).toHaveValue("https://cdn.example.test");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("bounds additions and restores independent copies of the common catalog", () => {
    const { change } = setup({
      initial: Array.from({ length: 16 }, (_, i) => ({
        origin: `https://cdn${i}.example.test`,
        kinds: ["script"],
      })),
    });
    fireEvent.change(screen.getByLabelText("External resource origin"), {
      target: { value: "https://extra.example.test" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Scripts" }));
    const add = screen.getByRole("button", { name: "Add resource origin" });
    expect(add).toBeDisabled();
    expect(screen.getByText(/16-origin limit is reached/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove resource origin https://cdn0.example.test",
      }),
    );
    expect(add).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore common resource defaults" }),
    );
    const restored = change.mock.lastCall?.[0] as HttpExternalResourceOrigin[];
    expect(restored).toEqual(DEFAULT_EXTERNAL_RESOURCE_ORIGINS);
    expect(restored).not.toBe(DEFAULT_EXTERNAL_RESOURCE_ORIGINS);
    expect(restored[0].kinds).not.toBe(
      DEFAULT_EXTERNAL_RESOURCE_ORIGINS[0].kinds,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(
      DEFAULT_EXTERNAL_RESOURCE_ORIGINS.length,
    );
  });

  it("disables all mutations under same-origin policy while keeping every saved grant visible", () => {
    const { change } = setup({
      sameOriginOnly: true,
      initial: [
        { origin: "https://cdn.example.test", kinds: ["script", "stylesheet"] },
      ],
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "preserved but inactive",
    );
    expect(screen.getByLabelText("External resource origin")).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox"))
      expect(checkbox).toBeDisabled();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(
      within(screen.getByRole("list")).getByRole("listitem"),
    ).toHaveTextContent("Scripts · Stylesheets");
    expect(change).not.toHaveBeenCalled();
  });

  it.each(["block", "inline-only"] as const)(
    "explains %s script precedence without rewriting grants",
    (pageScripts) => {
      const initial: HttpExternalResourceOrigin[] = [
        { origin: "https://cdn.example.test", kinds: ["script", "stylesheet"] },
      ];
      const { change } = setup({ initial, pageScripts });
      expect(
        screen.getByText(/External script grants are inactive/),
      ).toHaveTextContent("Stylesheet grants still apply");
      expect(
        screen.getByRole("button", {
          name: "Restore common resource defaults",
        }),
      ).toBeEnabled();
      expect(screen.getByRole("listitem")).toHaveTextContent(
        "Scripts · Stylesheets",
      );
      expect(change).not.toHaveBeenCalled();
    },
  );
});
