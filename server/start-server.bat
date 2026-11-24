@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ===========================================================================
REM  QC sync server keep-alive launcher  (QualityApp\server)
REM
REM   1. Hides its console window, so the server can no longer be stopped by
REM      accidentally closing the window or pressing Ctrl+C.
REM   2. Starts the server only when the sync port (4000) is really free.
REM      A second copy would fall back to port 4001 and the app - which is
REM      pointed at http://<ip>:4000 - would stop syncing.
REM   3. Restarts node automatically if it ever exits.
REM
REM  Server output   : D:\QualityApp\server\autostart.log
REM  Launcher events : D:\QualityApp\server\launcher.log
REM  (separate files: cmd cannot append to autostart.log while node holds it)
REM ===========================================================================
cd /d "D:\QualityApp\server"
set "SRVLOG=D:\QualityApp\server\autostart.log"
set "LOGL=D:\QualityApp\server\launcher.log"
set "WATCHING=0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hide-console.ps1"

:loop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0health-guard.ps1"
if not errorlevel 1 (
    if "!WATCHING!"=="0" echo [%date% %time%] Sync port already served by another instance - watching only.>>"%LOGL%"
    set "WATCHING=1"
    ping -n 31 127.0.0.1 >nul
    goto loop
)
set "WATCHING=0"
echo [%date% %time%] [WATCHDOG] Starting QC sync server>>"%LOGL%"
"C:\Program Files\nodejs\node.exe" index.js >>"%SRVLOG%" 2>&1
set "EXITCODE=!errorlevel!"
echo [%date% %time%] [WATCHDOG] QC sync server exited with code !EXITCODE! - restarting in 10s>>"%LOGL%"
ping -n 11 127.0.0.1 >nul
goto loop
