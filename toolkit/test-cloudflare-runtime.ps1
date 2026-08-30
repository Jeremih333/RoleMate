param(
    [int]$Port = 8790,
    [int]$StartupTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stdoutLog = Join-Path $PSScriptRoot 'wrangler-dev.log'
$stderrLog = Join-Path $PSScriptRoot 'wrangler-dev-error.log'
$existingWorkerProcessIds = @(
    Get-Process -Name 'workerd' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$workspace*" } |
        ForEach-Object { $_.Id }
)

function Get-DescendantProcessIds {
    param([int]$ParentId)

    $result = [System.Collections.Generic.List[int]]::new()
    $pending = [System.Collections.Generic.Queue[int]]::new()
    $pending.Enqueue($ParentId)
    while ($pending.Count -gt 0) {
        $current = $pending.Dequeue()
        $children = Get-CimInstance Win32_Process |
            Where-Object { $_.ParentProcessId -eq $current }
        foreach ($child in $children) {
            $childId = [int]$child.ProcessId
            $result.Add($childId)
            $pending.Enqueue($childId)
        }
    }
    return $result
}

$wrangler = Join-Path $workspace 'apps\bot-api\node_modules\.bin\wrangler.CMD'
$process = Start-Process `
    -FilePath $wrangler `
    -ArgumentList @(
        'dev',
        '--port',
        [string]$Port
    ) `
    -WorkingDirectory (Join-Path $workspace 'apps\bot-api') `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

try {
    $baseUrl = "http://127.0.0.1:$Port"
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $live = $null
    $lastReadinessError = $null
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        try {
            $live = Invoke-RestMethod -Uri "$baseUrl/health/live" -TimeoutSec 5
            break
        } catch {
            $lastReadinessError = $_.Exception.Message
            if ($process.HasExited) {
                throw "Wrangler exited before readiness. See $stderrLog"
            }
        }
    }
    if ($null -eq $live) {
        throw "Worker did not become ready within $StartupTimeoutSeconds seconds ($lastReadinessError). See $stderrLog"
    }

    $index = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/" -TimeoutSec 5
    $avatar = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "$baseUrl/assets/telegram-bot-avatar.jpg" `
        -TimeoutSec 5
    $version = Invoke-RestMethod -Uri "$baseUrl/version" -TimeoutSec 5
    $unauthenticatedStatus = 0
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/admin/dashboard" -TimeoutSec 5 | Out-Null
    } catch {
        $unauthenticatedStatus = [int]$_.Exception.Response.StatusCode
    }
    $forgedWebhookStatus = 0
    try {
        Invoke-WebRequest `
            -UseBasicParsing `
            -Uri "$baseUrl/telegram/webhook" `
            -Method Post `
            -ContentType 'application/json' `
            -Body '{"update_id":1}' `
            -TimeoutSec 5 | Out-Null
    } catch {
        $forgedWebhookStatus = [int]$_.Exception.Response.StatusCode
    }

    [pscustomobject]@{
        live = $live.status
        version = $version.version
        indexStatus = $index.StatusCode
        indexHasRoleMate = $index.Content.Contains('RoleMate')
        avatarStatus = $avatar.StatusCode
        avatarBytes = $avatar.RawContentLength
        unauthenticatedStatus = $unauthenticatedStatus
        forgedWebhookStatus = $forgedWebhookStatus
    } | ConvertTo-Json -Compress
} finally {
    $descendants = @(Get-DescendantProcessIds -ParentId $process.Id)
    [array]::Reverse($descendants)
    foreach ($processId in $descendants) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        [void]$process.WaitForExit(5000)
    }
    $newWorkers = Get-Process -Name 'workerd' -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -like "$workspace*" -and
            $_.Id -notin $existingWorkerProcessIds
        }
    foreach ($worker in $newWorkers) {
        Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
    }
}
