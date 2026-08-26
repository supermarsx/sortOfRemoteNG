import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import DrayTekActionsTab from "./DrayTekActionsTab";
import {
  buildDraytekAutoLoginUrl,
  buildDraytekWebUiUrl,
} from "../../../hooks/integration/draytek/useDraytek";
import type { DraytekDeviceContext } from "./registry";

const device: DraytekDeviceContext = {
  host: "10.0.0.1",
  port: 8443,
  useTls: true,
  username: "admin",
  password: "pa ss",
  vendor: "draytek",
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ accepted: true });
});

describe("DrayTekActionsTab", () => {
  it("cancelling the confirm never calls draytek_reboot", async () => {
    render(<DrayTekActionsTab connectionId="conn-1" device={device} />);
    fireEvent.click(await screen.findByText("Reboot router"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("confirming calls draytek_reboot with the connection id and reports the result", async () => {
    invokeMock.mockResolvedValue({ accepted: false, message: "busy" });
    render(<DrayTekActionsTab connectionId="conn-1" device={device} />);
    fireEvent.click(await screen.findByText("Reboot router"));
    fireEvent.click(screen.getByText("Yes, reboot"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("draytek_reboot", {
        id: "conn-1",
      }),
    );
    expect(
      await screen.findByText(/did not accept the reboot request\. busy/),
    ).toBeInTheDocument();
  });

  it("Open Web UI uses the non-default port and pre-auth URL when opted in", async () => {
    render(<DrayTekActionsTab connectionId="conn-1" device={device} />);
    fireEvent.click(await screen.findByText("Open Web UI"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("open_url_external", {
        url: "https://10.0.0.1:8443/",
      }),
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Open Web UI"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("open_url_external", {
        url: "https://10.0.0.1:8443/cgi-bin/wlogin.cgi?aa=YWRtaW4%3D&ab=cGEgc3M%3D",
      }),
    );
  });

  it("falls back to window.open when the external opener is unavailable", async () => {
    invokeMock.mockRejectedValue(new Error("no opener"));
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as unknown as Window);
    render(<DrayTekActionsTab connectionId="conn-1" device={device} />);
    fireEvent.click(await screen.findByText("Open Web UI"));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://10.0.0.1:8443/",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    open.mockRestore();
  });
});

describe("DrayTek URL builders", () => {
  it("omits default ports and brackets IPv6 hosts", () => {
    expect(
      buildDraytekWebUiUrl({ host: "r.example", port: 443, useTls: true }),
    ).toBe("https://r.example/");
    expect(
      buildDraytekWebUiUrl({ host: "r.example", port: 80, useTls: false }),
    ).toBe("http://r.example/");
    expect(
      buildDraytekWebUiUrl({ host: "fd00::1", port: 8080, useTls: false }),
    ).toBe("http://[fd00::1]:8080/");
  });

  it("builds the classic wlogin.cgi URL with base64 + url-encoded creds", () => {
    expect(buildDraytekAutoLoginUrl("http://r/", "admin", "admin")).toBe(
      "http://r/cgi-bin/wlogin.cgi?aa=YWRtaW4%3D&ab=YWRtaW4%3D",
    );
  });
});
