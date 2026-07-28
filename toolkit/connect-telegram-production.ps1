param(
    [string]$EnvironmentFile = '.env.deploy.local',
    [string]$PublicBaseUrl = 'https://rolemate-app.carreljeremih.workers.dev'
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$environmentPath = Join-Path $workspace $EnvironmentFile
$botApiDirectory = Join-Path $workspace 'apps\bot-api'
$wrangler = Join-Path $botApiDirectory 'node_modules\.bin\wrangler.CMD'
if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw "Missing ignored deployment environment file: $environmentPath"
}

$prefix = 'TELEGRAM_WEBHOOK_SECRET='
$secretLine = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
    Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) } |
    Select-Object -Last 1
if (-not $secretLine) {
    throw "Missing TELEGRAM_WEBHOOK_SECRET in $environmentPath"
}
$webhookSecret = $secretLine.Substring($prefix.Length)

Write-Host 'RoleMate Telegram production connection' -ForegroundColor Cyan
Write-Host 'Paste the Telegram bot token. It will stay hidden and will not be written to a file.'
$secureToken = Read-Host 'TELEGRAM_BOT_TOKEN' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($token -notmatch '^\d+:[A-Za-z0-9_-]{20,}$') {
        throw 'Telegram bot token has an unexpected format.'
    }
    $env:TELEGRAM_BOT_TOKEN = $token
    $env:TELEGRAM_WEBHOOK_SECRET = $webhookSecret
    $env:PUBLIC_BASE_URL = $PublicBaseUrl
    $env:MINI_APP_URL = $PublicBaseUrl

    $previousCloudflareToken = $env:CLOUDFLARE_API_TOKEN
    try {
        $env:CLOUDFLARE_API_TOKEN = $null
        Set-Location -LiteralPath $botApiDirectory
        $token | & $wrangler secret put TELEGRAM_BOT_TOKEN
        if ($LASTEXITCODE -ne 0) {
            throw 'Cloudflare bot token update failed.'
        }
    } finally {
        $env:CLOUDFLARE_API_TOKEN = $previousCloudflareToken
    }

    Set-Location -LiteralPath $workspace
    & corepack.cmd pnpm tsx scripts/setup-telegram.ts
    if ($LASTEXITCODE -ne 0) {
        throw 'Telegram setup failed.'
    }
    & corepack.cmd pnpm tsx scripts/check-webhook.ts
    if ($LASTEXITCODE -ne 0) {
        throw 'Telegram webhook check failed.'
    }
    Write-Host 'Telegram webhook and Mini App menu are connected.' -ForegroundColor Green
} finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $token = $null
    $env:TELEGRAM_BOT_TOKEN = $null
    $env:TELEGRAM_WEBHOOK_SECRET = $null
}

Read-Host 'Press Enter to finish'
