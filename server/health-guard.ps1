# Exit code 0 = something is already listening on the sync port (do NOT start a
# second copy of the server - it would fall back to port 4001 and the app,
# which is pointed at :4000, would stop syncing).
# Exit code 1 = port is free, the launcher should start the server.
$port = 4000
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^PORT=(\d+)' | Select-Object -First 1
    if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
            Select-Object -First 1

if ($listener) { exit 0 }
exit 1
