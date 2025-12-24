@echo off
chcp 65001 > nul
powershell -ExecutionPolicy Bypass -File "%~dp0fix_vscode_protocol.ps1"
