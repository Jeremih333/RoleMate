param(
    [string]$Token = $env:TELEGRAM_BOT_TOKEN,
    [string]$AvatarPath = (Join-Path (Get-Location) 'assets/generated/telegram-bot-avatar.jpg')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
if ([string]::IsNullOrWhiteSpace($Token)) {
    throw 'TELEGRAM_BOT_TOKEN is required'
}
if (-not (Test-Path -LiteralPath $AvatarPath -PathType Leaf)) {
    throw "Avatar not found: $AvatarPath"
}

$http = [System.Net.Http.HttpClient]::new()
$baseUrl = "https://api.telegram.org/bot$Token/"

function Invoke-TelegramJson {
    param([string]$Method, [hashtable]$Body)
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $content = [System.Net.Http.StringContent]::new(
        $json,
        [System.Text.Encoding]::UTF8,
        'application/json'
    )
    $response = $http.PostAsync("$baseUrl$Method", $content).GetAwaiter().GetResult()
    $payload = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    if (-not $response.IsSuccessStatusCode -or -not $payload.ok) {
        throw "$Method failed: $($payload.description)"
    }
    return $payload.result
}

$results = [ordered]@{}
try {
    $results.name = Invoke-TelegramJson 'setMyName' @{ name = 'RoleMate' }
    $results.description = Invoke-TelegramJson 'setMyDescription' @{
        description = 'RoleMate — пространство для анонимного поиска со-ролевиков. Создавай анкету, находи авторов по фандомам, жанрам и стилю письма, получай взаимные симпатии и общайся без раскрытия Telegram-профиля. Контакты открываются только по взаимному согласию. Поддержка: @odinnadsat. Создано при поддержке пиар-чата @piarchaticksss.'
    }
    $results.shortDescription = Invoke-TelegramJson 'setMyShortDescription' @{
        short_description = 'Анонимный поиск со-ролевиков по фандомам, жанрам и стилю письма. Поддержка: @odinnadsat'
    }
    $results.commands = Invoke-TelegramJson 'setMyCommands' @{
        commands = @(
            @{ command = 'start'; description = 'Запустить бота' },
            @{ command = 'menu'; description = 'Главное меню' },
            @{ command = 'profile'; description = 'Моя анкета' },
            @{ command = 'search'; description = 'Найти со-ролевика' },
            @{ command = 'matches'; description = 'Взаимные симпатии' },
            @{ command = 'chats'; description = 'Анонимные чаты' },
            @{ command = 'premium'; description = 'Premium' },
            @{ command = 'referral'; description = 'Пригласить друзей' },
            @{ command = 'settings'; description = 'Настройки' },
            @{ command = 'rules'; description = 'Правила' },
            @{ command = 'help'; description = 'Помощь' },
            @{ command = 'support'; description = 'Поддержка' },
            @{ command = 'paysupport'; description = 'Поддержка по оплате' },
            @{ command = 'delete_me'; description = 'Удалить аккаунт' }
        )
    }

    $multipart = [System.Net.Http.MultipartFormDataContent]::new()
    $photoDefinition = [System.Net.Http.StringContent]::new(
        '{"type":"static","photo":"attach://avatar"}',
        [System.Text.Encoding]::UTF8,
        'application/json'
    )
    $multipart.Add($photoDefinition, 'photo')
    $stream = [System.IO.File]::OpenRead($AvatarPath)
    $photo = [System.Net.Http.StreamContent]::new($stream)
    $photo.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('image/jpeg')
    $multipart.Add($photo, 'avatar', 'telegram-bot-avatar.jpg')
    try {
        $response = $http.PostAsync("${baseUrl}setMyProfilePhoto", $multipart).GetAwaiter().GetResult()
        $payload = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if (-not $response.IsSuccessStatusCode -or -not $payload.ok) {
            throw "setMyProfilePhoto failed: $($payload.description)"
        }
        $results.profilePhoto = $payload.result
    }
    finally {
        $multipart.Dispose()
        $stream.Dispose()
    }

    $me = Invoke-TelegramJson 'getMe' @{}
    $photos = Invoke-TelegramJson 'getUserProfilePhotos' @{ user_id = $me.id; limit = 1 }
    [pscustomobject]@{
        username = $me.username
        displayName = $me.first_name
        profilePhotoCount = $photos.total_count
        configured = ($results.Values -notcontains $false)
    } | ConvertTo-Json -Compress
}
finally {
    $http.Dispose()
}

