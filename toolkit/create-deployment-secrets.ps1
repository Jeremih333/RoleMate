param(
    [string] $OutputPath = '.env.deploy.local'
)

$ErrorActionPreference = 'Stop'

function New-Secret([int] $Bytes = 32) {
    $buffer = [byte[]]::new($Bytes)
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($buffer)
    }
    finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$workspace = [System.IO.Path]::GetFullPath((Get-Location).Path)
if (-not $resolvedOutput.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Output must stay inside the workspace.'
}

$content = @(
    "INTERNAL_API_SECRET=$(New-Secret)"
    "SESSION_SECRET=$(New-Secret)"
    "TELEGRAM_WEBHOOK_SECRET=$(New-Secret 24)"
) -join [Environment]::NewLine

[System.IO.File]::WriteAllText(
    $resolvedOutput,
    $content + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Created ignored deployment secret bundle: $resolvedOutput"
