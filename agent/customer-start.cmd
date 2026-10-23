@echo off
setlocal
cd /d "%~dp0"
echo VELA - Demo account connector
echo Keep MetaTrader 5 open and logged into your demo account.
if exist ".venv\Scripts\python.exe" goto dependencies
py -3.13 -c "import struct; assert struct.calcsize('P') == 8" >nul 2>&1
if errorlevel 1 goto try_312
py -3.13 -m venv .venv
if errorlevel 1 goto install_failed
goto dependencies
:try_312
py -3.12 -c "import struct; assert struct.calcsize('P') == 8" >nul 2>&1
if errorlevel 1 goto try_python
py -3.12 -m venv .venv
if errorlevel 1 goto install_failed
goto dependencies
:try_python
python -c "import sys,struct; assert (3,12) <= sys.version_info[:2] < (3,15) and struct.calcsize('P') == 8" >nul 2>&1
if errorlevel 1 goto python_missing
python -m venv .venv
if errorlevel 1 goto install_failed
:dependencies
".venv\Scripts\python.exe" -c "import MetaTrader5,requests" >nul 2>&1
if not errorlevel 1 goto start_agent
echo First setup: downloading official Python packages from PyPI...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto install_failed
:start_agent
".venv\Scripts\python.exe" -X utf8 -u launch.py
pause
exit /b
:python_missing
echo Install Python 3.13 64-bit from https://www.python.org/downloads/release/python-31317/
echo Then open Start-VELA.cmd again.
pause
exit /b 1
:install_failed
echo Setup failed. Check your internet connection and try again.
pause
exit /b 1
