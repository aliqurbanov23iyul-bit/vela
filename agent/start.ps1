param([string]$ConfigPath = (Join-Path $env:USERPROFILE 'Downloads\vela-connection.json'))
$ErrorActionPreference = 'Stop'
$agentRoot = $PSScriptRoot
$agentPython = Join-Path $agentRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'Download vela-connection.json from your VELA account first.' }
if (-not (Test-Path -LiteralPath $agentPython)) { throw 'The agent Python environment has not been installed yet.' }
Write-Host 'VELA demo connector is starting. Keep MT5 and this Windows session running. Demo entries require an active website session and a valid signal.'
& $agentPython (Join-Path $agentRoot 'main.py') --config $ConfigPath
if ($LASTEXITCODE -ne 0) { throw 'Agent stopped. Check MT5 login, server and the connection file. No trades were sent.' }
