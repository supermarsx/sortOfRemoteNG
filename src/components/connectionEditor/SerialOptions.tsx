import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Cable,
  Gauge,
  RefreshCw,
  Search,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import React, { useState } from "react";
import type { Connection } from "../../types/connection/connection";
import {
  hasSerialMatchFilter,
  normalizeSerialSettings,
  serialHostnameFor,
  SERIAL_MATCH_MAX_LENGTH,
  SERIAL_STANDARD_BAUD_RATES,
  type SerialDataBits,
  type SerialFlowControl,
  type SerialLineEnding,
  type SerialParity,
  type SerialPortInfo,
  type SerialPortSelection,
  type SerialPortSelectionMode,
  type SerialScanResult,
  type SerialSettingsV1,
  type SerialStopBits,
} from "../../types/protocols/serial";
import { Checkbox, Select } from "../ui/forms";

export type SerialOptionsSection = "connection" | "terminal" | "advanced";

interface SerialOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  sections?: readonly SerialOptionsSection[];
}

const cardClass =
  "min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3";

const numberValue = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Parse a USB vendor/product id as typed by a user. `0x0403`, `0403` (a
 * leading zero or any a-f digit marks the conventional 4-digit hex form printed
 * on adapters and in device managers) and plain decimal such as `1027` all
 * yield 1027; anything else, or a value outside 0-65535, yields `null`.
 */
export const parseUsbId = (input: string): number | null => {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const hexDigits = text.startsWith("0x") ? text.slice(2) : text;
  const looksHex =
    text.startsWith("0x") || text.startsWith("0") || /[a-f]/.test(text);
  if (looksHex) {
    return /^[0-9a-f]{1,4}$/.test(hexDigits)
      ? Number.parseInt(hexDigits, 16)
      : null;
  }
  const decimal = /^[0-9]{1,5}$/.test(text) ? Number(text) : null;
  return decimal !== null && decimal <= 0xffff ? decimal : null;
};

const formatUsbId = (value: number | null | undefined): string =>
  typeof value === "number" ? `0x${value.toString(16).padStart(4, "0")}` : "";

const SELECTION_MODE_OPTIONS: {
  value: SerialPortSelectionMode;
  label: string;
}[] = [
  { value: "fixed", label: "Specific device path" },
  { value: "firstAny", label: "First detected serial device (USB preferred)" },
  { value: "firstUsb", label: "First USB serial device" },
  { value: "match", label: "First device matching a filter" },
];

const SELECTION_MODE_LABEL: Record<SerialPortSelectionMode, string> = {
  fixed: "specific device",
  firstAny: "first detected device",
  firstUsb: "first USB device",
  match: "matching device",
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const Toggle: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <label className="flex min-w-0 items-start gap-2.5">
    <Checkbox
      checked={checked}
      onChange={onChange}
      variant="form"
      aria-label={label}
    />
    <span className="min-w-0">
      <span className="block text-xs font-medium text-[var(--color-text)]">
        {label}
      </span>
      <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-textMuted)]">
        {description}
      </span>
    </span>
  </label>
);

