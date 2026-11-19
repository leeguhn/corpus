<#
start_all.ps1

PowerShell helper to create/activate venv, start the prediction backend, and run the React dev server.

Usage (PowerShell):
  ./start_all.ps1

Options:
  -InstallDeps : install pip requirements before starting (default: $false)
  -Port <int>  : backend port (default 8000)
  -ReactDir    : path to the frontend folder under keypad (default 'frontend')

#>

param(
    [switch]$InstallDeps = $false,
    [int]$Port = 8000,
    [string]$ReactDir = "frontend"
)

Set-StrictMode -Version Latest

function Write-Log($m) { Write-Host "[start_all] $m" }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$keypadRoot = Split-Path -Parent $scriptDir
$backendDir = Join-Path $keypadRoot 'backend'
Push-Location $keypadRoot

# Create venv if missing
$venvPath = Join-Path $keypadRoot '.venv'
if (-not (Test-Path $venvPath)) {
    Write-Log "Creating virtual environment at $venvPath"
    python -m venv $venvPath
}

# Activate venv for the rest of the script
$activate = Join-Path $venvPath 'Scripts\Activate.ps1'
if (-not (Test-Path $activate)) {
    Write-Error "Could not find Activate.ps1 at $activate"
    exit 1
}

Write-Log "Activating venv"
. $activate

if ($InstallDeps) {
    $requirements = Join-Path $backendDir 'requirements.txt'
    if (Test-Path $requirements) {
        Write-Log "Installing dependencies from $requirements"
        pip install --upgrade pip
        pip install -r $requirements
    } else {
        Write-Log "requirements.txt not found, installing minimal server deps"
        pip install fastapi uvicorn pydantic
    }
}

# Start backend in background and capture stdout/stderr separately.
$logDir = Join-Path $keypadRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$backendOutLog = Join-Path $logDir "backend.stdout.log"
$backendErrorLog = Join-Path $logDir "backend.stderr.log"

Write-Log "Starting backend on port $Port (logs -> $logDir)"

# Use Start-Process to launch python predict_server.py using venv python
$pythonExe = Join-Path $venvPath 'Scripts\python.exe'
if (-not (Test-Path $pythonExe)) { $pythonExe = 'python' }

# Pass dynamic port to backend (predict_server.py now supports --port)
$backendScript = Join-Path $backendDir 'predict_server.py'
$backendArgs = "`"$backendScript`" --port $Port"

# If a process is already listening on the port, warn but continue
try {
    $listening = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listening) { Write-Log "Port $Port already in use, backend may already be running." }
} catch { }

Start-Process -FilePath $pythonExe -ArgumentList $backendArgs -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $backendOutLog -RedirectStandardError $backendErrorLog | Out-Null

# Set env var for React to call backend
$backendUrl = "http://127.0.0.1:$Port"
$env:VITE_PREDICTOR_URL = $backendUrl
Write-Log "Set VITE_PREDICTOR_URL = $backendUrl for the Vite process"

# Start React dev server in foreground so logs are visible
if (-not (Test-Path $ReactDir)) { Write-Error "React directory '$ReactDir' not found"; exit 1 }

Push-Location $ReactDir
Write-Log "Starting React dev server in '$ReactDir'"

# If node_modules not present, run npm install (use npm.cmd on Windows to avoid the PowerShell wrapper issues)
$npmCmd = 'npm.cmd'
if (-not (Test-Path 'node_modules')) {
    Write-Log "node_modules not found, running npm install (may take a while)"
    & $npmCmd install
}

Write-Log "Running: npm run dev"
& $npmCmd run dev

Pop-Location # frontend
Pop-Location # keypad
