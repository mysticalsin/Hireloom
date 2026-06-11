@echo off
echo Stopping Career Ops...
cd /d "%~dp0"
docker compose down
echo Career Ops stopped.
pause
