@echo off
title SneakEzy
cd /d "%~dp0"
where python >nul 2>nul && (python server.py & goto :end)
where py >nul 2>nul && (py -3 server.py & goto :end)
echo.
echo Python is not installed. Download it from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" during install, then run this file again.
:end
echo.
pause
