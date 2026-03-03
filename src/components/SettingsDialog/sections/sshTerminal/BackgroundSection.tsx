import React, { useState } from "react";
import { Image, Layers, Sparkles } from "lucide-react";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import Toggle from "./Toggle";
import {
  TerminalBackgroundTypes,
  GradientDirections,
  AnimatedBackgroundEffects,
  FadingEdges,
  OverlayBlendModes,
  defaultTerminalBackground,
  defaultTerminalFading,
  type TerminalBackgroundConfig,
  type TerminalOverlay,
  type GradientStop,
  type SSHTerminalConfig,
} from "../../../../types/sshSettings";

/* ── tiny helpers ────────────────────────────────────────────── */

const labelClass = "text-sm text-[var(--color-textSecondary)]";
const inputClass =
  "w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const selectClass = inputClass;
const colorInputClass =
  "w-10 h-8 p-0 border border-[var(--color-border)] rounded cursor-pointer bg-transparent";

function SliderInput({
  value,
  onChange,
  label,
  min = 0,
  max = 1,
  step = 0.05,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className={labelClass}>{label}</label>
        <span className="text-xs text-[var(--color-textSecondary)] tabular-nums">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  );
}

function SelectField({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ColorField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={colorInputClass}
      />
      <label className={labelClass}>{label}</label>
    </div>
  );
}

function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className={inputClass}
      />
    </div>
  );
}

/* ── Gradient stop editor ────────────────────────────────────── */

