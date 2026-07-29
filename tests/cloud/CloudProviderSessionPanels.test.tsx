import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HerokuSessionPanel } from "../../src/components/cloud/HerokuSessionPanel";
import { IbmCloudSessionPanel } from "../../src/components/cloud/IbmCloudSessionPanel";
import { LinodeSessionPanel } from "../../src/components/cloud/LinodeSessionPanel";
import { OvhCloudSessionPanel } from "../../src/components/cloud/OvhCloudSessionPanel";
import { ScalewaySessionPanel } from "../../src/components/cloud/ScalewaySessionPanel";
import type { ConnectionSession } from "../../src/types/connection/connection";

vi.mock("../../src/components/cloud/CloudSessionPanel", () => ({
  CloudSessionPanel: ({
    adapter,
  }: {
    adapter: { protocol: string; displayName: string };
  }) => (
    <div data-testid="cloud-panel-adapter">
      {adapter.protocol}:{adapter.displayName}
    </div>
  ),
}));

const cases = [
  ["ibm-csp", "IBM Cloud", IbmCloudSessionPanel],
  ["heroku", "Heroku", HerokuSessionPanel],
  ["scaleway", "Scaleway", ScalewaySessionPanel],
  ["linode", "Linode", LinodeSessionPanel],
  ["ovhcloud", "OVHcloud", OvhCloudSessionPanel],
] as const;

describe("Wave 6 cloud provider panels", () => {
  it.each(cases)(
    "delegates %s hydration and lifecycle state to the shared cloud panel",
    (protocol, displayName, ProviderPanel) => {
      const session = {
        id: `${protocol}-session`,
        connectionId: `${protocol}-saved`,
        name: displayName,
        protocol,
        status: "disconnected",
      } as ConnectionSession;

      render(<ProviderPanel session={session} onClose={vi.fn()} />);

      expect(screen.getByTestId("cloud-panel-adapter")).toHaveTextContent(
        `${protocol}:${displayName}`,
      );
    },
  );
});
