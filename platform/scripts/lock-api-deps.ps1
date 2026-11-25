# Regenerate the API's hashed dependency locks after editing pyproject.toml.
#
#   .\scripts\lock-api-deps.ps1            # re-lock, keeping existing pins where they still fit
#   .\scripts\lock-api-deps.ps1 -Upgrade   # move every pin to the newest version the ranges allow
#
# The images and CI install ONLY from these files (pip --require-hashes), so a
# dependency edited in pyproject.toml without re-locking fails the build and
# tests/test_dependency_locks.py, rather than drifting silently. Every lock is
# resolved for the images' platform (Linux x86_64, Python 3.12) whatever
# machine runs this, so a Windows laptop produces the same files as CI would.
#
#   requirements/dev.lock         runtime + [ai,gemini]        docker/api.Dockerfile, CI e2e job
#   requirements/production.lock  runtime + [gemini,gcs]       docker/api.production.Dockerfile
#   requirements/ci.lock          runtime + [test,ai,gemini]   CI backend job (pytest)
#
# Needs uv (https://docs.astral.sh/uv/). After re-locking: rebuild the API
# image (scripts/local-rebuild.ps1), run the API suite, and run
# scripts/security-scan.ps1, which audits these locks.

[CmdletBinding()]
param([switch]$Upgrade)

$api = Join-Path (Split-Path -Parent $PSScriptRoot) 'api'
Push-Location $api
try {
  $common = @('--generate-hashes', '--python-version', '3.12', '--python-platform', 'x86_64-unknown-linux-gnu', '--quiet')
  if ($Upgrade) { $common += '--upgrade' }
  $locks = [ordered]@{
    'requirements/dev.lock'        = @('--extra', 'ai', '--extra', 'gemini')
    'requirements/production.lock' = @('--extra', 'gemini', '--extra', 'gcs')
    'requirements/ci.lock'         = @('--extra', 'test', '--extra', 'ai', '--extra', 'gemini')
  }
  foreach ($lock in $locks.Keys) {
    & uv pip compile pyproject.toml @($locks[$lock]) @common -o $lock
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "locked $lock"
  }
} finally {
  Pop-Location
}
