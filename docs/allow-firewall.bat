@echo off
title Allow P2P Share Firewall

net session >nul 2>&1
if errorlevel 1 (
    echo Requesting administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo Adding firewall rules for browsers on Private networks...

netsh advfirewall firewall delete rule name="P2P Share Chrome" >nul 2>&1
netsh advfirewall firewall delete rule name="P2P Share Chrome x86" >nul 2>&1
netsh advfirewall firewall delete rule name="P2P Share Edge" >nul 2>&1
netsh advfirewall firewall delete rule name="P2P Share Firefox" >nul 2>&1

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    netsh advfirewall firewall add rule name="P2P Share Chrome" dir=in action=allow program="%ProgramFiles%\Google\Chrome\Application\chrome.exe" profile=private
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    netsh advfirewall firewall add rule name="P2P Share Chrome x86" dir=in action=allow program="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" profile=private
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    netsh advfirewall firewall add rule name="P2P Share Edge" dir=in action=allow program="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" profile=private
)

if exist "%ProgramFiles%\Mozilla Firefox\firefox.exe" (
    netsh advfirewall firewall add rule name="P2P Share Firefox" dir=in action=allow program="%ProgramFiles%\Mozilla Firefox\firefox.exe" profile=private
)

echo Done.
pause