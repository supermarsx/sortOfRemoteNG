import { Binary } from "lucide-react";
import {
  normalizeRawSocketSettings,
  type RawSocketLineEnding,
  type RawSocketPayloadEncoding,
  type RawSocketTcpFraming,
} from "../../../types/protocols/rawSocket";
import {
  RawSocketField,
  RawSocketSection,
  rawSocketInputClass,
  rawSocketSelectClass,
} from "./RawSocketSection";
import type { RawSocketSectionProps } from "./types";

type FramingMode = RawSocketTcpFraming["mode"];

const framingForMode = (mode: FramingMode): RawSocketTcpFraming => {
  if (mode === "delimiter") {
    return {
      mode,
      delimiterHex: "0a",
      includeDelimiter: false,
      maxFrameBytes: 65_536,
    };
  }
  if (mode === "fixed_length") return { mode, frameBytes: 1 };
  if (mode === "length_prefix") {
    return {
      mode,
      prefixBytes: 2,
      endian: "big",
      lengthIncludesPrefix: false,
      includePrefix: false,
      maxFrameBytes: 65_536,
    };
  }
  return { mode: "none" };
};

export function DataSection({
  settings,
  update,
  disabled,
}: RawSocketSectionProps) {
  const patchData = (
    patch: Partial<RawSocketSectionProps["settings"]["data"]>,
  ) =>
    update(
      normalizeRawSocketSettings({
        ...settings,
        data: { ...settings.data, ...patch },
      }),
    );
  const framing = settings.data.tcpFraming;

  return (
    <RawSocketSection
      id="data"
      title="Data"
      description="Configure binary-safe composer and transcript formats without interpreting terminal control codes."
      icon={Binary}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <RawSocketField
          id="raw-socket-input-encoding"
          label="Composer input format"
        >
          <select
            id="raw-socket-input-encoding"
            value={settings.data.inputEncoding}
            disabled={disabled}
            onChange={(event) =>
              patchData({
                inputEncoding: event.target.value as RawSocketPayloadEncoding,
              })
            }
            className={rawSocketSelectClass}
          >
            <option value="text">UTF-8 text</option>
            <option value="hex">Hex bytes</option>
            <option value="base64">Base64</option>
          </select>
        </RawSocketField>
        <RawSocketField
          id="raw-socket-display-encoding"
          label="Transcript display format"
        >
          <select
            id="raw-socket-display-encoding"
            value={settings.data.displayEncoding}
            disabled={disabled}
            onChange={(event) =>
              patchData({
                displayEncoding: event.target.value as RawSocketPayloadEncoding,
              })
            }
            className={rawSocketSelectClass}
          >
            <option value="text">UTF-8 text</option>
            <option value="hex">Hex bytes</option>
            <option value="base64">Base64</option>
          </select>
        </RawSocketField>
        <RawSocketField
          id="raw-socket-line-ending"
          label="Send line ending"
          description="The selected bytes are appended after decoding text, hex, or Base64 input."
        >
          <select
            id="raw-socket-line-ending"
            value={settings.data.lineEnding}
            disabled={disabled}
            onChange={(event) =>
              patchData({
                lineEnding: event.target.value as RawSocketLineEnding,
              })
            }
            className={rawSocketSelectClass}
          >
            <option value="none">None</option>
            <option value="lf">LF</option>
            <option value="crlf">CRLF</option>
          </select>
        </RawSocketField>
      </div>

      {settings.connection.transport === "udp" ? (
        <div
          role="status"
          className="rounded-md border border-primary/30 bg-primary/10 p-3 text-xs leading-relaxed text-[var(--color-textSecondary)]"
        >
          UDP receive calls remain separate transcript datagrams, including
          zero-length datagrams. TCP delimiter, fixed-length, and length-prefix
          framing are disabled for UDP.
        </div>
      ) : (
        <div className="space-y-4">
          <RawSocketField
            id="raw-socket-tcp-framing"
            label="TCP framing"
            description="TCP is a byte stream. Framing determines how receive chunks become transcript messages."
          >
            <select
              id="raw-socket-tcp-framing"
              value={framing.mode}
              disabled={disabled}
              onChange={(event) =>
                patchData({
                  tcpFraming: framingForMode(event.target.value as FramingMode),
                })
              }
              className={rawSocketSelectClass}
            >
              <option value="none">Read chunks as delivered</option>
              <option value="delimiter">Delimiter</option>
              <option value="fixed_length">Fixed length</option>
              <option value="length_prefix">Length prefix</option>
            </select>
          </RawSocketField>

          {framing.mode === "delimiter" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <RawSocketField
                id="raw-socket-frame-delimiter"
                label="Delimiter bytes (hex)"
              >
                <input
                  id="raw-socket-frame-delimiter"
                  value={framing.delimiterHex}
                  disabled={disabled}
                  spellCheck={false}
                  onChange={(event) =>
                    patchData({
                      tcpFraming: {
                        ...framing,
                        delimiterHex: event.target.value,
                      },
                    })
                  }
                  className={rawSocketInputClass}
                />
              </RawSocketField>
              <RawSocketField
                id="raw-socket-frame-max"
                label="Maximum frame bytes"
              >
                <input
                  id="raw-socket-frame-max"
                  type="number"
                  min={1}
                  max={1_048_576}
                  value={framing.maxFrameBytes}
                  disabled={disabled}
                  onChange={(event) =>
                    patchData({
                      tcpFraming: {
                        ...framing,
                        maxFrameBytes: Number(event.target.value),
                      },
                    })
                  }
                  className={rawSocketInputClass}
                />
              </RawSocketField>
              <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={framing.includeDelimiter}
                  disabled={disabled}
                  onChange={(event) =>
                    patchData({
                      tcpFraming: {
                        ...framing,
                        includeDelimiter: event.target.checked,
                      },
                    })
                  }
                  className="sor-form-checkbox"
                />
                Include delimiter bytes in each emitted frame
              </label>
            </div>
          )}

          {framing.mode === "fixed_length" && (
            <RawSocketField
              id="raw-socket-fixed-frame-bytes"
              label="Bytes per frame"
            >
              <input
                id="raw-socket-fixed-frame-bytes"
                type="number"
                min={1}
                max={1_048_576}
                value={framing.frameBytes}
                disabled={disabled}
                onChange={(event) =>
                  patchData({
                    tcpFraming: {
                      ...framing,
                      frameBytes: Number(event.target.value),
                    },
                  })
                }
                className={rawSocketInputClass}
              />
            </RawSocketField>
          )}

          {framing.mode === "length_prefix" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <RawSocketField
                id="raw-socket-prefix-bytes"
                label="Length prefix size"
              >
                <select
                  id="raw-socket-prefix-bytes"
                  value={framing.prefixBytes}
                  disabled={disabled}
                  onChange={(event) =>
                    patchData({
                      tcpFraming: {
                        ...framing,
                        prefixBytes: Number(event.target.value) as 1 | 2 | 4,
                      },
                    })
                  }
                  className={rawSocketSelectClass}
                >
                  <option value={1}>1 byte</option>
                  <option value={2}>2 bytes</option>
                  <option value={4}>4 bytes</option>
                </select>
              </RawSocketField>
              <RawSocketField id="raw-socket-prefix-endian" label="Byte order">
                <select
                  id="raw-socket-prefix-endian"
                  value={framing.endian}
                  disabled={disabled}
                  onChange={(event) =>
                    patchData({
                      tcpFraming: {
                        ...framing,
                        endian: event.target.value as "big" | "little",
                      },
                    })
                  }
                  className={rawSocketSelectClass}
                >
                  <option value="big">Big endian (network order)</option>
                  <option value="little">Little endian</option>
                </select>
              </RawSocketField>
              <RawSocketField
                id="raw-socket-prefix-max"
                label="Maximum payload bytes"
              >
                <input
                  id="raw-socket-prefix-max"
                  type="number"
                  min={1}
                  max={1_048_576}
                  value={framing.maxFrameBytes}
                  disabled={disabled}
                  onChange={(event) =>
                    patchData({
                      tcpFraming: {
                        ...framing,
                        maxFrameBytes: Number(event.target.value),
                      },
                    })
                  }
                  className={rawSocketInputClass}
                />
              </RawSocketField>
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                  <input
                    type="checkbox"
                    checked={framing.lengthIncludesPrefix}
                    disabled={disabled}
                    onChange={(event) =>
                      patchData({
                        tcpFraming: {
                          ...framing,
                          lengthIncludesPrefix: event.target.checked,
                        },
                      })
                    }
                    className="sor-form-checkbox"
                  />
                  Declared length includes prefix bytes
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                  <input
                    type="checkbox"
                    checked={framing.includePrefix}
                    disabled={disabled}
                    onChange={(event) =>
                      patchData({
                        tcpFraming: {
                          ...framing,
                          includePrefix: event.target.checked,
                        },
                      })
                    }
                    className="sor-form-checkbox"
                  />
                  Include prefix in emitted frame
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </RawSocketSection>
  );
}