function GradientStopsEditor({
  stops,
  onChange,
  t,
}: {
  stops: GradientStop[];
  onChange: (s: GradientStop[]) => void;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <div className="space-y-2">
      <label className={labelClass}>
        {t("settings.sshTerminal.bg.gradientStops", "Gradient Stops")}
      </label>
      {stops.map((stop, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="color"
            value={stop.color}
            onChange={(e) => {
              const copy = [...stops];
              copy[i] = { ...stop, color: e.target.value };
              onChange(copy);
            }}
            className={colorInputClass}
          />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={stop.position}
            onChange={(e) => {
              const copy = [...stops];
              copy[i] = { ...stop, position: parseInt(e.target.value) };
              onChange(copy);
            }}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-[var(--color-textSecondary)] w-8 text-right tabular-nums">
            {stop.position}%
          </span>
          {stops.length > 2 && (
            <button
              onClick={() => onChange(stops.filter((_, j) => j !== i))}
              className="text-red-400 hover:text-red-300 text-xs px-1"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() =>
          onChange([...stops, { color: "#3b82f6", position: 50 }])
        }
        className="text-xs text-blue-400 hover:text-blue-300"
      >
        + {t("settings.sshTerminal.bg.addStop", "Add stop")}
      </button>
    </div>
  );
}

/* ── Overlay editor ──────────────────────────────────────────── */

const OVERLAY_TYPES = [
  "color",
  "gradient",
  "vignette",
  "scanlines",
  "noise",
  "crt",
  "grid",
] as const;

function OverlayEditor({
  overlays,
  onChange,
  t,
}: {
  overlays: TerminalOverlay[];
  onChange: (o: TerminalOverlay[]) => void;
  t: (key: string, fallback: string) => string;
}) {
  const addOverlay = () => {
    const id = `overlay-${Date.now()}`;
    onChange([
      ...overlays,
      {
        id,
        enabled: true,
        type: "vignette",
        opacity: 0.5,
        blendMode: "normal",
      },
    ]);
  };

  const updateOverlay = (idx: number, patch: Partial<TerminalOverlay>) => {
    const copy = [...overlays];
    copy[idx] = { ...copy[idx], ...patch };
    onChange(copy);
  };

  const removeOverlay = (idx: number) => {
    onChange(overlays.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className={labelClass}>
          {t("settings.sshTerminal.bg.overlays", "Overlays")}
        </label>
        <button
          onClick={addOverlay}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + {t("settings.sshTerminal.bg.addOverlay", "Add overlay")}
        </button>
      </div>

      {overlays.length === 0 && (
        <p className="text-xs text-[var(--color-textSecondary)] italic">
          {t(
            "settings.sshTerminal.bg.noOverlays",
            "No overlays configured. Add one to layer effects over the terminal.",
          )}
        </p>
      )}

      {overlays.map((ov, i) => (
        <div
          key={ov.id}
          className="border border-[var(--color-border)] rounded-lg p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={ov.enabled}
                onChange={(e) =>
                  updateOverlay(i, { enabled: e.target.checked })
                }
                className="accent-blue-500"
              />
              {t(
                `settings.sshTerminal.bg.overlayType.${ov.type}`,
                ov.type.charAt(0).toUpperCase() + ov.type.slice(1),
              )}
            </label>
            <button
              onClick={() => removeOverlay(i)}
              className="text-red-400 hover:text-red-300 text-xs"
            >
              {t("settings.sshTerminal.bg.remove", "Remove")}
            </button>
          </div>

          {ov.enabled && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
              <SelectField
                value={ov.type}
                onChange={(v) =>
                  updateOverlay(i, {
                    type: v as TerminalOverlay["type"],
                  })
                }
                label={t("settings.sshTerminal.bg.type", "Type")}
                options={OVERLAY_TYPES.map((t) => ({
                  value: t,
                  label: t.charAt(0).toUpperCase() + t.slice(1),
                }))}
              />
              <SliderInput
                value={ov.opacity}
                onChange={(v) => updateOverlay(i, { opacity: v })}
                label={t("settings.sshTerminal.bg.opacity", "Opacity")}
              />
              <SelectField
                value={ov.blendMode}
                onChange={(v) =>
                  updateOverlay(i, {
                    blendMode: v as TerminalOverlay["blendMode"],
                  })
                }
                label={t("settings.sshTerminal.bg.blendMode", "Blend Mode")}
                options={[...OverlayBlendModes].map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
              {(ov.type === "color" || ov.type === "gradient") && (
                <ColorField
                  value={ov.color || "#000000"}
                  onChange={(v) => updateOverlay(i, { color: v })}
                  label={t("settings.sshTerminal.bg.color", "Color")}
                />
              )}
              {(ov.type === "scanlines" ||
                ov.type === "noise" ||
                ov.type === "crt" ||
                ov.type === "grid") && (
                <SliderInput
                  value={ov.intensity ?? 1}
                  onChange={(v) => updateOverlay(i, { intensity: v })}
                  label={t(
                    "settings.sshTerminal.bg.intensity",
                    "Intensity",
                  )}
                  min={0.1}
                  max={3}
                  step={0.1}
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main section ────────────────────────────────────────────── */

interface BackgroundSectionProps {
  cfg: SSHTerminalConfig;
  up: (updates: Partial<SSHTerminalConfig>) => void;
  t: (key: string, fallback: string) => string;
}

const BackgroundSection: React.FC<BackgroundSectionProps> = ({
  cfg,
  up,
  t,
}) => {
  const bg = cfg.background || defaultTerminalBackground;
  const fading = bg.fading || defaultTerminalFading;

  const ubg = (patch: Partial<TerminalBackgroundConfig>) => {
    up({ background: { ...bg, ...patch } });
  };

  return (
    <SettingsCollapsibleSection
      title={t(
        "settings.sshTerminal.bg.title",
        "Backgrounds, Fading & Overlays",
      )}
      icon={<Layers className="w-4 h-4 text-indigo-400" />}
      defaultOpen={false}
    >
      <div className="space-y-5">
        {/* ── Master toggle ── */}
        <Toggle
          checked={bg.enabled}
          onChange={(v) => ubg({ enabled: v })}
          label={t(
            "settings.sshTerminal.bg.enable",
            "Enable custom background",
          )}
          description={t(
            "settings.sshTerminal.bg.enableDesc",
            "Render backgrounds, fading edges, and overlay effects behind the terminal",
          )}
        />

        {bg.enabled && (
          <>
            {/* ── Background type ── */}
            <SelectField
              value={bg.type}
              onChange={(v) =>
                ubg({ type: v as TerminalBackgroundConfig["type"] })
              }
              label={t(
                "settings.sshTerminal.bg.bgType",
                "Background Type",
              )}
              options={[...TerminalBackgroundTypes].map((bt) => ({
                value: bt,
                label: t(
                  `settings.sshTerminal.bg.bgTypes.${bt}`,
                  bt.charAt(0).toUpperCase() + bt.slice(1),
                ),
              }))}
            />

            <SliderInput
              value={bg.opacity}
              onChange={(v) => ubg({ opacity: v })}
              label={t(
                "settings.sshTerminal.bg.bgOpacity",
                "Background Opacity",
              )}
            />

            {/* ── Solid ── */}
            {bg.type === "solid" && (
              <ColorField
                value={bg.solidColor || "#0b1120"}
                onChange={(v) => ubg({ solidColor: v })}
                label={t(
                  "settings.sshTerminal.bg.solidColor",
                  "Solid Color",
                )}
              />
            )}

            {/* ── Gradient ── */}
            {bg.type === "gradient" && (
              <div className="space-y-3">
                <SelectField
                  value={bg.gradientDirection || "to-bottom"}
                  onChange={(v) =>
                    ubg({
                      gradientDirection:
                        v as TerminalBackgroundConfig["gradientDirection"],
                    })
                  }
                  label={t(
                    "settings.sshTerminal.bg.direction",
                    "Direction",
                  )}
                  options={[...GradientDirections].map((d) => ({
                    value: d,
                    label: t(
                      `settings.sshTerminal.bg.dirs.${d}`,
                      d,
                    ),
                  }))}
                />
                <GradientStopsEditor
                  stops={
                    bg.gradientStops || [
                      { color: "#0b1120", position: 0 },
                      { color: "#1a1a2e", position: 100 },
                    ]
                  }
                  onChange={(s) => ubg({ gradientStops: s })}
                  t={t}
                />
              </div>
            )}

            {/* ── Image ── */}
            {bg.type === "image" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className={labelClass}>
                    {t(
                      "settings.sshTerminal.bg.imagePath",
                      "Image Path / URL",
                    )}
                  </label>
                  <input
                    type="text"
                    value={bg.imagePath || ""}
                    onChange={(e) => ubg({ imagePath: e.target.value })}
                    placeholder="https://... or /path/to/image.png"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SliderInput
                    value={bg.imageOpacity ?? 0.15}
                    onChange={(v) => ubg({ imageOpacity: v })}
                    label={t(
                      "settings.sshTerminal.bg.imageOpacity",
                      "Image Opacity",
                    )}
                  />
                  <NumberField
                    value={bg.imageBlur ?? 0}
                    onChange={(v) => ubg({ imageBlur: v })}
                    label={t(
                      "settings.sshTerminal.bg.imageBlur",
                      "Blur (px)",
                    )}
                    min={0}
                    max={50}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    value={bg.imageSize || "cover"}
                    onChange={(v) =>
                      ubg({
                        imageSize:
                          v as TerminalBackgroundConfig["imageSize"],
                      })
                    }
                    label={t(
                      "settings.sshTerminal.bg.imageSize",
                      "Size Mode",
                    )}
                    options={[
                      { value: "cover", label: "Cover" },
                      { value: "contain", label: "Contain" },
                      { value: "fill", label: "Fill" },
                      { value: "tile", label: "Tile" },
                    ]}
                  />
                  <div className="space-y-1">
                    <label className={labelClass}>
                      {t(
                        "settings.sshTerminal.bg.imagePosition",
                        "Position",
                      )}
                    </label>
                    <input
                      type="text"
                      value={bg.imagePosition || "center center"}
                      onChange={(e) =>
                        ubg({ imagePosition: e.target.value })
                      }
                      placeholder="center center"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Animated ── */}
            {bg.type === "animated" && (
              <div className="space-y-3">
                <SelectField
                  value={bg.animatedEffect || "matrix-rain"}
                  onChange={(v) =>
                    ubg({
                      animatedEffect:
                        v as TerminalBackgroundConfig["animatedEffect"],
                    })
                  }
                  label={t(
                    "settings.sshTerminal.bg.effect",
                    "Effect",
                  )}
                  options={[...AnimatedBackgroundEffects].map((e) => ({
                    value: e,
                    label: t(
                      `settings.sshTerminal.bg.effects.${e}`,
                      e
                        .split("-")
                        .map(
                          (w) =>
                            w.charAt(0).toUpperCase() + w.slice(1),
                        )
                        .join(" "),
                    ),
                  }))}
                />
                <div className="grid grid-cols-3 gap-3">
                  <SliderInput
                    value={bg.animationSpeed ?? 1}
                    onChange={(v) => ubg({ animationSpeed: v })}
                    label={t(
                      "settings.sshTerminal.bg.speed",
                      "Speed",
                    )}
                    min={0.1}
                    max={3}
                    step={0.1}
                  />
                  <SliderInput
                    value={bg.animationDensity ?? 1}
                    onChange={(v) => ubg({ animationDensity: v })}
                    label={t(
                      "settings.sshTerminal.bg.density",
                      "Density",
                    )}
                    min={0.1}
                    max={3}
                    step={0.1}
                  />
                  <ColorField
                    value={bg.animationColor || "#00ff41"}
                    onChange={(v) => ubg({ animationColor: v })}
                    label={t(
                      "settings.sshTerminal.bg.animColor",
                      "Color",
                    )}
                  />
                </div>
              </div>
            )}

            {/* ── Fading ── */}
            <SettingsCollapsibleSection
              title={t(
                "settings.sshTerminal.bg.fadingTitle",
                "Edge Fading",
              )}
              icon={<Sparkles className="w-4 h-4 text-purple-400" />}
              defaultOpen={false}
            >
              <div className="space-y-3">
                <Toggle
                  checked={fading.enabled}
                  onChange={(v) =>
                    ubg({ fading: { ...fading, enabled: v } })
                  }
                  label={t(
                    "settings.sshTerminal.bg.fadingEnable",
                    "Enable edge fading",
                  )}
                  description={t(
                    "settings.sshTerminal.bg.fadingEnableDesc",
                    "Gradually fade terminal edges to a transparent/colored border",
                  )}
                />
                {fading.enabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <SelectField
                      value={fading.edge}
                      onChange={(v) =>
                        ubg({
                          fading: {
                            ...fading,
                            edge:
                              v as TerminalBackgroundConfig["fading"]["edge"],
                          },
                        })
                      }
                      label={t(
                        "settings.sshTerminal.bg.fadingEdge",
                        "Edge",
                      )}
                      options={[...FadingEdges].map((e) => ({
                        value: e,
                        label: t(
                          `settings.sshTerminal.bg.fadingEdges.${e}`,
                          e,
                        ),
                      }))}
                    />
                    <NumberField
                      value={fading.size}
                      onChange={(v) =>
                        ubg({ fading: { ...fading, size: v } })
                      }
                      label={t(
                        "settings.sshTerminal.bg.fadingSize",
                        "Fade Size (px)",
                      )}
                      min={5}
                      max={200}
                    />
                    <ColorField
                      value={fading.color || ""}
                      onChange={(v) =>
                        ubg({
                          fading: { ...fading, color: v || undefined },
                        })
                      }
                      label={t(
                        "settings.sshTerminal.bg.fadingColor",
                        "Fade Color",
                      )}
                    />
                  </div>
                )}
              </div>
            </SettingsCollapsibleSection>

            {/* ── Overlay stack ── */}
            <SettingsCollapsibleSection
              title={t(
                "settings.sshTerminal.bg.overlaysTitle",
                "Overlays",
              )}
              icon={<Image className="w-4 h-4 text-teal-400" />}
              defaultOpen={false}
            >
              <OverlayEditor
                overlays={bg.overlays || []}
                onChange={(o) => ubg({ overlays: o })}
                t={t}
              />
            </SettingsCollapsibleSection>
          </>
        )}
      </div>
    </SettingsCollapsibleSection>
  );
};

export default BackgroundSection;
