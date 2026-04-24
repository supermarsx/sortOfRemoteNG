import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdvancedSection from "../../src/components/connectionEditor/rdpOptions/AdvancedSection";
import AudioSection from "../../src/components/connectionEditor/rdpOptions/AudioSection";
import DeviceRedirectionSection from "../../src/components/connectionEditor/rdpOptions/DeviceRedirectionSection";
import GatewaySection from "../../src/components/connectionEditor/rdpOptions/GatewaySection";
import HyperVSection from "../../src/components/connectionEditor/rdpOptions/HyperVSection";
import InputSection from "../../src/components/connectionEditor/rdpOptions/InputSection";
import NegotiationSection from "../../src/components/connectionEditor/rdpOptions/NegotiationSection";
import PerformanceSection from "../../src/components/connectionEditor/rdpOptions/PerformanceSection";
import SecuritySection from "../../src/components/connectionEditor/rdpOptions/SecuritySection";
import TcpSection from "../../src/components/connectionEditor/rdpOptions/TcpSection";
import { DEFAULT_RDP_SETTINGS, type Connection, type RDPConnectionSettings } from "../../src/types/connection/connection";
import type { RDPOptionsMgr } from "../../src/hooks/rdp/useRDPOptions";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: vi.fn(() => ({})),
    }),
  },
}));

const createRdp = (): RDPConnectionSettings =>
  JSON.parse(JSON.stringify(DEFAULT_RDP_SETTINGS)) as RDPConnectionSettings;

const createMgr = (): RDPOptionsMgr =>
  ({
    hostRecords: [],
    editingNickname: null,
    setEditingNickname: vi.fn(),
    nicknameInput: "",
    setNicknameInput: vi.fn(),
    handleRemoveTrust: vi.fn(),
    handleClearAllRdpTrust: vi.fn(),
    handleSaveNickname: vi.fn(),
    formatFingerprint: (fingerprint: string) => fingerprint,
  }) as unknown as RDPOptionsMgr;

