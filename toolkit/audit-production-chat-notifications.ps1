param(
    [string]$BaseUrl = 'https://rolemate-data-api.carreljeremih.workers.dev',
    [string]$EnvFile = '.env.deploy.local',
    [long]$RequesterTelegramUserId = 1040929628,
    [string]$TargetUserId,
    [switch]$StartConversation,
    [switch]$QueueLikeNotification
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
        } -Body $body -TimeoutSec 60
}

$requester = Invoke-SignedOperation 'users.get' @{ telegramUserId = $RequesterTelegramUserId }
$result = [ordered]@{
    requesterUserId = $requester.data.id
}

if ($StartConversation) {
    if (-not $TargetUserId) { throw 'TargetUserId is required with StartConversation' }
    $conversation = Invoke-SignedOperation 'conversations.startDirect' @{
        userId = $requester.data.id
        targetUserId = $TargetUserId
    }
    $list = Invoke-SignedOperation 'conversations.list' @{
        userId = $requester.data.id
        limit = 100
    }
    $result.conversationId = $conversation.data.conversationId
    $result.conversationVisible = [bool]($list.data | Where-Object { $_.id -eq $conversation.data.conversationId })
}

if ($QueueLikeNotification) {
    $sourceKey = "production-like-notification-audit:$([guid]::NewGuid())"
    $notification = Invoke-SignedOperation 'notifications.telegram.enqueue' @{
        targetUserId = $requester.data.id
        category = 'like'
        openPath = '/matches'
        sourceKey = $sourceKey
        message = 'RoleMate like notification delivery audit.'
    }
    $result.likeNotificationQueued = $notification.data.queued
    $result.likeNotificationId = $notification.data.notificationId
    $result.likeNotificationSourceKey = $sourceKey
}

[pscustomobject]$result | ConvertTo-Json -Compress
