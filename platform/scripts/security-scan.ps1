# VEYE security scan — run before a release, and after any dependency change.
#
# Deliberately local and manual. CI is manual-only by instruction, and a scan
# nobody runs is worse than no scan because it implies one happened.
#
# Everything here is read-only. Nothing is installed, upgraded or sent
# anywhere; a finding is reported for a person to decide on.
#
#   .\scripts\security-scan.ps1            # report
#   .\scripts\security-scan.ps1 -FailOnHigh  # non-zero exit on high/critical
#
# First run needs the scanners:
#   platform\api\.venv\Scripts\python.exe -m pip install pip-audit bandit

[CmdletBinding()]
param([switch]$FailOnHigh)

$platformRoot = Split-Path -Parent $PSScriptRoot
$api = Join-Path $platformRoot 'api'
$web = Join-Path $platformRoot 'web'
$python = Join-Path $api '.venv\Scripts\python.exe'
$problems = 0

function Section($name) {
  Write-Host ''
  Write-Host "=== $name " -NoNewline
  Write-Host ('=' * [Math]::Max(0, 60 - $name.Length))
}

# ---- 1. Python dependencies -------------------------------------------------
Section 'Python dependencies (pip-audit)'
Push-Location $api
try {
  & $python -m pip_audit --progress-spinner off
  if ($LASTEXITCODE -ne 0) { $problems++ }
  # A broken pin is its own kind of risk: it means the tree resolved to
  # something nobody chose.
  & $python -m pip check
} finally { Pop-Location }

# ---- 2. Python static analysis ----------------------------------------------
Section 'Python static analysis (bandit)'
Push-Location $api
try {
  # Medium and above. Low is mostly asserts and deliberate try/except, which
  # are reviewed rather than chased.
  & $python -m bandit -r app -q -ll
  if ($LASTEXITCODE -ne 0) { $problems++ }
} finally { Pop-Location }

# ---- 3. JavaScript dependencies ---------------------------------------------
Section 'JavaScript dependencies (npm audit)'
Push-Location $web
try {
  # NOTE: `npm audit fix` will not move a dependency pinned to an exact
  # version. That is how a critical Next.js RCE sat in this tree while the
  # tool reported it as fixable — check direct pins by hand.
  npm audit --audit-level=high
  if ($LASTEXITCODE -ne 0) { $problems++ }
  Write-Host ''
  Write-Host 'Full report including moderate:'
  npm audit | Select-String -Pattern 'vulnerabilities' | Select-Object -Last 1
} finally { Pop-Location }

# ---- 4. Secrets ---------------------------------------------------------------
Section 'Secrets in tracked files'
Push-Location $platformRoot\..
try {
  # Pattern-based, on tracked files only. .env.* is git-ignored, so anything
  # matching here is in the repository itself — which is public.
  $patterns = 'AIza[0-9A-Za-z_-]{20,}', 'AKIA[0-9A-Z]{16}', 'ya29\.[0-9A-Za-z_-]+',
              '-----BEGIN [A-Z ]*PRIVATE KEY-----', '"private_key"\s*:', 'client_secret'
  $hits = 0
  foreach ($pattern in $patterns) {
    # This script lists the patterns it looks for, so it matches itself on
    # every run. A scanner that reports a finding it cannot ever clear is one
    # people learn to ignore, which is worse than not running it.
    $found = git grep -nIE $pattern -- ':!*.lock' ':!package-lock.json' ':!platform/scripts/security-scan.ps1' 2>$null
    if ($found) { $hits++; Write-Host "MATCH $pattern"; $found }
  }
  if ($hits -eq 0) { Write-Host 'No credential patterns in tracked files.' } else { $problems++ }
} finally { Pop-Location }

# ---- 5. Container image -------------------------------------------------------
Section 'Production image (trivy, if installed)'
if (Get-Command trivy -ErrorAction SilentlyContinue) {
  Write-Host 'Build the production image first, then:'
  Write-Host '  trivy image --severity HIGH,CRITICAL veye-api:production'
} else {
  Write-Host 'trivy is not installed. Install it to scan the production image:'
  Write-Host '  https://trivy.dev  —  then: trivy image --severity HIGH,CRITICAL <image>'
  Write-Host 'Skipped, not failed: the image is not built locally by default.'
}

Section 'Summary'
if ($problems -eq 0) {
  Write-Host 'No high or critical findings.'
} else {
  Write-Host "$problems scanner(s) reported findings above the threshold."
}
if ($FailOnHigh -and $problems -gt 0) { exit 1 }
exit 0
