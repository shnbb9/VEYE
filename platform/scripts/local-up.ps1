[CmdletBinding()]
param(
  [switch]$Build,
  # Kept for older notes; Mailpit now starts by default. -NoMail leaves it out.
  [switch]$Mail,
  [switch]$NoMail
)

# The one command that starts VEYE locally: PostgreSQL, the API, the web app
# and the Mailpit development mailbox, as Docker containers that stay up
# until scripts/local-down.ps1 (or Docker Desktop) stops them. Nothing here
# depends on a test run. Host ports come from platform/.env.local-docker.

$platformRoot = Split-Path -Parent $PSScriptRoot
Push-Location $platformRoot
try {
  $env:DOCKER_CONFIG = Join-Path $platformRoot '.docker-cli'
  New-Item -ItemType Directory -Force $env:DOCKER_CONFIG | Out-Null
  if (-not (Test-Path '.env.local-docker')) {
    Copy-Item '.env.local-docker.example' '.env.local-docker'
    Write-Host 'Created platform/.env.local-docker from the safe local example.'
  }
  $localConfig = Get-Content '.env.local-docker' | Where-Object { $_ -match '^[A-Z0-9_]+=' } | ConvertFrom-StringData
  $withMail = -not $NoMail

  # Refuse to start into a port another program already holds. Compose would
  # fail with a bind error after pulling images; this names the owner instead
  # and never stops it (other projects share this machine).
  $wanted = @(
    @{ service = 'web';  port = [int]$localConfig.VEYE_WEB_HOST_PORT },
    @{ service = 'api';  port = [int]$localConfig.VEYE_API_HOST_PORT },
    @{ service = 'db';   port = [int]$localConfig.VEYE_DB_HOST_PORT }
  )
  if ($withMail) {
    $wanted += @{ service = 'mail'; port = [int]$localConfig.VEYE_MAIL_WEB_HOST_PORT }
    $wanted += @{ service = 'mail'; port = [int]$localConfig.VEYE_MAIL_SMTP_HOST_PORT }
  }
  $blocked = @()
  foreach ($item in $wanted) {
    $owner = (& docker ps --filter "publish=$($item.port)" --format '{{.Names}}') | Select-Object -First 1
    if ($owner -and $owner -notlike 'veye-local-*') {
      $blocked += "port $($item.port) (VEYE $($item.service)) is published by container '$owner'"
      continue
    }
    if (-not $owner) {
      $listener = Get-NetTCPConnection -LocalPort $item.port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($listener) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        $name = if ($process) { "$($process.ProcessName) (pid $($listener.OwningProcess))" } else { "pid $($listener.OwningProcess)" }
        $blocked += "port $($item.port) (VEYE $($item.service)) is held by $name"
      }
    }
  }
  if ($blocked.Count) {
    Write-Error ("Cannot start VEYE:`n  " + ($blocked -join "`n  ") + "`nChange the port in platform/.env.local-docker or stop that program yourself; this script never does.")
    exit 2
  }

  $arguments = @('compose', '--env-file', '.env.local-docker', '-f', 'compose.local.yaml')
  if ($withMail) { $arguments += @('--profile', 'mail') }
  # --wait returns only once every service reports healthy, so "ready" means
  # the web app already answers on its port (its first compile is included).
  $arguments += @('up', '-d', '--wait', '--wait-timeout', '300')
  if ($Build) { $arguments += '--build' }
  & docker @arguments
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'VEYE did not become healthy. Run scripts/local-status.ps1, then docker compose logs web (or api).'
    exit $LASTEXITCODE
  }

  Write-Host ''
  & (Join-Path $PSScriptRoot 'local-status.ps1')
  Write-Host ''
  Write-Host "Member app: http://localhost:$($localConfig.VEYE_WEB_HOST_PORT)/login"
  Write-Host "Admin app:  http://localhost:$($localConfig.VEYE_WEB_HOST_PORT)/admin/login"
  Write-Host "API:        http://localhost:$($localConfig.VEYE_API_HOST_PORT)  (OpenAPI at /docs)"
  if ($withMail) {
    Write-Host "Mailpit:    http://localhost:$($localConfig.VEYE_MAIL_WEB_HOST_PORT)  (verification / reset emails)"
  } else {
    Write-Host 'Mailpit:    not started (-NoMail); verification and reset emails are recorded as failed deliveries.'
  }
  Write-Host "PostgreSQL: localhost:$($localConfig.VEYE_DB_HOST_PORT)"
  Write-Host ''
  Write-Host 'Synthetic local accounts (platform/README.md): cara.hogue@demo.veye.test and priya.ops@demo.veye.test (admin); aditya.demo@demo.veye.test, maya.demo@demo.veye.test, jordan.dual@demo.veye.test (members).'
} finally {
  Pop-Location
}
