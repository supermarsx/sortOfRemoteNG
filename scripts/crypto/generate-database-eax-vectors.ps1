# Test-only independent oracle. Download BouncyCastle.Cryptography 2.6.2 from
# https://api.nuget.org/v3-flatcontainer/bouncycastle.cryptography/2.6.2/bouncycastle.cryptography.2.6.2.nupkg
# Extract lib/net6.0/BouncyCastle.Cryptography.dll to an isolated temp directory.
# The script never reads databases, generates real secrets, or writes any files.
param([Parameter(Mandatory = $true)][string]$AssemblyPath)
$ErrorActionPreference = 'Stop'
$expectedHash = 'e5eeaf6d263c493619982fd3638e6135077311d08c961e1fe128f9107d29ebc6'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $AssemblyPath).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'The independent vector oracle DLL does not match the pinned Bouncy Castle 2.6.2 assembly.'
}
[System.Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $AssemblyPath).Path) | Out-Null
$cases = @(
    @{ name = 'empty'; key = [byte[]]::new(32); nonce = [byte[]]::new(16); aad = [byte[]]::new(0); plaintext = [byte[]]::new(0) },
    @{ name = 'aad-only'; key = [byte[]](0..31); nonce = [byte[]](240..255); aad = [byte[]](0..32); plaintext = [byte[]]::new(0) },
    @{ name = 'partial-block'; key = [byte[]](0..31); nonce = [byte[]](16..31); aad = [Text.Encoding]::UTF8.GetBytes('sortOfRemoteNG EAX fixture v1'); plaintext = [Text.Encoding]::UTF8.GetBytes('{"connections":[]}') },
    @{ name = 'multi-block'; key = [byte[]](224..255); nonce = [byte[]](0..15); aad = [byte[]](255..223); plaintext = [byte[]](0..72) }
)
$vectors = foreach ($algorithm in @('twofish-256-eax', 'serpent-256-eax')) {
    foreach ($case in $cases) {
        $engine = if ($algorithm -eq 'twofish-256-eax') { [Org.BouncyCastle.Crypto.Engines.TwofishEngine]::new() } else { [Org.BouncyCastle.Crypto.Engines.SerpentEngine]::new() }
        $cipher = [Org.BouncyCastle.Crypto.Modes.EaxBlockCipher]::new($engine)
        $parameters = [Org.BouncyCastle.Crypto.Parameters.AeadParameters]::new([Org.BouncyCastle.Crypto.Parameters.KeyParameter]::new($case.key), 128, $case.nonce, $case.aad)
        $cipher.Init($true, $parameters)
        $output = [byte[]]::new($cipher.GetOutputSize($case.plaintext.Length))
        $length = $cipher.ProcessBytes($case.plaintext, 0, $case.plaintext.Length, $output, 0)
        $length += $cipher.DoFinal($output, $length)
        if ($length -ne $case.plaintext.Length + 16) { throw 'Unexpected independent EAX output length.' }
        $cipher.Init($false, $parameters)
        $opened = [byte[]]::new($cipher.GetOutputSize($output.Length))
        $openedLength = $cipher.ProcessBytes($output, 0, $output.Length, $opened, 0)
        $openedLength += $cipher.DoFinal($opened, $openedLength)
        if ($openedLength -ne $case.plaintext.Length -or [Convert]::ToHexString($opened) -ne [Convert]::ToHexString($case.plaintext)) { throw 'Independent EAX roundtrip failed.' }
        [ordered]@{
            algorithm = $algorithm; name = $case.name
            keyHex = [Convert]::ToHexString($case.key).ToLowerInvariant()
            nonceHex = [Convert]::ToHexString($case.nonce).ToLowerInvariant()
            aadHex = [Convert]::ToHexString($case.aad).ToLowerInvariant()
            plaintextHex = [Convert]::ToHexString($case.plaintext).ToLowerInvariant()
            ciphertextAndTagHex = [Convert]::ToHexString($output).ToLowerInvariant()
        }
    }
}
[ordered]@{
    source = 'BouncyCastle.Cryptography 2.6.2; net6.0; EaxBlockCipher(TwofishEngine/SerpentEngine); 128-bit tag'
    packageUrl = 'https://api.nuget.org/v3-flatcontainer/bouncycastle.cryptography/2.6.2/bouncycastle.cryptography.2.6.2.nupkg'
    packageSha256 = '623936fb1fd171579c706390390711282898cf2c759a5167852e5ab82208f8cb'
    assemblySha256 = $expectedHash
    vectors = @($vectors)
} | ConvertTo-Json -Depth 8
