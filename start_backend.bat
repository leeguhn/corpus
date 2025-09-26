@echo off
REM start_backend.bat - start uvicorn and redirect output to logs\backend.log
set PYTHON_EXEC=".venv\Scripts\python.exe"
if not exist %PYTHON_EXEC% set PYTHON_EXEC=python
if not exist logs mkdir logs
%PYTHON_EXEC% -m uvicorn predict_server:app --host 127.0.0.1 --port 8000 > logs\backend.log 2>&1