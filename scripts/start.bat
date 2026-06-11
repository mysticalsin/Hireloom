@echo off
echo Starting Hireloom container...
cd /d "%~dp0.."

docker compose up -d --build 2>nul
if %ERRORLEVEL% EQU 0 (
    echo.
    echo Hireloom container is running.
    echo.
    echo To open a shell inside the container:
    echo   docker exec -it hireloom bash
    echo.
    echo To run PDF generation:
    echo   docker exec hireloom node engine/render/generate-pdf.mjs
    echo.
    echo To stop: run stop.bat
) else (
    docker compose up --build
)
pause
