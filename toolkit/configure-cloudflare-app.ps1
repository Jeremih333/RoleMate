param(
    [string]$EnvironmentFile = '.env.deploy.local'
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$botApiDirectory = Join-Path $workspace 'apps\bot-api'
$wrangler = Join-Path $botApiDirectory 'node_modules\.bin\wrangler.CMD'
$environmentPath = Join-Path $workspace $EnvironmentFile

if (-not (Test-Path -LiteralPath $wrangler)) {
    throw 'Wrangler is not installed. Run corepack pnpm install first.'
}
if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw "Missing ignored deployment environment file: $environmentPath"
}

function Read-EnvironmentValue {
    param([string]$Name)

    $prefix = "$Name="
    $line = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
        Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) } |
        Select-Object -Last 1
    if (-not $line) {
        throw "Missing $Name in $environmentPath"
    }
    $value = $line.Substring($prefix.Length)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Empty $Name in $environmentPath"
    }
    return $value
}

function Set-WorkerSecret {
    param(
        [string]$Name,
        [string]$Value
    )

    $previousToken = $env:CLOUDFLARE_API_TOKEN
    try {
        $env:CLOUDFLARE_API_TOKEN = $null
        $Value | & $wrangler secret put $Name
        if ($LASTEXITCODE -ne 0) {
            throw "Wrangler failed while setting $Name"
        }
        Write-Host "Configured $Name" -ForegroundColor Green
    } finally {
        $env:CLOUDFLARE_API_TOKEN = $previousToken
    }
}

Set-Location -LiteralPath $botApiDirectory
Write-Host 'RoleMate Cloudflare App Worker' -ForegroundColor Cyan
Write-Host 'Paste the Telegram bot token. It will stay hidden and will not be written to a file.'
$secureToken = Read-Host 'TELEGRAM_BOT_TOKEN' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $botToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($botToken -notmatch '^\d+:[A-Za-z0-9_-]{20,}$') {
        throw 'Telegram bot token has an unexpected format.'
    }
    Set-WorkerSecret -Name 'TELEGRAM_BOT_TOKEN' -Value $botToken
} finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $botToken = $null
}

foreach ($secretName in @(
    'TELEGRAM_WEBHOOK_SECRET',
    'INTERNAL_API_SECRET',
    'SESSION_SECRET'
)) {
    Set-WorkerSecret -Name $secretName -Value (Read-EnvironmentValue -Name $secretName)
}

Write-Host 'All App Worker secrets are configured.' -ForegroundColor Green
Read-Host 'Press Enter to finish'
