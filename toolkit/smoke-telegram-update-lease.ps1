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

$updateId = 9000000000
$firstToken = [guid]::NewGuid().ToString()
$secondToken = [guid]::NewGuid().ToString()

try {
    $first = Invoke-SignedOperation 'telegramUpdates.claim' @{
        updateId = $updateId
        claimToken = $firstToken
    }
    $concurrent = Invoke-SignedOperation 'telegramUpdates.claim' @{
        updateId = $updateId
        claimToken = $secondToken
    }
    $released = Invoke-SignedOperation 'telegramUpdates.release' @{
        updateId = $updateId
        claimToken = $firstToken
    }
    $retried = Invoke-SignedOperation 'telegramUpdates.claim' @{
        updateId = $updateId
        claimToken = $secondToken
    }

    if (
        -not $first.data.claimed -or
        $concurrent.data.claimed -or
        $concurrent.data.state -ne 'processing' -or
        -not $released.data.released -or
        -not $retried.data.claimed
    ) {
        throw 'Telegram update lease smoke check returned an unexpected state'
    }

    [pscustomobject]@{
        claimed = $first.data.claimed
        concurrentState = $concurrent.data.state
        released = $released.data.released
        retryClaimed = $retried.data.claimed
    } | ConvertTo-Json -Compress
} finally {
    Invoke-SignedOperation 'telegramUpdates.release' @{
        updateId = $updateId
        claimToken = $secondToken
    } | Out-Null
}