export const SerialOptions: React.FC<SerialOptionsProps> = ({
  formData,
  setFormData,
  sections,
}) => {
  const settings = normalizeSerialSettings(formData.serialSettings);
  const [ports, setPorts] = useState<SerialScanResult["ports"]>([]);
  const [scanState, setScanState] = useState<
    "idle" | "scanning" | "complete" | "error"
  >("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<
    | { kind: "idle" }
    | { kind: "resolving" }
    | { kind: "found"; port: SerialPortInfo }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const selection = settings.portSelection;
  const mode = selection.mode;
  // Raw VID/PID text so partially typed hex (e.g. "0x4") is not clobbered.
  const [vidText, setVidText] = useState(() => formatUsbId(selection.vid));
  const [pidText, setPidText] = useState(() => formatUsbId(selection.pid));
  const vidInvalid = vidText.trim() !== "" && parseUsbId(vidText) === null;
  const pidInvalid = pidText.trim() !== "" && parseUsbId(pidText) === null;
  const shows = (section: SerialOptionsSection) =>
    !sections || sections.includes(section);

  const updateSettings = (patch: Partial<SerialSettingsV1>) =>
    setFormData((previous) => {
      const next = {
        ...normalizeSerialSettings(previous.serialSettings),
        ...patch,
      };
      return {
        ...previous,
        serialSettings: next,
        ...(patch.portName === undefined && patch.portSelection === undefined
          ? {}
          : { hostname: serialHostnameFor(next) }),
        port: 0,
      };
    });

  const updateSelection = (patch: Partial<SerialPortSelection>) => {
    setPreviewState({ kind: "idle" });
    const nextMode = patch.mode ?? mode;
    const next: SerialPortSelection =
      nextMode === "match"
        ? {
            mode: "match",
            vid: patch.vid !== undefined ? patch.vid : (selection.vid ?? null),
            pid: patch.pid !== undefined ? patch.pid : (selection.pid ?? null),
            match:
              patch.match !== undefined ? patch.match : (selection.match ?? ""),
          }
        : { mode: nextMode };
    updateSettings({ portSelection: next });
  };

  const changeMode = (nextMode: SerialPortSelectionMode) => {
    if (nextMode === "match") {
      setVidText(formatUsbId(selection.vid));
      setPidText(formatUsbId(selection.pid));
    }
    updateSelection({ mode: nextMode });
  };

  const changeUsbId = (field: "vid" | "pid", text: string) => {
    (field === "vid" ? setVidText : setPidText)(text);
    updateSelection({ [field]: parseUsbId(text) });
  };

  const pickDetectedDevice = (portName: string) => {
    if (mode !== "match") {
      updateSettings({ portName });
      return;
    }
    const port = ports.find((candidate) => candidate.portName === portName);
    if (!port) return;
    setVidText(formatUsbId(port.vid));
    setPidText(formatUsbId(port.pid));
    updateSelection({ vid: port.vid ?? null, pid: port.pid ?? null });
  };

  const previewSelection = async () => {
    setPreviewState({ kind: "resolving" });
    try {
      const port = await invoke<SerialPortInfo>("serial_resolve_port", {
        selection,
        portName: null,
      });
      setPreviewState({ kind: "found", port });
    } catch (error) {
      setPreviewState({ kind: "error", message: errorText(error) });
    }
  };

  const scanPorts = async () => {
    setScanState("scanning");
    setScanError(null);
    try {
      const result = await invoke<SerialScanResult>("serial_scan_ports", {
        options: {
          probePorts: false,
          nameFilter: null,
          vidFilter: null,
          pidFilter: null,
          includeVirtual: true,
        },
      });
      setPorts(result.ports);
      setScanState("complete");
    } catch (error) {
      setScanState("error");
      setScanError(errorText(error));
    }
  };

  const matchFilterMissing =
    mode === "match" && !hasSerialMatchFilter(selection);
  const previewDisabled =
    previewState.kind === "resolving" || matchFilterMissing;

  if (formData.isGroup || formData.protocol !== "serial") return null;

  return (
    <div
      data-editor-search-section="serial-options"
      className="min-w-0 space-y-3"
    >
      {shows("connection") && (
        <>
          <section
            data-editor-search-field="serial-device"
            className={cardClass}
          >
            <div className="flex items-start gap-2">
              <Cable size={15} className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h4 className="text-xs font-semibold text-[var(--color-text)]">
                  Local serial device
                </h4>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
                  Uses a device attached to this computer. Serial connections do
                  not use a hostname, TCP port, proxy, or network path.
                </p>
              </div>
            </div>

            <div data-editor-search-field="serial-device-mode">
              <Select
                id="serial-device-mode"
                label="Device selection"
                value={mode}
                onChange={(value) =>
                  changeMode(value as SerialPortSelectionMode)
                }
                options={SELECTION_MODE_OPTIONS}
                variant="form-sm"
                className="w-full min-w-0"
                data-testid="serial-device-mode"
              />
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
              {mode === "fixed" && (
                <label className="min-w-0 flex-1">
                  <span className="sor-form-label">Device path or port</span>
                  <input
                    id="serial-device"
                    type="text"
                    required
                    value={settings.portName}
                    onChange={(event) =>
                      updateSettings({ portName: event.target.value })
                    }
                    className="sor-form-input-sm w-full min-w-0 font-mono"
                    placeholder="COM3 or /dev/ttyUSB0"
                    autoComplete="off"
                  />
                </label>
              )}
              {mode !== "fixed" && (
                <p
                  className="min-w-0 flex-1 text-[11px] leading-4 text-[var(--color-textMuted)]"
                  data-testid="serial-device-auto-copy"
                >
                  Resolved each time you connect; the chosen port is shown in
                  the session header. Ports already used by another session are
                  skipped.
                </p>
              )}
              <button
                type="button"
                onClick={() => void scanPorts()}
                disabled={scanState === "scanning"}
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs font-medium hover:bg-[var(--color-surfaceHover)] disabled:opacity-60"
              >
                <RefreshCw
                  size={13}
                  className={scanState === "scanning" ? "animate-spin" : ""}
                />
                {scanState === "scanning" ? "Scanning…" : "Scan devices"}
              </button>
              {mode !== "fixed" && (
                <button
                  type="button"
                  onClick={() => void previewSelection()}
                  disabled={previewDisabled}
                  data-testid="serial-device-preview"
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs font-medium hover:bg-[var(--color-surfaceHover)] disabled:opacity-60"
                >
                  <Search size={13} />
                  {previewState.kind === "resolving" ? "Resolving…" : "Preview"}
                </button>
              )}
            </div>

            {mode === "match" && (
              <div
                data-editor-search-field="serial-device-match"
                className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3"
              >
                <div className="min-w-0">
                  <label className="block min-w-0">
                    <span className="sor-form-label">Vendor ID (hex)</span>
                    <input
                      id="serial-match-vid"
                      type="text"
                      value={vidText}
                      onChange={(event) =>
                        changeUsbId("vid", event.target.value)
                      }
                      className="sor-form-input-sm w-full min-w-0 font-mono"
                      placeholder="0403"
                      autoComplete="off"
                      aria-invalid={vidInvalid || undefined}
                      aria-describedby={
                        vidInvalid ? "serial-match-vid-hint" : undefined
                      }
                    />
                  </label>
                  {vidInvalid && (
                    <span
                      id="serial-match-vid-hint"
                      className="mt-0.5 block text-[10px] text-error"
                      data-testid="serial-match-vid-hint"
                    >
                      Enter a hex id such as 0403 or 0x0403 (0-ffff).
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <label className="block min-w-0">
                    <span className="sor-form-label">Product ID (hex)</span>
                    <input
                      id="serial-match-pid"
                      type="text"
                      value={pidText}
                      onChange={(event) =>
                        changeUsbId("pid", event.target.value)
                      }
                      className="sor-form-input-sm w-full min-w-0 font-mono"
                      placeholder="6001"
                      autoComplete="off"
                      aria-invalid={pidInvalid || undefined}
                      aria-describedby={
                        pidInvalid ? "serial-match-pid-hint" : undefined
                      }
                    />
                  </label>
                  {pidInvalid && (
                    <span
                      id="serial-match-pid-hint"
                      className="mt-0.5 block text-[10px] text-error"
                      data-testid="serial-match-pid-hint"
                    >
                      Enter a hex id such as 6001 or 0x6001 (0-ffff).
                    </span>
                  )}
                </div>
                <label className="min-w-0">
                  <span className="sor-form-label">Name contains</span>
                  <input
                    id="serial-match-text"
                    type="text"
                    value={selection.match ?? ""}
                    maxLength={SERIAL_MATCH_MAX_LENGTH}
                    onChange={(event) =>
                      updateSelection({ match: event.target.value })
                    }
                    className="sor-form-input-sm w-full min-w-0"
                    placeholder="FTDI, CP210x, serial number…"
                    autoComplete="off"
                  />
                </label>
                {matchFilterMissing && (
                  <p
                    className="text-[11px] text-[var(--color-textMuted)] sm:col-span-3"
                    data-testid="serial-match-filter-hint"
                  >
                    Add a vendor ID, product ID, or name filter. Picking a
                    detected device below fills in its IDs.
                  </p>
                )}
              </div>
            )}

            {previewState.kind === "found" && (
              <p
                className="text-[11px] text-[var(--color-textMuted)]"
                role="status"
                data-testid="serial-device-preview-result"
              >
                Would connect to{" "}
                <span className="font-mono text-[var(--color-text)]">
                  {previewState.port.displayName}
                </span>{" "}
                right now.
              </p>
            )}
            {previewState.kind === "error" && (
              <p
                className="text-[11px] text-error"
                role="alert"
                data-testid="serial-device-preview-error"
              >
                {previewState.message.startsWith("PortNotFound:")
                  ? `No attached device matches "${SELECTION_MODE_LABEL[mode]}". ${previewState.message.slice("PortNotFound:".length).trim()}`
                  : `Preview failed: ${previewState.message}`}
              </p>
            )}

            {ports.length > 0 && (
              <label className="block min-w-0">
                <span className="sor-form-label">Detected serial device</span>
                <select
                  value={
                    mode === "fixed" &&
                    ports.some((port) => port.portName === settings.portName)
                      ? settings.portName
                      : ""
                  }
                  onChange={(event) => pickDetectedDevice(event.target.value)}
                  className="sor-form-select-sm w-full min-w-0"
                >
                  <option value="">
                    {mode === "match"
                      ? "Copy IDs from a detected device…"
                      : "Choose a detected device…"}
                  </option>
                  {ports.map((port) => (
                    <option
                      key={port.portName}
                      value={port.portName}
                      disabled={port.inUse}
                    >
                      {port.displayName}
                      {port.inUse ? " (in use)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {scanState === "complete" && ports.length === 0 && (
              <p
                className="text-[11px] text-[var(--color-textMuted)]"
                role="status"
              >
                No serial devices were reported. You can still enter a device
                path manually.
              </p>
            )}
            {scanError && (
              <p className="text-[11px] text-error" role="alert">
                Device scan failed: {scanError}
              </p>
            )}
          </section>

          <section className={cardClass}>
            <div
              data-editor-search-field="serial-baud-rate"
              className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <label className="min-w-0">
                <span className="sor-form-label">Baud rate</span>
                <input
                  id="serial-baud-rate"
                  type="number"
                  min={1}
                  max={4_000_000}
                  list="serial-standard-baud-rates"
                  value={settings.baudRate}
                  onChange={(event) =>
                    updateSettings({
                      baudRate: numberValue(
                        event.target.value,
                        settings.baudRate,
                      ),
                    })
                  }
                  className="sor-form-input-sm w-full min-w-0"
                />
                <datalist id="serial-standard-baud-rates">
                  {SERIAL_STANDARD_BAUD_RATES.map((rate) => (
                    <option key={rate} value={rate} />
                  ))}
                </datalist>
              </label>
              <div data-editor-search-field="serial-data-bits">
                <Select
                  id="serial-data-bits"
                  label="Data bits"
                  value={settings.dataBits}
                  onChange={(dataBits) =>
                    updateSettings({ dataBits: dataBits as SerialDataBits })
                  }
                  options={["5", "6", "7", "8"].map((value) => ({
                    value,
                    label: value,
                  }))}
                  variant="form-sm"
                  className="w-full min-w-0"
                />
              </div>
              <div data-editor-search-field="serial-parity">
                <Select
                  id="serial-parity"
                  label="Parity"
                  value={settings.parity}
                  onChange={(parity) =>
                    updateSettings({ parity: parity as SerialParity })
                  }
                  options={[
                    { value: "none", label: "None" },
                    { value: "odd", label: "Odd" },
                    { value: "even", label: "Even" },
                  ]}
                  variant="form-sm"
                  className="w-full min-w-0"
                />
              </div>
              <div data-editor-search-field="serial-stop-bits">
                <Select
                  id="serial-stop-bits"
                  label="Stop bits"
                  value={settings.stopBits}
                  onChange={(stopBits) =>
                    updateSettings({ stopBits: stopBits as SerialStopBits })
                  }
                  options={[
                    { value: "1", label: "1" },
                    { value: "2", label: "2" },
                  ]}
                  variant="form-sm"
                  className="w-full min-w-0"
                />
              </div>
              <div
                data-editor-search-field="serial-flow-control"
                className="sm:col-span-2"
              >
                <Select
                  id="serial-flow-control"
                  label="Flow control"
                  value={settings.flowControl}
                  onChange={(flowControl) =>
                    updateSettings({
                      flowControl: flowControl as SerialFlowControl,
                    })
                  }
                  options={[
                    { value: "none", label: "None" },
                    { value: "xonXoff", label: "Software (XON/XOFF)" },
                    { value: "rtsCts", label: "Hardware (RTS/CTS)" },
                  ]}
                  variant="form-sm"
                  className="w-full min-w-0"
                />
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-[10px] leading-4 text-[var(--color-textMuted)]">
              <AlertTriangle
                size={13}
                className="mt-0.5 shrink-0 text-warning"
              />
              Mark/Space parity, 1.5 stop bits, and distinct DTR/DSR flow
              control are not offered because the current native driver maps
              them to different modes.
            </div>
          </section>
        </>
      )}

      {shows("terminal") && (
        <section className={cardClass}>
          <div className="flex items-start gap-2">
            <TerminalSquare
              size={15}
              className="mt-0.5 shrink-0 text-primary"
            />
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-text)]">
                Terminal input
              </h4>
              <p className="mt-0.5 text-[11px] text-[var(--color-textMuted)]">
                Input is sent as exact bytes; only Enter/newline sequences use
                the selected line ending.
              </p>
            </div>
          </div>
          <div data-editor-search-field="serial-line-ending">
            <Select
              id="serial-line-ending"
              label="Enter key / line ending"
              value={settings.lineEnding}
              onChange={(lineEnding) =>
                updateSettings({ lineEnding: lineEnding as SerialLineEnding })
              }
              options={[
                { value: "crLf", label: "CRLF (\\r\\n)" },
                { value: "cr", label: "CR (\\r)" },
                { value: "lf", label: "LF (\\n)" },
                { value: "none", label: "No newline bytes" },
              ]}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </div>
          <div data-editor-search-field="serial-local-echo">
            <Toggle
              checked={settings.localEcho}
              onChange={(localEcho) => updateSettings({ localEcho })}
              label="Local echo"
              description="Show terminal input after the native driver writes it successfully, without waiting for the device to echo it."
            />
          </div>
        </section>
      )}

      {shows("advanced") && (
        <section className={cardClass}>
          <div className="flex items-start gap-2">
            <Settings2 size={15} className="mt-0.5 shrink-0 text-primary" />
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-text)]">
                Driver and control defaults
              </h4>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
                Windows uses COM names, Linux typically uses /dev/ttyUSB* or
                /dev/ttyACM* and requires device permissions, and macOS commonly
                uses /dev/cu.*. Driver support can still reject a valid-looking
                combination.
              </p>
            </div>
          </div>
          <div
            data-editor-search-field="serial-control-open"
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <Toggle
              checked={settings.dtrOnOpen}
              onChange={(dtrOnOpen) => updateSettings({ dtrOnOpen })}
              label="Assert DTR on open"
              description="Set Data Terminal Ready when the port opens."
            />
            <Toggle
              checked={settings.rtsOnOpen}
              onChange={(rtsOnOpen) => updateSettings({ rtsOnOpen })}
              label="Assert RTS on open"
              description="Set Request To Send when the port opens."
            />
          </div>
          <div
            data-editor-search-field="serial-timeouts"
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <label className="min-w-0">
              <span className="sor-form-label">Read timeout (ms)</span>
              <input
                type="number"
                min={0}
                max={60_000}
                value={settings.readTimeoutMs}
                onChange={(event) =>
                  updateSettings({
                    readTimeoutMs: numberValue(
                      event.target.value,
                      settings.readTimeoutMs,
                    ),
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              />
            </label>
            <label className="min-w-0">
              <span className="sor-form-label">Write timeout (ms)</span>
              <input
                type="number"
                min={0}
                max={60_000}
                value={settings.writeTimeoutMs}
                onChange={(event) =>
                  updateSettings({
                    writeTimeoutMs: numberValue(
                      event.target.value,
                      settings.writeTimeoutMs,
                    ),
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              />
            </label>
          </div>
          <div
            data-editor-search-field="serial-buffers"
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <label className="min-w-0">
              <span className="sor-form-label">Receive buffer (bytes)</span>
              <input
                type="number"
                min={256}
                max={1_048_576}
                value={settings.rxBufferSize}
                onChange={(event) =>
                  updateSettings({
                    rxBufferSize: numberValue(
                      event.target.value,
                      settings.rxBufferSize,
                    ),
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              />
            </label>
            <label className="min-w-0">
              <span className="sor-form-label">Transmit buffer (bytes)</span>
              <input
                type="number"
                min={256}
                max={1_048_576}
                value={settings.txBufferSize}
                onChange={(event) =>
                  updateSettings({
                    txBufferSize: numberValue(
                      event.target.value,
                      settings.txBufferSize,
                    ),
                  })
                }
                className="sor-form-input-sm w-full min-w-0"
              />
            </label>
          </div>
          <label
            data-editor-search-field="serial-character-delay"
            className="block min-w-0"
          >
            <span className="sor-form-label">Inter-character delay (ms)</span>
            <input
              type="number"
              min={0}
              max={10_000}
              value={settings.charDelayMs}
              onChange={(event) =>
                updateSettings({
                  charDelayMs: numberValue(
                    event.target.value,
                    settings.charDelayMs,
                  ),
                })
              }
              className="sor-form-input-sm w-full min-w-0"
            />
          </label>
          <div className="flex items-start gap-2 rounded-md bg-[var(--color-surfaceHover)] px-2.5 py-2 text-[10px] leading-4 text-[var(--color-textMuted)]">
            <Gauge size={13} className="mt-0.5 shrink-0" />A zero read timeout
            still uses a short native polling timeout so the session can
            disconnect promptly.
          </div>
        </section>
      )}
    </div>
  );
};

export default SerialOptions;
