/** Network presets only change visuals; optional FPS limits are independent. */
export const RDP_VISUAL_PRESETS: Record<
  string,
  {
    disableWallpaper: boolean;
    disableFullWindowDrag: boolean;
    disableMenuAnimations: boolean;
    disableTheming: boolean;
    disableCursorShadow: boolean;
    enableFontSmoothing: boolean;
    enableDesktopComposition: boolean;
  }
> = {
  modem: {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: true,
    disableCursorShadow: true,
    enableFontSmoothing: false,
    enableDesktopComposition: false,
  },
  "broadband-low": {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
  },
  "broadband-high": {
    disableWallpaper: true,
    disableFullWindowDrag: true,
    disableMenuAnimations: true,
    disableTheming: false,
    disableCursorShadow: true,
    enableFontSmoothing: true,
    enableDesktopComposition: false,
  },
  wan: {
    disableWallpaper: false,
    disableFullWindowDrag: false,
    disableMenuAnimations: false,
    disableTheming: false,
    disableCursorShadow: false,
    enableFontSmoothing: true,
    enableDesktopComposition: true,
  },
  lan: {
    disableWallpaper: false,
    disableFullWindowDrag: false,
    disableMenuAnimations: false,
    disableTheming: false,
    disableCursorShadow: false,
    enableFontSmoothing: true,
    enableDesktopComposition: true,
  },
};
