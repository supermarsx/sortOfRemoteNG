// Once-per-browser graphics preflight before CEF starts its GPU process.
// Inventory first; validate a WARP device only on software-only systems.
#include <dxgi1_2.h>
#include <d3d11.h>

namespace {
constexpr bool software_adapter(UINT vendor, UINT device, UINT flags) {
  return (flags & DXGI_ADAPTER_FLAG_SOFTWARE) ||
         (vendor == 0x1414 && device == 0x008c);
}
// Basic Render Driver can lack the software flag. Do not classify actual
// Microsoft RemoteFX/Xbox, Intel, AMD or NVIDIA adapters by vendor alone.
static_assert(software_adapter(0x1414, 0x008c, 0));
static_assert(software_adapter(0x1414, 0x008c, DXGI_ADAPTER_FLAG_SOFTWARE));
static_assert(software_adapter(0, 0, DXGI_ADAPTER_FLAG_SOFTWARE));
static_assert(!software_adapter(0x1414, 0x02c1, 0));
static_assert(!software_adapter(0x1414, 0xd000, 0));
static_assert(!software_adapter(0x8086, 0x1234, 0));
static_assert(!software_adapter(0x10de, 0x1234, 0));
}

// 0=unknown, 1=hardware present, 2=software WARP ready, 3=WARP unavailable.
extern "C" unsigned sorng_cef_graphics_adapters() noexcept {
  IDXGIFactory1* factory = nullptr;
  if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1),
                               reinterpret_cast<void**>(&factory)))) return 0;
  bool saw_software = false;
  unsigned result = 0;
  // Enumeration is bounded even if a driver violates the normal termination.
  for (UINT index = 0; index < 32; ++index) {
    IDXGIAdapter1* adapter = nullptr;
    HRESULT hr = factory->EnumAdapters1(index, &adapter);
    if (hr == DXGI_ERROR_NOT_FOUND) {
      result = saw_software ? 2 : 0;
      break;
    }
    if (FAILED(hr)) break;
    DXGI_ADAPTER_DESC1 desc{};
    hr = adapter->GetDesc1(&desc);
    adapter->Release();
    if (FAILED(hr)) break;
    // The primary Microsoft Basic Render Driver may expose display outputs
    // WITHOUT the software flag. Chromium identifies WARP by this exact ID
    // too (gpu/config/gpu_info.cc::GPUDevice::IsSoftwareRenderer).
    if (!software_adapter(desc.VendorId, desc.DeviceId, desc.Flags)) {
      result = 1;
      break;
    }
    saw_software = true;
  }
  factory->Release();
  if (result == 2) {
    ID3D11Device* device = nullptr;
    const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    D3D_FEATURE_LEVEL level{};
    const HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION,
        &device, &level, nullptr);
    if (device) device->Release();
    if (FAILED(hr) || level < D3D_FEATURE_LEVEL_11_0) result = 3;
  }
  return result;
}
