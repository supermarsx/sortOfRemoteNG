import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";
import DroneScmBridgeFields from "../../src/components/connectionEditor/httpOptions/DroneScmBridgeFields";

const VAULT = {
  kind: "vault" as const,
  credentialId: "6a1f7f3e-2a0a-4c37-9d5f-1a2b3c4d5e6f",
};

const saved = (overrides: Partial<Connection>): Connection =>
  ({
    id: "other",
    name: "Other",
    protocol: "https",
    hostname: "git.example.test",
    port: 443,
    ...overrides,
  }) as Connection;

let latest: Partial<Connection> = {};
// The Drone fields, read without depending on where their type is declared.
const app = () => latest.httpApplication as Record<string, unknown> | undefined;
function Harness({
  initial,
  connections = [],
}: {
  initial?: Partial<Connection>;
  connections?: Connection[];
}) {
  const [formData, setFormData] = useState<Partial<Connection>>(
    initial ?? {
      id: "drone",
      protocol: "https",
      hostname: "ci.example.test",
      port: 443,
      httpApplication: { version: 1, id: "drone-ci", loginMode: "form" },
    },
  );
  latest = formData;
  return (
    <DroneScmBridgeFields
      formData={formData}
      setFormData={setFormData}
      connections={connections}
    />
  );
}

afterEach(cleanup);

describe("Drone CI Git provider fields", () => {
  it("saves the chosen provider and a canonical SCM origin, and says where the sign-in is typed", () => {
    render(<Harness />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Choose the Git provider Drone signs in through.",
    );
    fireEvent.change(screen.getByLabelText("Git provider"), {
      target: { value: "gitea" },
    });
    expect(app()?.droneScmProvider).toBe("gitea");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Enter the Git provider's address.",
    );
    const origin = screen.getByLabelText("Git provider address");
    fireEvent.change(origin, {
      target: { value: "HTTPS://Git.Example.Test/" },
    });
    fireEvent.blur(origin);
    expect(app()?.droneScmOrigin).toBe("https://git.example.test");
    expect(screen.getByRole("status")).toHaveTextContent(
      "The saved username and password are typed only on https://git.example.test, never on Drone or another redirect target.",
    );
    fireEvent.change(screen.getByLabelText(/OAuth client ID/), {
      target: { value: "3f0c2a8e-1b7d-4c55-9a0e-6d2b1f8e7c41" },
    });
    expect(app()?.droneScmClientId).toBe(
      "3f0c2a8e-1b7d-4c55-9a0e-6d2b1f8e7c41",
    );
  });

  it("flags a plaintext, path-bearing or Drone-own address and saves nothing usable from it", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Git provider"), {
      target: { value: "gitea" },
    });
    const origin = screen.getByLabelText("Git provider address");
    fireEvent.change(origin, { target: { value: "http://git.example.test" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "The Git provider must use HTTPS",
    );
    fireEvent.change(origin, {
      target: { value: "https://git.example.test/gitea" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter only the origin",
    );
    fireEvent.change(origin, { target: { value: "https://ci.example.test" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "The Git provider cannot be Drone itself.",
    );
  });

  it("Gogs needs no address: Drone shows its own form", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Git provider"), {
      target: { value: "gogs" },
    });
    expect(screen.queryByLabelText("Git provider address")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "The saved username and password are typed only into Drone's own sign-in form at https://ci.example.test.",
    );
  });

  it("Bitbucket and gitlab.com are bridged without typing anything", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Git provider"), {
      target: { value: "bitbucket" },
    });
    expect(screen.queryByLabelText("Git provider address")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "has no reviewed sign-in page here",
    );
  });

  it("fills the provider from a saved Gitea connection and shares its vault entry without copying secrets", () => {
    render(
      <Harness
        connections={[
          saved({
            id: "gitea-1",
            name: "Team Gitea",
            httpApplication: { version: 1, id: "gitea", loginMode: "form" },
            credentialSource: VAULT,
            password: "must-not-travel",
          }),
          saved({
            id: "portainer-1",
            name: "Portainer",
            httpApplication: { version: 1, id: "portainer", loginMode: "form" },
          }),
          saved({ id: "drone", name: "This Drone" }),
        ]}
      />,
    );
    const picker = screen.getByLabelText("Use a saved Git connection");
    expect(
      Array.from((picker as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual(["Choose a connection…", "Team Gitea (Gitea)"]);
    fireEvent.change(picker, { target: { value: "gitea-1" } });
    expect(latest.httpApplication).toMatchObject({
      id: "drone-ci",
      droneScmProvider: "gitea",
      droneScmOrigin: "https://git.example.test",
    });
    expect(latest.credentialSource).toEqual(VAULT);
    expect(JSON.stringify(latest)).not.toContain("must-not-travel");
    expect(
      screen.getByText(/same database vault entry as Team Gitea/),
    ).toBeTruthy();
  });

  it("links only the address when the Gitea connection keeps its own password", () => {
    render(
      <Harness
        connections={[
          saved({
            id: "gitea-2",
            name: "Home Gitea",
            httpApplication: { version: 1, id: "gitea", loginMode: "form" },
            password: "must-not-travel",
          }),
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Use a saved Git connection"), {
      target: { value: "gitea-2" },
    });
    expect(app()?.droneScmOrigin).toBe("https://git.example.test");
    expect(latest.credentialSource).toBeUndefined();
    expect(JSON.stringify(latest)).not.toContain("must-not-travel");
    expect(
      screen.getByText(/keeps its password in its own fields/),
    ).toBeTruthy();
  });

  it("renders nothing for another application", () => {
    const { container } = render(
      <Harness
        initial={{
          protocol: "https",
          hostname: "x.example.test",
          httpApplication: { version: 1, id: "gitea", loginMode: "form" },
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
