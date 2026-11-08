param([string]$PythonVersion = '3.12')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'vendor/MiroFish'
$venvPython = Join-Path $projectRoot '.venv-mirofish/Scripts/python.exe'
$expectedCommit = '7657031ac01184afe2cb220f5ee3545573b5e843'
if (-not (Test-Path -LiteralPath $sourcePath)) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $sourcePath) | Out-Null
    git clone --no-checkout https://github.com/666ghj/MiroFish.git $sourcePath
    if ($LASTEXITCODE -ne 0) { throw 'MiroFish checkout failed.' }
    git -C $sourcePath checkout $expectedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Pinned source checkout failed.' }
}
$actualCommit = (git -C $sourcePath rev-parse HEAD).Trim()
if ($actualCommit -ne $expectedCommit) { throw 'Existing MiroFish checkout is not the supported pinned revision. No files changed.' }
$sourceChanges = git -C $sourcePath status --porcelain
if ($sourceChanges) { throw 'Existing upstream source has local changes; preserve them and use a clean pinned checkout.' }
uv python install $PythonVersion
if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
uv venv (Join-Path $projectRoot '.venv-mirofish') --python $PythonVersion
if ($LASTEXITCODE -ne 0) { throw 'Preparation environment creation failed.' }
uv pip install --python $venvPython -r (Join-Path $PSScriptRoot 'requirements-mirofish.lock')
if ($LASTEXITCODE -ne 0) { throw 'Locked preparation dependency installation failed.' }
uv pip install --python $venvPython --no-deps -e (Join-Path $sourcePath 'backend')
if ($LASTEXITCODE -ne 0) { throw 'Pinned MiroFish package installation failed.' }
Write-Output 'Pinned MiroFish preparation environment is ready. No API calls were made.'
