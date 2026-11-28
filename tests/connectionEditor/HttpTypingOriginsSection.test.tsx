import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import HttpTypingOriginsSection from "../../src/components/connectionEditor/httpOptions/HttpTypingOriginsSection";
import type { Connection } from "../../src/types/connection/connection";
function Fixture({ initialOrigin }: { initialOrigin?: string }) {
  const [formData, setFormData] = useState<Partial<Connection>>({
    id: "connection",
    name: "Device",
  });
  return (
    <>
      <HttpTypingOriginsSection
        formData={formData}
        setFormData={setFormData}
        initialOrigin={initialOrigin}
      />
      <output data-testid="draft">{JSON.stringify(formData)}</output>
    </>
  );
}
it("prefills the reviewed HTTP origin without granting typing until the user allows it", () => {
  render(<Fixture initialOrigin="http://device.example:8080" />);
  expect(screen.getByLabelText("HTTP origin to allow")).toHaveValue(
    "http://device.example:8080",
  );
  expect(
    JSON.parse(screen.getByTestId("draft").textContent!).httpTypingOrigins,
  ).toBeUndefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Allow typing for this origin" }),
  );
  expect(
    JSON.parse(screen.getByTestId("draft").textContent!).httpTypingOrigins,
  ).toEqual(["http://device.example:8080"]);
});
it("requires an explicit any-page opt-in and lets the user turn it off", () => {
  render(<Fixture />);
  const toggle = screen.getByRole("checkbox", {
    name: "Allow typing on any page",
  });
  expect(toggle).not.toBeChecked();
  expect(screen.getByText(/An untrusted page can steal/)).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(
    JSON.parse(screen.getByTestId("draft").textContent!).httpTypingAnyOrigin,
  ).toBe(true);
  fireEvent.click(toggle);
  expect(
    JSON.parse(screen.getByTestId("draft").textContent!).httpTypingAnyOrigin,
  ).toBe(false);
});
it("allows and removes an exact HTTP origin while preserving its port and connection", () => {
  render(<Fixture />);
  fireEvent.change(screen.getByLabelText("HTTP origin to allow"), {
    target: { value: "http://device.example:8080" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Allow typing for this origin" }),
  );
  expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({
    id: "connection",
    name: "Device",
    httpTypingOrigins: ["http://device.example:8080"],
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Remove typing permission for http://device.example:8080",
    }),
  );
  expect(
    JSON.parse(screen.getByTestId("draft").textContent!).httpTypingOrigins,
  ).toEqual([]);
});
it.each([
  "http://device.example/login",
  "http://user:secret@device.example",
  "http://*.example",
  "https://device.example",
])("does not turn %s into a wider typing grant", (value) => {
  render(<Fixture />);
  fireEvent.change(screen.getByLabelText("HTTP origin to allow"), {
    target: { value },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Allow typing for this origin" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("exact HTTP origin");
  expect(
    JSON.parse(screen.getByTestId("draft").textContent!).httpTypingOrigins,
  ).toBeUndefined();
});
