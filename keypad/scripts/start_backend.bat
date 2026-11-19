@echo off
REM Start the keypad API and redirect output to keypad\logs\backend.log.
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "KEYPAD_ROOT=%%~fI"
set "PYTHON_EXEC=%KEYPAD_ROOT%\.venv\Scripts\python.exe"
if not exist "%PYTHON_EXEC%" set "PYTHON_EXEC=python"
if not exist "%KEYPAD_ROOT%\logs" mkdir "%KEYPAD_ROOT%\logs"
"%PYTHON_EXEC%" -m uvicorn predict_server:app --app-dir "%KEYPAD_ROOT%\backend" --host 127.0.0.1 --port 8000 > "%KEYPAD_ROOT%\logs\backend.log" 2>&1
