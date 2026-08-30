param(
  [string]$WorkerDirectory = "apps/bot-api"
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workerPath = (Resolve-Path (Join-Path $workspace $WorkerDirectory)).Path

$keyId = Read-Host "Cloudflare Realtime TURN key ID"
$secretValue = Read-Host "Cloudflare Realtime TURN key secret" -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretValue)

try {
  $keySecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  $keyId | corepack pnpm exec wrangler secret put TURN_KEY_ID --cwd $workerPath
  if ($LASTEXITCODE -ne 0) { throw "Failed to save TURN_KEY_ID" }
  $keySecret | corepack pnpm exec wrangler secret put TURN_KEY_SECRET --cwd $workerPath
  if ($LASTEXITCODE -ne 0) { throw "Failed to save TURN_KEY_SECRET" }
  Write-Host "TURN credentials were saved as Worker secrets."
}
finally {
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  $keySecret = $null
}
