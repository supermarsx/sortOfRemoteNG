import React from "react";
import {
  Image as ImageIcon,
  Layers,
  Sparkles,
  Palette,
  Droplet,
  Compass,
  Link as LinkIcon,
  Eye,
  Focus,
  Maximize2,
  Move,
  Wand2,
  Gauge,
  CircleDot,
  Frame,
  Ruler,
  X,
  Plus,
  Blend,
  Sliders,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsSliderRow,
  SettingsNumberRow,
  SettingsTextRow,
  SettingsColorRow,
} from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";
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
} from "../../../../types/ssh/sshSettings";
import { SettingsSubGroupHeader as SubGroupHeader } from "../../../ui/settings/NetworkPrimitives";

/* ── Gradient stop editor (specialized array UI) ───────────────── */

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
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <span className="sor-settings-row-label flex items-center gap-1">
          <span className="text-[var(--color-textSecondary)] mr-1">
            <Sliders size={16} />
          </span>
          {t("settings.sshTerminal.bg.gradientStops", "Gradient stops")}
          <InfoTooltip text="Define color stops along the gradient. Each stop has a color and a position percentage." />
        </span>
        <button
          onClick={() =>
            onChange([...stops, { color: "#3b82f6", position: 50 }])
          }
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Plus size={12} />
          {t("settings.sshTerminal.bg.addStop", "Add stop")}
        </button>
      </div>
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
            className="w-10 h-8 p-0 border border-[var(--color-border)] rounded cursor-pointer bg-transparent"
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
            className="flex-1 sor-settings-range"
          />
          <span className="text-xs text-[var(--color-textSecondary)] w-10 text-right tabular-nums">
            {stop.position}%
          </span>
          {stops.length > 2 && (
            <button
              onClick={() => onChange(stops.filter((_, j) => j !== i))}
              className="text-error hover:text-error/80 text-xs p-1"
              aria-label="Remove stop"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Overlay editor (specialized array UI) ─────────────────────── */

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
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-end">
        <button
          onClick={addOverlay}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Plus size={12} />
          {t("settings.sshTerminal.bg.addOverlay", "Add overlay")}
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
          className="border border-[var(--color-border)]/60 rounded-lg p-2 space-y-1"
        >
          <div className="flex items-center justify-between px-1">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={ov.enabled}
                onChange={(e) =>
                  updateOverlay(i, { enabled: e.target.checked })
                }
                className="sor-settings-checkbox"
              />
              {t(
                `settings.sshTerminal.bg.overlayType.${ov.type}`,
                ov.type.charAt(0).toUpperCase() + ov.type.slice(1),
              )}
            </label>
            <button
              onClick={() => removeOverlay(i)}
              className="text-error hover:text-error/80 text-xs p-1"
              aria-label="Remove overlay"
            >
              <X size={14} />
            </button>
          </div>

          <div
            className={`flex flex-col gap-2.5 ${
              ov.enabled ? "" : "opacity-50 pointer-events-none"
            }`}
          >
            <SettingsSelectRow
              icon={<Wand2 size={16} />}
              label={t("settings.sshTerminal.bg.type", "Type")}
              value={ov.type}
              onChange={(v) =>
                updateOverlay(i, { type: v as TerminalOverlay["type"] })
              }
              options={OVERLAY_TYPES.map((tt) => ({
                value: tt,
                label: tt.charAt(0).toUpperCase() + tt.slice(1),
              }))}
              infoTooltip="The visual effect type for this overlay layer."
            />
            <SettingsSliderRow
              icon={<Eye size={16} />}
              label={t("settings.sshTerminal.bg.opacity", "Opacity")}
              value={ov.opacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => updateOverlay(i, { opacity: v })}
              infoTooltip="How transparent this overlay is. 0 is fully transparent, 1 is fully opaque."
            />
            <SettingsSelectRow
              icon={<Blend size={16} />}
              label={t("settings.sshTerminal.bg.blendMode", "Blend mode")}
              value={ov.blendMode}
              onChange={(v) =>
                updateOverlay(i, {
                  blendMode: v as TerminalOverlay["blendMode"],
                })
              }
              options={[...OverlayBlendModes].map((m) => ({
                value: m,
                label: m,
              }))}
              infoTooltip="CSS blend mode that controls how this overlay composites with layers beneath it."
            />
            {(ov.type === "color" || ov.type === "gradient") && (
              <SettingsColorRow
                icon={<Palette size={16} />}
                label={t("settings.sshTerminal.bg.color", "Color")}
                value={ov.color || "#000000"}
                onChange={(v) => updateOverlay(i, { color: v })}
                infoTooltip="Base color used for this overlay effect."
              />
            )}
            {(ov.type === "scanlines" ||
              ov.type === "noise" ||
              ov.type === "crt" ||
              ov.type === "grid") && (
              <SettingsSliderRow
                icon={<Gauge size={16} />}
                label={t("settings.sshTerminal.bg.intensity", "Intensity")}
                value={ov.intensity ?? 1}
                min={0.1}
                max={3}
                step={0.1}
                onChange={(v) => updateOverlay(i, { intensity: v })}
                infoTooltip="Strength of the visual effect. Higher values produce a more pronounced appearance."
              />
            )}
          </div>
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
    <div className="space-y-4">
      <SectionHeader
        icon={<Layers className="w-4 h-4 text-primary" />}
        title={t(
          "settings.sshTerminal.bg.title",
          "Backgrounds, Fading & Overlays",
        )}
      />
      <Card>
        <Toggle
          checked={bg.enabled}
          onChange={(v) => ubg({ enabled: v })}
          icon={<Layers size={16} />}
          label={t(
            "settings.sshTerminal.bg.enable",
            "Enable custom background",
          )}
          description={t(
            "settings.sshTerminal.bg.enableDesc",
            "Render backgrounds, fading edges, and overlay effects behind the terminal",
          )}
          infoTooltip="Render custom backgrounds, fading edges, and overlay effects behind the terminal content."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            bg.enabled ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <SettingsSelectRow
            settingKey="bgType"
            icon={<Frame size={16} />}
            label={t("settings.sshTerminal.bg.bgType", "Background type")}
            value={bg.type}
            onChange={(v) =>
              ubg({ type: v as TerminalBackgroundConfig["type"] })
            }
            options={[...TerminalBackgroundTypes].map((bt) => ({
              value: bt,
              label: t(
                `settings.sshTerminal.bg.bgTypes.${bt}`,
                bt.charAt(0).toUpperCase() + bt.slice(1),
              ),
            }))}
            infoTooltip="Choose the kind of background: a solid color, a gradient, a static image, or an animated effect."
          />

          <SettingsSliderRow
            settingKey="bgOpacity"
            icon={<Eye size={16} />}
            label={t("settings.sshTerminal.bg.bgOpacity", "Background opacity")}
            value={bg.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => ubg({ opacity: v })}
            infoTooltip="Overall opacity of the background layer. Lower values make the background more transparent."
          />

          {/* ── Solid ── */}
          {bg.type === "solid" && (
            <SettingsColorRow
              settingKey="bgSolidColor"
              icon={<Droplet size={16} />}
              label={t("settings.sshTerminal.bg.solidColor", "Solid color")}
              value={bg.solidColor || "#0b1120"}
              onChange={(v) => ubg({ solidColor: v })}
              infoTooltip="The single fill color used for the terminal background."
            />
          )}

          {/* ── Gradient ── */}
          {bg.type === "gradient" && (
            <>
              <SettingsSelectRow
                settingKey="bgGradientDirection"
                icon={<Compass size={16} />}
                label={t("settings.sshTerminal.bg.direction", "Direction")}
                value={bg.gradientDirection || "to-bottom"}
                onChange={(v) =>
                  ubg({
                    gradientDirection:
                      v as TerminalBackgroundConfig["gradientDirection"],
                  })
                }
                options={[...GradientDirections].map((d) => ({
                  value: d,
                  label: t(`settings.sshTerminal.bg.dirs.${d}`, d),
                }))}
                infoTooltip="The direction in which the gradient transitions between color stops."
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
            </>
          )}

          {/* ── Image ── */}
          {bg.type === "image" && (
            <>
              <SettingsTextRow
                settingKey="bgImagePath"
                icon={<LinkIcon size={16} />}
                label={t("settings.sshTerminal.bg.imagePath", "Image path / URL")}
                value={bg.imagePath || ""}
                onChange={(v) => ubg({ imagePath: v })}
                placeholder="https://… or /path/to/image.png"
                infoTooltip="Local file path or remote URL pointing to the background image."
              />
              <SettingsSliderRow
                settingKey="bgImageOpacity"
                icon={<Eye size={16} />}
                label={t("settings.sshTerminal.bg.imageOpacity", "Image opacity")}
                value={bg.imageOpacity ?? 0.15}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => ubg({ imageOpacity: v })}
                infoTooltip="Opacity of the background image. Lower values make the image more transparent."
              />
              <SettingsNumberRow
                settingKey="bgImageBlur"
                icon={<Focus size={16} />}
                label={t("settings.sshTerminal.bg.imageBlur", "Blur")}
                value={bg.imageBlur ?? 0}
                min={0}
                max={50}
                unit="px"
                onChange={(v) => ubg({ imageBlur: v })}
                infoTooltip="Gaussian blur radius in pixels applied to the background image."
              />
              <SettingsSelectRow
                settingKey="bgImageSize"
                icon={<Maximize2 size={16} />}
                label={t("settings.sshTerminal.bg.imageSize", "Size mode")}
                value={bg.imageSize || "cover"}
                onChange={(v) =>
                  ubg({
                    imageSize: v as TerminalBackgroundConfig["imageSize"],
                  })
                }
                options={[
                  { value: "cover", label: "Cover" },
                  { value: "contain", label: "Contain" },
                  { value: "fill", label: "Fill" },
                  { value: "tile", label: "Tile" },
                ]}
                infoTooltip="How the image is scaled to fit the terminal area. Cover fills the area; contain fits inside it."
              />
              <SettingsTextRow
                settingKey="bgImagePosition"
                icon={<Move size={16} />}
                label={t("settings.sshTerminal.bg.imagePosition", "Position")}
                value={bg.imagePosition || "center center"}
                onChange={(v) => ubg({ imagePosition: v })}
                placeholder="center center"
                infoTooltip="CSS background-position value controlling where the image is anchored within the terminal."
              />
            </>
          )}

          {/* ── Animated ── */}
          {bg.type === "animated" && (
            <>
              <SettingsSelectRow
                settingKey="bgAnimatedEffect"
                icon={<Wand2 size={16} />}
                label={t("settings.sshTerminal.bg.effect", "Effect")}
                value={bg.animatedEffect || "matrix-rain"}
                onChange={(v) =>
                  ubg({
                    animatedEffect:
                      v as TerminalBackgroundConfig["animatedEffect"],
                  })
                }
                options={[...AnimatedBackgroundEffects].map((e) => ({
                  value: e,
                  label: t(
                    `settings.sshTerminal.bg.effects.${e}`,
                    e
                      .split("-")
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(" "),
                  ),
                }))}
                infoTooltip="The animated visual effect rendered behind the terminal content."
              />
              <SettingsSliderRow
                settingKey="bgAnimSpeed"
                icon={<Gauge size={16} />}
                label={t("settings.sshTerminal.bg.speed", "Speed")}
                value={bg.animationSpeed ?? 1}
                min={0.1}
                max={3}
                step={0.1}
                unit="×"
                onChange={(v) => ubg({ animationSpeed: v })}
                infoTooltip="Playback speed multiplier for the animation. Higher values make the effect faster."
              />
              <SettingsSliderRow
                settingKey="bgAnimDensity"
                icon={<CircleDot size={16} />}
                label={t("settings.sshTerminal.bg.density", "Density")}
                value={bg.animationDensity ?? 1}
                min={0.1}
                max={3}
                step={0.1}
                unit="×"
                onChange={(v) => ubg({ animationDensity: v })}
                infoTooltip="Density of animated elements on screen. Higher values produce a more populated effect."
              />
              <SettingsColorRow
                settingKey="bgAnimColor"
                icon={<Palette size={16} />}
                label={t("settings.sshTerminal.bg.animColor", "Color")}
                value={bg.animationColor || "#00ff41"}
                onChange={(v) => ubg({ animationColor: v })}
                infoTooltip="Primary color used by the animated background effect."
              />
            </>
          )}

          {/* ── Fading ── */}
          <SubGroupHeader
            icon={<Sparkles size={11} />}
            label={t("settings.sshTerminal.bg.fadingTitle", "Edge fading")}
          />
          <Toggle
            checked={fading.enabled}
            onChange={(v) => ubg({ fading: { ...fading, enabled: v } })}
            icon={<Sparkles size={16} />}
            label={t(
              "settings.sshTerminal.bg.fadingEnable",
              "Enable edge fading",
            )}
            description={t(
              "settings.sshTerminal.bg.fadingEnableDesc",
              "Gradually fade terminal edges to a transparent/colored border",
            )}
            infoTooltip="Gradually fade terminal edges to a transparent or colored border for a softer visual appearance."
          />
          <div
            className={`flex flex-col gap-2.5 ${
              fading.enabled ? "" : "opacity-50 pointer-events-none"
            }`}
          >
            <SettingsSelectRow
              settingKey="bgFadingEdge"
              icon={<Frame size={16} />}
              label={t("settings.sshTerminal.bg.fadingEdge", "Edge")}
              value={fading.edge}
              onChange={(v) =>
                ubg({
                  fading: {
                    ...fading,
                    edge: v as TerminalBackgroundConfig["fading"]["edge"],
                  },
                })
              }
              options={[...FadingEdges].map((e) => ({
                value: e,
                label: t(`settings.sshTerminal.bg.fadingEdges.${e}`, e),
              }))}
              infoTooltip="Which edges of the terminal to apply the fading effect to."
            />
            <SettingsNumberRow
              settingKey="bgFadingSize"
              icon={<Ruler size={16} />}
              label={t("settings.sshTerminal.bg.fadingSize", "Fade size")}
              value={fading.size}
              min={5}
              max={200}
              unit="px"
              onChange={(v) => ubg({ fading: { ...fading, size: v } })}
              infoTooltip="Width of the fading region in pixels from the terminal edge inward."
            />
            <SettingsColorRow
              settingKey="bgFadingColor"
              icon={<Droplet size={16} />}
              label={t("settings.sshTerminal.bg.fadingColor", "Fade color")}
              value={fading.color || ""}
              onChange={(v) =>
                ubg({ fading: { ...fading, color: v || undefined } })
              }
              chipLabel={fading.color || "(transparent)"}
              infoTooltip="The color the terminal edges fade into. Leave empty for transparent."
            />
          </div>

          {/* ── Overlay stack ── */}
          <SubGroupHeader
            icon={<ImageIcon size={11} />}
            label={t("settings.sshTerminal.bg.overlaysTitle", "Overlays")}
          />
          <OverlayEditor
            overlays={bg.overlays || []}
            onChange={(o) => ubg({ overlays: o })}
            t={t}
          />
        </div>
      </Card>
    </div>
  );
};

export default BackgroundSection;
