@echo off
chcp 65001 > nul
cd /d "%~dp0"

if "%1"=="" (
  set /p URL="URL を入力してください: "
) else (
  set URL=%1
)

if "%2"=="" (
  set WAIT=3
) else (
  set WAIT=%2
)

node screenshot.js %URL% %WAIT%
pause
