<#
start_all.ps1

PowerShell helper to create/activate venv, start the prediction backend, and run the React dev server.

Usage (PowerShell):
  ./start_all.ps1

Options:
  -InstallDeps : install pip requirements before starting (default: $false)
  -Port <int>  : backend port (default 8000)
  -ReactDir    : path to react folder (default './react')

#>

param(
    [switch]$InstallDeps = $false,
    [int]$Port = 8000,
    [string]$ReactDir = "react"
)

Set-StrictMode -Version Latest

function Write-Log($m) { Write-Host "[start_all] $m" }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

# Create venv if missing
$venvPath = Join-Path $root '.venv'
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
    if (Test-Path requirements.txt) {
        Write-Log "Installing dependencies from requirements.txt"
        pip install --upgrade pip
        pip install -r requirements.txt
    } else {
        Write-Log "requirements.txt not found, installing minimal server deps"
        pip install fastapi uvicorn pydantic
    }
}

# Start backend in background and capture logs
$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$backendLog = Join-Path $logDir "backend.log"

Write-Log "Starting backend on port $Port (logs -> $backendLog)"

# Use Start-Process to launch python predict_server.py using venv python
$pythonExe = Join-Path $venvPath 'Scripts\python.exe'
if (-not (Test-Path $pythonExe)) { $pythonExe = 'python' }

# Pass dynamic port to backend (predict_server.py now supports --port)
$backendArgs = "predict_server.py --port $Port"

# If a process is already listening on the port, warn but continue
try {
    $listening = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listening) { Write-Log "Port $Port already in use, backend may already be running." }
} catch { }

# Use cmd.exe to redirect both stdout and stderr into a single log file (Windows Start-Process doesn't allow same file for both redirects)
$cmdLine = "`"$pythonExe`" $backendArgs > `"$backendLog`" 2>&1"
Start-Process -FilePath "cmd.exe" -ArgumentList '/c', $cmdLine -WindowStyle Hidden -PassThru | Out-Null

# Set env var for React to call backend
$backendUrl = "http://127.0.0.1:$Port"
$env:REACT_APP_PREDICTOR_URL = $backendUrl
Write-Log "Set REACT_APP_PREDICTOR_URL = $backendUrl"

# Start React dev server in foreground so logs are visible
if (-not (Test-Path $ReactDir)) { Write-Error "React directory '$ReactDir' not found"; exit 1 }

Push-Location $ReactDir
Write-Log "Starting React dev server in '$ReactDir'"

# Ensure Vite can see the backend URL via react/.env
$envFile = Join-Path (Get-Location) '.env'
Write-Log "Writing VITE_PREDICTOR_URL to $envFile"
"VITE_PREDICTOR_URL=$backendUrl" | Out-File -Encoding ASCII -FilePath $envFile

# If node_modules not present, run npm install (use npm.cmd on Windows to avoid the PowerShell wrapper issues)
$npmCmd = 'npm.cmd'
if (-not (Test-Path 'node_modules')) {
    Write-Log "node_modules not found, running npm install (may take a while)"
    & $npmCmd install
}

Write-Log "Running: npm run dev"
& $npmCmd run dev

Pop-Location # react
Pop-Location # root