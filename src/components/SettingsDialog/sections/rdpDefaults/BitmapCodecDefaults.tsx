import type { SectionProps } from "./selectClass";
import React from "react";
import { Monitor, Sparkles, Cpu, FastForward } from "lucide-react";
import { Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const BitmapCodecDefaults: React.FC<SectionProps> = ({ rdp, update }) => {
  const codecsOn = rdp.codecsEnabled ?? true;
  const remoteFxOn = rdp.remoteFxEnabled ?? true;
  const gfxOn = rdp.gfxEnabled ?? false;
  const nalPassthrough = rdp.nalPassthrough ?? false;
  const currentFrontend = rdp.frontendRenderer ?? "auto";
  const isWebCodecsFrontend =
    currentFrontend === "webcodecs-worker" || currentFrontend === "webcodecs-cpu";
  const backendBypassed = nalPassthrough || isWebCodecsFrontend;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Monitor className="w-4 h-4 text-primary" />}
        title="Bitmap Codec Negotiation Defaults"
      />

      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Controls which bitmap compression codecs are advertised to the
          server. When disabled, only raw/RLE bitmaps are used (higher
          bandwidth, lower CPU).
        </p>

        <Toggle
          checked={codecsOn}
          onChange={(v) => update({ codecsEnabled: v })}
          icon={<Sparkles size={16} />}
          label="Enable Bitmap Codec Negotiation"
          description="Advertise advanced codecs to the server; when off, only raw/RLE bitmaps are used"
          infoTooltip="Advertises advanced bitmap compression codecs to the server. When disabled, only raw/RLE bitmaps are used."
        />

        <div
          className={!codecsOn ? "opacity-50 pointer-events-none space-y-3" : "space-y-3"}
        >
          <Toggle
            checked={remoteFxOn}
            onChange={(v) => update({ remoteFxEnabled: v })}
            icon={<Cpu size={16} />}
            label="RemoteFX (RFX)"
            description="DWT + RLGR entropy coding — best quality/compression balance"
            infoTooltip="Enables the RemoteFX codec which uses DWT and RLGR entropy coding for high-quality compression."
          />

          <div
            className={`pl-7 flex items-center gap-2 ${!remoteFxOn ? "opacity-50 pointer-events-none" : ""}`}
          >
            <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
              Entropy Algorithm:
              <InfoTooltip text="RLGR1 offers faster decoding; RLGR3 provides better compression at a slight CPU cost." />
            </span>
            <Select
              value={rdp.remoteFxEntropy ?? "rlgr3"}
              onChange={(v: string) =>
                update({ remoteFxEntropy: v as "rlgr1" | "rlgr3" })
              }
              options={[
                { value: "rlgr1", label: "RLGR1 (faster decoding)" },
                { value: "rlgr3", label: "RLGR3 (better compression)" },
              ]}
              className="selectClass"
            />
          </div>

          <div className="border-t border-[var(--color-border)] pt-3">
            <Toggle
              checked={gfxOn}
              onChange={(v) => update({ gfxEnabled: v })}
              icon={<FastForward size={16} />}
              label="RDPGFX (H.264 Hardware Decode)"
              description="Lowest bandwidth and CPU via GPU H.264 decoding"
              infoTooltip="Enables the RDPGFX pipeline for H.264-based screen encoding with GPU hardware acceleration."
            />

            <div
              className={`mt-3 space-y-3 ${!gfxOn ? "opacity-50 pointer-events-none" : ""}`}
            >
              <div
                className={`pl-7 flex items-center gap-2 ${backendBypassed ? "opacity-50 pointer-events-none" : ""}`}
              >
                <span className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
                  H.264 Decoder{backendBypassed ? " (N/A — decoded on frontend)" : ""}:
                  <InfoTooltip text="Selects the backend H.264 decoder. Media Foundation uses GPU hardware; openh264 is a software fallback." />
                </span>
                <Select
                  value={rdp.h264Decoder ?? "auto"}
                  onChange={(v: string) =>
                    update({
                      h264Decoder: v as
                        | "auto"
                        | "media-foundation"
                        | "openh264",
                    })
                  }
                  disabled={backendBypassed}
                  options={[
                    { value: "auto", label: "Auto (MF hardware → openh264 fallback)" },
                    { value: "media-foundation", label: "Media Foundation (GPU hardware)" },
                    { value: "openh264", label: "openh264 (software)" },
                  ]}
                  className="selectClass"
                />
              </div>

              <div className="pl-7">
                <Toggle
                  checked={nalPassthrough}
                  onChange={(v) => {
                    const updates: Record<string, any> = { nalPassthrough: v };
                    // Auto-set frontend renderer to webcodecs-worker when enabling passthrough
                    if (v && !isWebCodecsFrontend) {
                      updates.frontendRenderer = "webcodecs-worker";
                    }
                    update(updates);
                  }}
                  icon={<FastForward size={16} />}
                  label="NAL Passthrough (WebCodecs Decode)"
                  description="Skip backend H.264 decode; send raw NAL units to the frontend for WebCodecs"
                  infoTooltip="Skips backend H.264 decoding and sends raw NAL units to the frontend for WebCodecs-based decoding."
                />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default BitmapCodecDefaults;
