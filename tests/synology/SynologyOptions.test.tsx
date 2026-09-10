import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import HTTPOptions from "../../src/components/connectionEditor/HTTPOptions";

afterEach(cleanup);
function Editor({ seed = {} }: { seed?: Partial<Connection> }) {
  const [data, setData] = useState<Partial<Connection>>({
    protocol: "https",
    hostname: "nas.example.test",
    port: 5001,
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
    ...seed,
  });
  return (
    <>
      <HTTPOptions
        formData={data}
        setFormData={setData}
        sections={["application"]}
      />
      <output data-testid="saved-shape">{JSON.stringify(data)}</output>
    </>
  );
}
function selectMode(name: string) {
  fireEvent.click(
    screen.getByRole("combobox", { name: "Synology access mode" }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name }));
}
const savedShape = () =>
  JSON.parse(screen.getByTestId("saved-shape").textContent!);
describe("Synology HTTP application views", () => {
  it("starts as a website and switches to an API explorer without inventing a protocol", () => {
    render(<Editor />);
    expect(
      screen.getByRole("combobox", { name: "Synology access mode" }),
    ).toHaveTextContent("Website");
    expect(screen.queryByLabelText("DSM API password")).not.toBeInTheDocument();
    selectMode("Synology NAS API");
    expect(
      screen.getByRole("combobox", { name: "Synology access mode" }),
    ).toHaveTextContent("Synology NAS API");
    expect(
      screen.getByText(
        /provides File Station and supported NAS administration/,
      ),
    ).toBeInTheDocument();
    expect(savedShape()).toMatchObject({
      protocol: "https",
      hostname: "nas.example.test",
      port: 5001,
      synologySettings: { accessMode: "native" },
      httpAutoLogin: false,
    });
    fireEvent.change(screen.getByLabelText("DSM API username"), {
      target: { value: "dsm-user" },
    });
    fireEvent.change(screen.getByLabelText("DSM API password"), {
      target: { value: "synthetic-secret" },
    });
    expect(savedShape()).toMatchObject({
      basicAuthUsername: "dsm-user",
      basicAuthPassword: "synthetic-secret",
    });
    selectMode("Website — DSM in browser");
    expect(savedShape()).toMatchObject({
      protocol: "https",
      port: 5001,
      synologySettings: { accessMode: "website" },
      httpApplication: { loginMode: "manual" },
      basicAuthPassword: "synthetic-secret",
    });
    expect(screen.queryByLabelText("DSM API password")).not.toBeInTheDocument();
  });
  it("follows the selected HTTP transport, retaining a custom NAS port", () => {
    render(
      <Editor
        seed={{
          protocol: "http",
          port: 5443,
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "native",
          },
        }}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Synology transport" }),
    ).toHaveTextContent("HTTP — unencrypted");
    fireEvent.click(
      screen.getByRole("combobox", { name: "Synology transport" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "HTTPS — verified system certificates",
      }),
    );
    expect(savedShape()).toMatchObject({
      protocol: "https",
      port: 5443,
      synologySettings: { useHttps: true, accessMode: "native" },
    });
  });
});
