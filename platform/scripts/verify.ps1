$ErrorActionPreference = 'Stop'

Push-Location "$PSScriptRoot\..\api"
try { & ".\.venv\Scripts\python.exe" -m pytest }
finally { Pop-Location }

Push-Location "$PSScriptRoot\..\web"
try { npm run build }
finally { Pop-Location }

Push-Location "$PSScriptRoot\..\.."
try {
  node tests\veye-calculations.test.js
  node tests\veye-ui-contracts.test.js
}
finally { Pop-Location }

