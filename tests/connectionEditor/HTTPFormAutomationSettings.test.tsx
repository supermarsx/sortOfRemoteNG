import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import { normalizeHttpFormAutomation } from "../../src/utils/connection/httpFormAutomation";

function Fixture({ initial = {} }: { initial?: Partial<Connection> }) {
  const [formData, setFormData] = React.useState<Partial<Connection>>({
    protocol: "https",
    httpAutoLogin: false,
    ...initial,
  });
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["advanced", "authentication", "application"]}
      />
      <output data-testid="draft">{JSON.stringify(formData)}</output>
    </>
  );
}
const draft = () =>
  JSON.parse(screen.getByTestId("draft").textContent!) as Partial<Connection>;
function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

describe("advanced form settings controls", () => {
  it("shows defaults without persisting settings or enabling login", () => {
    render(<Fixture />);
    expect(screen.getByLabelText("Delay before filling (ms)")).toHaveValue(0);
    expect(draft().httpFormAutomation).toBeUndefined();
    expect(draft().httpAutoLogin).toBe(false);
  });
  it("supports partial selector typing, secret-masked explicit values, and defaults added fields to fill-only", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Add explicit field" }));
    expect(draft().httpFormAutomation?.submit).toBe(false);
    const selector = screen.getByLabelText("Field 1 selector");
    fireEvent.change(selector, { target: { value: "[" } });
    expect(selector).toHaveValue("[");
    expect(() =>
      normalizeHttpFormAutomation(draft().httpFormAutomation),
    ).toThrow();
    fireEvent.change(selector, { target: { value: 'input[name="tenant"]' } });
    const value = screen.getByLabelText("Field 1 value");
    expect(value).toHaveAttribute("type", "password");
    fireEvent.change(value, { target: { value: "fixture-value" } });
    expect(
      normalizeHttpFormAutomation(draft().httpFormAutomation)?.fields,
    ).toEqual([{ selector: 'input[name="tenant"]', value: "fixture-value" }]);
    expect(draft().httpAutoLogin).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove additional field 1" }),
    );
    expect(draft().httpFormAutomation?.fields).toEqual([]);
  });
  it("keeps a sufficient overall deadline for both configured delays", () => {
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText("Delay before filling (ms)"), {
      target: { value: "30000" },
    });
    fireEvent.change(screen.getByLabelText("Delay after filling (ms)"), {
      target: { value: "30000" },
    });
    expect(draft().httpFormAutomation).toMatchObject({
      fillDelayMs: 30000,
      submitDelayMs: 30000,
      detectionTimeoutMs: 60000,
    });
    fireEvent.change(screen.getByLabelText("Overall deadline (ms)"), {
      target: { value: "1000" },
    });
    expect(
      screen.getByText(/These draft settings are not valid yet/),
    ).toBeInTheDocument();
    expect(() =>
      normalizeHttpFormAutomation(draft().httpFormAutomation),
    ).toThrow();
  });
  it("repairs malformed imported settings only after explicit clear and disables login", () => {
    render(
      <Fixture
        initial={{
          httpAutoLogin: true,
          httpApplication: {
            version: 1,
            id: "generic-form",
            loginMode: "form",
          },
          httpFormAutomation: {
            version: 99,
          } as unknown as Connection["httpFormAutomation"],
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear advanced form settings and disable automatic login",
      }),
    );
    expect(draft().httpFormAutomation).toBeUndefined();
    expect(draft().httpAutoLogin).toBe(false);
    expect(draft().httpApplication?.loginMode).toBe("manual");
  });
  it("offers dedicated generic form, Basic and Digest profiles without implicit login", () => {
    render(<Fixture />);
    for (const [label, id] of [
      ["Generic login form", "generic-form"],
      ["HTTP Basic authentication", "http-basic"],
      ["HTTP Digest authentication", "http-digest"],
    ]) {
      choose("Website application", label);
      expect(draft().httpApplication).toMatchObject({
        id,
        loginMode: "manual",
      });
      expect(draft().httpAutoLogin).toBe(false);
    }
    choose("Application login mode", "HTTP Digest authentication");
    expect(draft().httpApplication?.loginMode).toBe("digest");
  });
});
