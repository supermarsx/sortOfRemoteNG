# Native browser graphics startup

On Windows, the CEF browser process inventories DXGI adapters once before
initializing graphics. If every adapter is software, it validates a WARP D3D11
device once at feature level 11.0 or newer and selects Chromium
154's `use-gl=angle` and `use-angle=d3d11-warp-webgl` path directly. This keeps
software Canvas2D and WebGL available without cycling through the hardware
blocklist path. A hardware adapter, enumeration failure, or an incomplete
inventory keeps Chromium's automatic selection. macOS and Linux are unchanged.

Microsoft Basic Render Driver (`1414:008c`) counts as software even when its
DXGI descriptor lacks `DXGI_ADAPTER_FLAG_SOFTWARE`. This occurs when it is the
primary display adapter. Microsoft RemoteFX and Xbox adapters are not treated
as Basic Render Driver just because they share Microsoft's vendor ID.

The selection changes neither proxy routing nor sandbox policy. It does not
enable unsafe SwiftShader or ignore Chromium's hardware GPU blocklist. The
startup log records the adapter class, selected software policy, and numeric
preflight duration; it does not record adapter names or identifiers. A failed
WARP device check is reported at startup and keeps automatic selection.

Restart the native application to apply a selection change; reconnecting a tab
reuses the existing process-wide graphics configuration. A successful adapter
or D3D11 probe does not establish the time to display a live remote desktop.
