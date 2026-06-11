@echo off
echo Stopping Hireloom...
cd /d "%~dp0.."
docker compose down
echo Hireloom stopped.
pause
