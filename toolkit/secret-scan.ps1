$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$excluded = @(
    '.git',
    'node_modules',
    '.turbo',
    'dist',
    'coverage',
    'playwright-report',
    'test-results'
)
$patterns = @(
    '(?i)-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    '(?i)(bot_token|telegram_bot_token|api[_-]?key|client_secret|private_key)\s*[:=]\s*[''"][^''"]{8,}[''"]',
    '\b\d{8,10}:[A-Za-z0-9_-]{30,}\b'
)

function Get-RelativePath {
    param([string] $FullName)
    return $FullName.Substring($root.TrimEnd('\').Length).TrimStart('\')
}

$findings = New-Object System.Collections.Generic.List[string]
Get-ChildItem -LiteralPath $root -Recurse -File -Force |
    Where-Object {
        $relative = Get-RelativePath $_.FullName
        $parts = $relative -split '[\\/]'
        $isRuntimeEnv = $_.Name -like '.env*' -and $_.Name -ne '.env.example'
        -not $isRuntimeEnv -and -not ($parts | Where-Object { $excluded -contains $_ })
    } |
    ForEach-Object {
        $relative = Get-RelativePath $_.FullName
        $lineNumber = 0
        foreach ($line in [System.IO.File]::ReadLines($_.FullName)) {
            $lineNumber++
            foreach ($pattern in $patterns) {
                if ($line -match $pattern) {
                    $findings.Add("${relative}:${lineNumber}")
                    break
                }
            }
        }
    }

if ($findings.Count -gt 0) {
    Write-Error ("Possible secrets found at:`n" + ($findings -join "`n"))
    exit 1
}

Write-Output 'Secret scan passed.'
