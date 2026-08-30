param(
    [switch] $IncludeE2E,
    [switch] $IncludeAudit
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Step {
    param(
        [string] $Name,
        [scriptblock] $Command
    )

    Write-Output "== $Name =="
    & $Command
    $stepExitCode = $LASTEXITCODE
    if ($null -ne $stepExitCode -and $stepExitCode -ne 0) {
        throw "$Name failed with exit code $stepExitCode"
    }
}

Push-Location $root
try {
    Invoke-Step 'secret scan' { & "$PSScriptRoot\secret-scan.ps1" }

    if (-not (Test-Path -LiteralPath 'package.json')) {
        Write-Output 'No package.json yet; project checks skipped.'
        exit 0
    }

    Invoke-Step 'format check' { & corepack pnpm format:check }
    Invoke-Step 'prepare workspace packages' {
        & corepack pnpm --filter '@rolemate/shared' --filter '@rolemate/database-contracts' build
    }
    Invoke-Step 'lint' { & corepack pnpm lint }
    Invoke-Step 'typecheck' { & corepack pnpm typecheck }
    Invoke-Step 'unit and integration tests' { & corepack pnpm test }
    Invoke-Step 'production build' { & corepack pnpm build }

    if ($IncludeAudit) {
        Invoke-Step 'dependency audit' { & corepack pnpm audit --prod }
    }
    if ($IncludeE2E) {
        # Serial execution avoids intermittent Playwright artifact-directory races on Windows.
        Invoke-Step 'end-to-end tests' { & corepack pnpm exec playwright test --workers=1 }
    }
} finally {
    Pop-Location
}
