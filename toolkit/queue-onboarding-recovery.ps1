param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')]
  [string]$CreatedAfter,
  [string]$Campaign = 'onboarding-recovery-2026-08-07',
  [string]$BotUsername = 'r0lemate_bot',
  [string]$BaseUrl = 'https://rolemate-data-api.carreljeremih.workers.dev',
  [string]$EnvFile = '.env.deploy.local',
  [string]$ConfirmSend = ''
)

$ErrorActionPreference = 'Stop'
$variables = @{}
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $variables[$matches[1]] = $matches[2] }
}
if (-not $variables['INTERNAL_API_SECRET']) {
  throw 'INTERNAL_API_SECRET is missing from the local deployment env file.'
}

function Convert-ToHex([byte[]]$Bytes) {
  return ([BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
}

function Invoke-SignedOperation([bool]$DryRun) {
  $body = @{
    operation = 'notifications.onboardingRecovery.enqueue'
    input = @{
      createdAfter = $CreatedAfter
      campaign = $Campaign
      botUsername = $BotUsername
      limit = 300
      dryRun = $DryRun
    }
  } | ConvertTo-Json -Compress -Depth 6
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $nonce = [guid]::NewGuid().ToString('N')
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bodyHash = Convert-ToHex $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
  $canonical = "POST/v1/execute$timestamp$nonce$bodyHash"
  $hmac = [System.Security.Cryptography.HMACSHA256]::new(
    [Text.Encoding]::UTF8.GetBytes($variables['INTERNAL_API_SECRET'])
  )
  $signature = Convert-ToHex $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))
  return Invoke-RestMethod -Uri "$BaseUrl/v1/execute" -Method Post -ContentType 'application/json' `
    -Headers @{
      'X-Service-Id' = 'rolemate-bot-api'
      'X-Request-Timestamp' = $timestamp
      'X-Request-Nonce' = $nonce
      'X-Request-Signature' = $signature
      'X-Request-Id' = [guid]::NewGuid().ToString()
    } -Body $body
}

$preview = Invoke-SignedOperation $true
Write-Host "Eligible recipients: $($preview.data.eligible)"
if ($ConfirmSend -ne 'SEND ONBOARDING RECOVERY') {
  Write-Host 'Dry run complete. To queue messages pass -ConfirmSend "SEND ONBOARDING RECOVERY".'
  exit 0
}

$queued = 0
do {
  $result = Invoke-SignedOperation $false
  $queued += [int]$result.data.queued
  Write-Host "Queued in this batch: $($result.data.queued)"
} while ([int]$result.data.eligible -eq 300)

Write-Host "Total queued: $queued"
