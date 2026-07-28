param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Heading
)

$ErrorActionPreference = 'Stop'
$resolved = Resolve-Path -LiteralPath $Path
$text = [System.IO.File]::ReadAllText($resolved, [System.Text.Encoding]::UTF8)
$lines = $text -split "`r?`n"
$start = -1
$level = 0

for ($index = 0; $index -lt $lines.Length; $index++) {
    if ($lines[$index] -match '^(#+)\s+(.+)$' -and $Matches[2] -eq $Heading) {
        $start = $index
        $level = $Matches[1].Length
        break
    }
}

if ($start -lt 0) {
    throw "Heading not found: $Heading"
}

$end = $lines.Length
for ($index = $start + 1; $index -lt $lines.Length; $index++) {
    if ($lines[$index] -match '^(#+)\s+' -and $Matches[1].Length -le $level) {
        $end = $index
        break
    }
}

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$lines[$start..($end - 1)] -join [Environment]::NewLine

