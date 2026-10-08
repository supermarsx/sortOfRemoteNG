param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Destination)
if (-not $root.StartsWith([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.artifacts/')), [StringComparison]::OrdinalIgnoreCase)) { throw 'Scratch must be under repository .artifacts' }
if (Test-Path -LiteralPath $root) { throw 'Use a new scratch directory' }
New-Item -ItemType Directory -Path $root | Out-Null
$sources = @{
  chromium = @('net/BUILD.gn','net/cert/cert_verify_proc.h','net/cert/cert_verify_proc_builtin.cc','net/cert/internal/system_trust_store.h','services/cert_verifier/cert_verifier_service_factory.cc','services/cert_verifier/cert_verifier_service.cc','services/cert_verifier/cert_verifier_creation.cc','services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom','net/socket/ssl_client_socket_impl.cc','net/socket/ssl_client_socket_impl.h','net/socket/ssl_client_socket.cc','net/socket/ssl_client_socket.h','net/http/http_network_session.cc','net/http/http_network_session.h','services/network/network_context.cc','services/network/network_context.h','services/network/public/mojom/network_context.mojom','services/network/public/mojom/BUILD.gn','net/socket/ssl_client_socket_unittest.cc');
  cef = @('libcef/browser/request_context_impl.cc','libcef/browser/request_context_impl.h','libcef/browser/browser_context.cc','libcef/browser/browser_context.h','libcef/browser/chrome/chrome_browser_context.cc','libcef/browser/chrome/chrome_content_browser_client_cef.cc','libcef/browser/chrome/chrome_content_browser_client_cef.h','BUILD.gn','cef_paths2.gypi','libcef/browser/context.h','libcef/browser/context.cc','libcef_dll/libcef.lst')
}
foreach ($project in @($sources.Keys)) {
  if ($project -eq 'cef') {
    $sources[$project] += 'libcef/browser/native/native_widget_delegate.cc'
    $sources[$project] += 'libcef/browser/download_manager_delegate_impl.cc'
  } elseif ($project -eq 'chromium') {
    $sources[$project] += @(
      'components/soda/soda_features.h',
      'components/soda/soda_features.cc',
      'components/soda/soda_installer.cc',
      'components/soda/soda_util.cc',
      'chrome/browser/accessibility/soda_installer_impl.cc',
      'net/dns/host_resolver_manager.cc',
      'net/dns/host_resolver_manager_unittest.cc'
    )
  }
  $revision = if ($project -eq 'cef') { '682c378d70d5780061e96644dca16ddd8fd157a9' } else { '154.0.8037.58' }
  $repository = if ($project -eq 'cef') { 'chromiumembedded/cef' } else { 'chromium/chromium' }
  foreach ($relative in $sources[$project]) {
    $path = Join-Path $root "$project/$relative"
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    Invoke-WebRequest "https://raw.githubusercontent.com/$repository/$revision/$relative" -OutFile $path
  }
}
Write-Output $root
