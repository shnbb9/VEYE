[CmdletBinding()]
param()

# VEYE local status: one line per service (web, api, postgres, mailpit) —
# UP or DOWN, the host port, the container behind it, and who holds the port
# when it is not ours. Exit code 1 when anything is DOWN.

$platformRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $platformRoot '.env.local-docker'
if (-not (Test-Path $envFile)) {
  Write-Host 'platform/.env.local-docker is missing - run scripts/local-up.ps1 first.'
  exit 1
}
$localConfig = Get-Content $envFile | Where-Object { $_ -match '^[A-Z0-9_]+=' } | ConvertFrom-StringData

function Get-Http([string]$url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Get-PortOwner([int]$port) {
  $container = (& docker ps --filter "publish=$port" --format '{{.Names}}') | Select-Object -First 1
  if ($container) { return "container $container" }
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return 'nothing listening' }
  $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($process) { return "$($process.ProcessName) (pid $($listener.OwningProcess))" }
  return "pid $($listener.OwningProcess)"
}

function Get-ContainerState([string]$name) {
  $state = (& docker ps -a --filter "name=^/$name$" --format '{{.Status}}') | Select-Object -First 1
  if ($state) { return "$name ($state)" }
  return "$name (not created)"
}

$webPort = [int]$localConfig.VEYE_WEB_HOST_PORT
$apiPort = [int]$localConfig.VEYE_API_HOST_PORT
$dbPort = [int]$localConfig.VEYE_DB_HOST_PORT
$mailPort = [int]$localConfig.VEYE_MAIL_WEB_HOST_PORT

$rows = @()
$web = Get-Http "http://localhost:$webPort/login"
$rows += @{ name = 'web';      up = ($web -eq 200);  where = "http://localhost:$webPort";  port = $webPort;  container = 'veye-local-web-1' }
$api = Get-Http "http://localhost:$apiPort/health"
$rows += @{ name = 'api';      up = ($api -eq 200);  where = "http://localhost:$apiPort";  port = $apiPort;  container = 'veye-local-api-1' }
& docker exec veye-local-db-1 pg_isready -q -U $localConfig.POSTGRES_USER -d $localConfig.POSTGRES_DB 2>$null | Out-Null
$rows += @{ name = 'postgres'; up = ($LASTEXITCODE -eq 0); where = "localhost:$dbPort";          port = $dbPort;   container = 'veye-local-db-1' }
$mail = Get-Http "http://localhost:$mailPort/api/v1/info"
$rows += @{ name = 'mailpit';  up = ($mail -eq 200); where = "http://localhost:$mailPort"; port = $mailPort; container = 'veye-local-mail-1' }

$down = 0
foreach ($row in $rows) {
  $state = if ($row.up) { 'UP  ' } else { $down++; 'DOWN' }
  $detail = Get-ContainerState $row.container
  if (-not $row.up) { $detail += " - port $($row.port): $(Get-PortOwner $row.port)" }
  Write-Host ("{0,-9} {1} {2,-24} {3}" -f $row.name, $state, $row.where, $detail)
}
exit $(if ($down) { 1 } else { 0 })
