$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SorngRdKafkaProbe
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr LoadLibraryEx(
        string fileName,
        IntPtr file,
        uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool FreeLibrary(IntPtr module);

    [DllImport("rdkafka.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr rd_kafka_conf_new();

    [DllImport("rdkafka.dll", CallingConvention = CallingConvention.Cdecl)]
    public static extern void rd_kafka_conf_destroy(IntPtr conf);

    [DllImport("rdkafka.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int rd_kafka_conf_get(
        IntPtr conf,
        string name,
        StringBuilder destination,
        ref UIntPtr destinationSize);

    [DllImport("rdkafka.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int rd_kafka_conf_set(
        IntPtr conf,
        string name,
        string value,
        StringBuilder error,
        UIntPtr errorSize);
}
'@

$dllPath = [IO.Path]::GetFullPath($env:SORNG_RDKAFKA_DLL)
if (-not [IO.File]::Exists($dllPath)) {
    throw "staged rdkafka DLL does not exist: $dllPath"
}

# Pin this exact staged image before the basename P/Invoke methods bind. The
# flags resolve its dependent DLLs from the same staged directory and trusted
# system locations rather than a caller-controlled working directory.
$module = [SorngRdKafkaProbe]::LoadLibraryEx($dllPath, [IntPtr]::Zero, 0x1100)
if ($module -eq [IntPtr]::Zero) {
    $loadError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "failed to load staged rdkafka DLL $dllPath (Win32 error $loadError)"
}

$configuration = [SorngRdKafkaProbe]::rd_kafka_conf_new()
if ($configuration -eq [IntPtr]::Zero) {
    [SorngRdKafkaProbe]::FreeLibrary($module) | Out-Null
    throw "rd_kafka_conf_new returned null"
}

try {
    $buffer = [Text.StringBuilder]::new(4096)
    $bufferSize = [UIntPtr]::new([uint64]4096)
    $result = [SorngRdKafkaProbe]::rd_kafka_conf_get(
        $configuration,
        "builtin.features",
        $buffer,
        [ref]$bufferSize)
    if ($result -ne 0) {
        throw "rd_kafka_conf_get(builtin.features) failed with status $result"
    }

    $features = @($buffer.ToString().Split(",", [StringSplitOptions]::RemoveEmptyEntries))
    $requiredFeatures = @(
        "gzip",
        "snappy",
        "ssl",
        "sasl",
        "lz4",
        "sasl_gssapi",
        "sasl_plain",
        "sasl_scram",
        "zstd",
        "sasl_oauthbearer"
    )
    $missingFeatures = @($requiredFeatures | Where-Object { $_ -notin $features })
    if ($missingFeatures.Count -ne 0) {
        throw "librdkafka is missing required features: $($missingFeatures -join ', ')"
    }

    foreach ($codec in @("gzip", "snappy", "lz4", "zstd")) {
        $errorBuffer = [Text.StringBuilder]::new(512)
        $setResult = [SorngRdKafkaProbe]::rd_kafka_conf_set(
            $configuration,
            "compression.codec",
            $codec,
            $errorBuffer,
            [UIntPtr]::new([uint64]$errorBuffer.Capacity))
        if ($setResult -ne 0) {
            throw "librdkafka rejected compression codec ${codec}: $errorBuffer"
        }
    }

    Write-Output "[windows-native-runtime] librdkafka builtin.features=$($features -join ',')"
}
finally {
    [SorngRdKafkaProbe]::rd_kafka_conf_destroy($configuration)
    [SorngRdKafkaProbe]::FreeLibrary($module) | Out-Null
}
