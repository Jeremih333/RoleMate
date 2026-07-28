param(
    [string]$BaseUrl = 'https://rolemate-data-api.carreljeremih.workers.dev',
    [string]$EnvFile = '.env.deploy.local'
)

$ErrorActionPreference = 'Stop'
$variables = @{}
Get-Content -LiteralPath $EnvFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        $variables[$matches[1]] = $matches[2]
    }
}
if (-not $variables['INTERNAL_API_SECRET']) {
    throw 'INTERNAL_API_SECRET is missing from the local deployment env file'
}

function Convert-ToHex([byte[]]$Bytes) {
    ([BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
}

function Invoke-SignedOperation([string]$Operation, [hashtable]$PayloadInput) {
    $body = @{ operation = $Operation; input = $PayloadInput } |
        ConvertTo-Json -Compress -Depth 10
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
    $nonce = [guid]::NewGuid().ToString('N')
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bodyHash = Convert-ToHex $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
    $canonical = "POST/v1/execute$timestamp$nonce$bodyHash"
    $hmac = [System.Security.Cryptography.HMACSHA256]::new(
        [Text.Encoding]::UTF8.GetBytes($variables['INTERNAL_API_SECRET'])
    )
    $signature = Convert-ToHex $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))
    Invoke-RestMethod -Uri "$BaseUrl/v1/execute" -Method Post -ContentType 'application/json' `
        -Headers @{
            'X-Service-Id' = 'rolemate-bot-api'
            'X-Request-Timestamp' = $timestamp
            'X-Request-Nonce' = $nonce
            'X-Request-Signature' = $signature
            'X-Request-Id' = [guid]::NewGuid().ToString()
        } -Body $body
}

$products = Invoke-SignedOperation 'products.list' @{ activeOnly = $true }
$runtime = Invoke-SignedOperation 'system.runtime' @{}
$media = Invoke-SignedOperation 'profiles.media.list' @{
    userId = '00000000-0000-4000-8000-000000000001'
}

[pscustomobject]@{
    Ready = $true
    Products = @($products.data).Count
    MaintenanceMode = $runtime.data.maintenanceMode
    ProfileMediaOperation = if ($null -ne $media.data) { 'available' } else { 'missing' }
} | ConvertTo-Json -Compress