describe("RDP connection editor sections", () => {
  it("renders Security controls with centralized form classes and updates CredSSP", () => {
    const updateRdp = vi.fn();
    const setFormData = vi.fn();
    const rdp = createRdp();
    const formData: Partial<Connection> = {
      protocol: "rdp",
      hostname: "rdp-host",
      port: 3389,
    };

    const { container } = render(
      <SecuritySection
        rdp={rdp}
        updateRdp={updateRdp}
        formData={formData}
        setFormData={setFormData}
        mgr={createMgr()}
      />,
    );

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const combobox = container.querySelector('[role="combobox"]') as HTMLButtonElement;
    const textInput = screen.getByPlaceholderText(/!kerberos,!pku2u/i);

    expect(checkbox.className).toContain("sor-form-checkbox");
    expect(combobox.className).toContain("sor-form-select");
    expect(textInput.className).toContain("sor-form-input");

    fireEvent.click(checkbox);
    expect(updateRdp).toHaveBeenCalledWith("security", { useCredSsp: false });
  });

  it("renders Gateway controls with centralized form classes and separate credential fields", () => {
    const updateRdp = vi.fn();
    const rdp = createRdp();
    rdp.gateway = {
      ...rdp.gateway,
      enabled: true,
      credentialSource: "separate",
    };

    const { container } = render(
      <GatewaySection rdp={rdp} updateRdp={updateRdp} />,
    );

    const combobox = container.querySelector('[role="combobox"]') as HTMLButtonElement;
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    const usernameInput = screen.getByPlaceholderText(/DOMAIN\\user/i);

    expect(combobox.className).toContain("sor-form-select");
    expect(numberInput.className).toContain("sor-form-input");
    expect(usernameInput.className).toContain("sor-form-input");
  });

  it("renders TCP and Advanced overrides with centralized checkbox styling", () => {
    const updateTcp = vi.fn();
    const tcp = createRdp();
    const tcpRender = render(<TcpSection rdp={tcp} updateRdp={updateTcp} />);

    const tcpCheckbox = tcpRender.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(tcpCheckbox.className).toContain("sor-form-checkbox");
    fireEvent.click(tcpCheckbox);
    expect(updateTcp).toHaveBeenCalledWith("tcp", { connectTimeoutSecs: undefined });

    tcpRender.unmount();

    const updateAdvanced = vi.fn();
    const advanced = createRdp();
    const advancedRender = render(
      <AdvancedSection rdp={advanced} updateRdp={updateAdvanced} />,
    );

    const advancedCheckbox = advancedRender.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const advancedInput = advancedRender.container.querySelector('select, input[type="text"]') as HTMLSelectElement | HTMLInputElement;

    expect(advancedCheckbox.className).toContain("sor-form-checkbox");
    expect(advancedInput.className).toContain("sor-form-input");
    fireEvent.click(advancedCheckbox);
    expect(updateAdvanced).toHaveBeenCalledWith("advanced", { readTimeoutMs: undefined });
  });

  it("renders Audio and Performance selects with centralized form classes", () => {
    const audio = createRdp();
    const audioRender = render(
      <AudioSection rdp={audio} updateRdp={vi.fn()} />,
    );

    const audioCombobox = audioRender.container.querySelector('[role="combobox"]') as HTMLButtonElement;
    expect(audioCombobox.className).toContain("sor-form-select");

    audioRender.unmount();

    const updatePerformance = vi.fn();
    const performance = createRdp();
    const performanceRender = render(
      <PerformanceSection rdp={performance} updateRdp={updatePerformance} />,
    );

    const performanceCombobox = performanceRender.container.querySelector('[role="combobox"]') as HTMLButtonElement;
    const performanceCheckbox = performanceRender.container.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(performanceCombobox.className).toContain("sor-form-select");
    expect(performanceCheckbox.className).toContain("sor-form-checkbox");

    fireEvent.click(performanceCheckbox);
    expect(updatePerformance).toHaveBeenCalledWith("performance", { disableWallpaper: false });
  });

  it("renders Input controls with centralized classes and keyboard detection affordance", () => {
    const updateRdp = vi.fn();
    const detectKeyboardLayout = vi.fn();
    const rdp = createRdp();
    rdp.input = {
      ...rdp.input,
      autoDetectLayout: true,
    };

    const { container } = render(
      <InputSection
        rdp={rdp}
        updateRdp={updateRdp}
        detectingLayout={false}
        detectKeyboardLayout={detectKeyboardLayout}
      />,
    );

    const comboboxes = container.querySelectorAll('[role="combobox"]');
    const keyboardLayoutSelect = comboboxes[2] as HTMLButtonElement;

    expect(comboboxes[0].className).toContain("sor-form-select");
    expect(keyboardLayoutSelect.className).toContain("sor-form-select");
    expect(keyboardLayoutSelect.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /detect/i }));
    expect(detectKeyboardLayout).toHaveBeenCalledTimes(1);
  });

  it("renders Negotiation and Hyper-V controls with centralized checkbox styling", () => {
    const updateNegotiation = vi.fn();
    const negotiation = createRdp();
    negotiation.negotiation = {
      ...negotiation.negotiation,
      autoDetect: true,
    };

    const negotiationRender = render(
      <NegotiationSection rdp={negotiation} updateRdp={updateNegotiation} />,
    );

    const negotiationCheckbox = negotiationRender.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(negotiationCheckbox.className).toContain("sor-form-checkbox");
    fireEvent.click(negotiationCheckbox);
    expect(updateNegotiation).toHaveBeenCalledWith("negotiation", { maxRetries: undefined });

    negotiationRender.unmount();

    const updateHyperV = vi.fn();
    const hyperv = createRdp();
    hyperv.hyperv = {
      ...hyperv.hyperv,
      useVmId: true,
    };

    const hypervRender = render(
      <HyperVSection rdp={hyperv} updateRdp={updateHyperV} />,
    );

    const hypervCheckbox = hypervRender.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const hypervInput = hypervRender.container.querySelector('input[type="text"]') as HTMLInputElement;

    expect(hypervCheckbox.className).toContain("sor-form-checkbox");
    expect(hypervInput.className).toContain("sor-form-input");

    fireEvent.click(hypervCheckbox);
    expect(updateHyperV).toHaveBeenCalledWith("hyperv", { useVmId: false });
  });

  it("renders Device Redirection dropdowns with centralized form classes", () => {
    const updateRdp = vi.fn();
    const rdp = createRdp();

    const { container } = render(
      <DeviceRedirectionSection rdp={rdp} updateRdp={updateRdp} />,
    );

    expect(screen.getByText("Clipboard Direction")).toBeInTheDocument();
    expect(screen.getByText("Printer Output Mode")).toBeInTheDocument();

    const comboboxes = Array.from(container.querySelectorAll('[role="combobox"]'));
    expect(comboboxes.length).toBeGreaterThan(2);
    expect(comboboxes.every((combobox) => combobox.className.includes("sor-form-select"))).toBe(true);
  });
});