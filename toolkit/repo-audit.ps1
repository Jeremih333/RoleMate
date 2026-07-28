$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Output "root=$root"
Write-Output "powershell=$($PSVersionTable.PSVersion)"

foreach ($tool in @('git', 'node', 'corepack', 'pnpm', 'docker')) {
    $command = Get-Command $tool -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        Write-Output "$tool=missing"
        continue
    }

    $version = switch ($tool) {
        'git' { & git --version }
        'node' { & node --version }
        'corepack' { & corepack --version }
        'pnpm' { & pnpm --version }
        'docker' { & docker --version }
    }
    Write-Output "$tool=$version"
}

Push-Location $root
try {
    if (Test-Path -LiteralPath '.git') {
        Write-Output 'git-status:'
        & git status --short
    } else {
        Write-Output 'git-status=not-a-repository'
    }

    Write-Output 'top-level:'
    Get-ChildItem -Force |
        Sort-Object Name |
        ForEach-Object {
            $kind = if ($_.PSIsContainer) { 'dir' } else { 'file' }
            Write-Output "$kind`t$($_.Name)"
        }
} finally {
    Pop-Location
}

