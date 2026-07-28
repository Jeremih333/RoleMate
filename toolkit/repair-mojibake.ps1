param(
    [Parameter(Mandatory = $true)]
    [string[]]$Path,
    [switch]$Write
)

$ErrorActionPreference = 'Stop'
$cp1251 = [System.Text.Encoding]::GetEncoding(
    1251,
    [System.Text.EncoderExceptionFallback]::new(),
    [System.Text.DecoderExceptionFallback]::new()
)
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

foreach ($target in $Path) {
    $resolved = (Resolve-Path -LiteralPath $target).Path
    $lines = [System.IO.File]::ReadAllLines($resolved, $utf8)
    $changed = 0

    for ($index = 0; $index -lt $lines.Length; $index++) {
        $line = $lines[$index]
        try {
            $candidate = $utf8.GetString($cp1251.GetBytes($line))
        }
        catch {
            continue
        }

        if ($candidate -ne $line) {
            $lines[$index] = $candidate
            $changed++
        }
    }

    if ($Write -and $changed -gt 0) {
        [System.IO.File]::WriteAllLines($resolved, $lines, $utf8NoBom)
    }

    [pscustomobject]@{
        Path = $resolved
        ChangedLines = $changed
        Written = [bool]($Write -and $changed -gt 0)
    }
}
