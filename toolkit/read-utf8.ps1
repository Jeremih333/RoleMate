param(
    [Parameter(Mandatory = $true)]
    [string] $Path
)

$ErrorActionPreference = 'Stop'
$resolved = Resolve-Path -LiteralPath $Path
$bytes = [System.IO.File]::ReadAllBytes($resolved)
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$text = $utf8.GetString($bytes)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Write($text)

