import type { SectionProps } from "./selectClass";
import { selectClass } from "./selectClass";
import React from "react";
import { Monitor } from "lucide-react";
import { Checkbox, Select } from "../../../ui/forms";

const BitmapCodecDefaults: React.FC<SectionProps> = ({ rdp, update }) => (
  <div className="sor-settings-card">
    <h4 className="sor-section-heading">
      <Monitor className="w-4 h-4 text-purple-400" />
      Bitmap Codec Negotiation Defaults
    </h4>
    <p className="text-xs text-[var(--color-textMuted)] -mt-2">
      Controls which bitmap compression codecs are advertised to the server.
      When disabled, only raw/RLE bitmaps are used (higher bandwidth, lower
      CPU).
    </p>

    <label className="flex items-center space-x-3 cursor-pointer group">
      <Checkbox checked={rdp.codecsEnabled ?? true} onChange={(v: boolean) => update({ codecsEnabled: v })} />
      <span className="sor-toggle-label font-medium">
        Enable Bitmap Codec Negotiation
      </span>
    </label>

    {(rdp.codecsEnabled ?? true) && (
      <>
        <label className="flex items-center space-x-3 cursor-pointer group ml-4">
          <Checkbox checked={rdp.remoteFxEnabled ?? true} onChange={(v: boolean) => update({ remoteFxEnabled: v })} />
          <span className="sor-toggle-label">
            RemoteFX (RFX)
          </span>
          <span className="text-xs text-[var(--color-textMuted)]">
            — DWT + RLGR entropy, best quality/compression
          </span>
        </label>

        {(rdp.remoteFxEnabled ?? true) && (
          <div className="ml-11 flex items-center gap-2">
            <span className="text-sm text-[var(--color-textSecondary)]">
              Entropy Algorithm:
            </span>
            <Select value={rdp.remoteFxEntropy ?? "rlgr3"} onChange={(v: string) => update({
                  remoteFxEntropy: v as "rlgr1" | "rlgr3",
                })} options={[{ value: "rlgr1", label: "RLGR1 (faster decoding)" }, { value: "rlgr3", label: "RLGR3 (better compression)" }]} className="selectClass" />
          </div>
        )}

        <div className="border-t border-[var(--color-border)] pt-3 mt-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={rdp.gfxEnabled ?? false} onChange={(v: boolean) => update({ gfxEnabled: v })} />
            <span className="sor-toggle-label">
              RDPGFX (H.264 Hardware Decode)
            </span>
            <span className="text-xs text-[var(--color-textMuted)]">
              — lowest bandwidth &amp; CPU via GPU decode
            </span>
          </label>

          {(rdp.gfxEnabled ?? false) && (
            <div className="ml-11 flex items-center gap-2 mt-2">
              <span className="text-sm text-[var(--color-textSecondary)]">
                H.264 Decoder:
              </span>
              <Select value={rdp.h264Decoder ?? "auto"} onChange={(v: string) => update({
                    h264Decoder: v as
                      | "auto"
                      | "media-foundation"
                      | "openh264",
                  })} options={[{ value: "auto", label: "Auto (MF hardware → openh264 fallback)" }, { value: "media-foundation", label: "Media Foundation (GPU hardware)" }, { value: "openh264", label: "openh264 (software)" }]} className="selectClass" />
            </div>
          )}
        </div>
      </>
    )}
  </div>
);

export default BitmapCodecDefaults;
