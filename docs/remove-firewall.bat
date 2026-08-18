@echo off
title Remove P2P Share Firewall Rules

net session >nul 2>&1
if errorlevel 1 (
    echo Requesting administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo Removing firewall rules...

netsh advfirewall firewall delete rule name="P2P Share Chrome" >nul 2>&1
netsh advfirewall firewall delete rule name="P2P Share Chrome x86" >nul 2>&1
netsh advfirewall firewall delete rule name="P2P Share Edge" >nul 2>&1
netsh advfirewall firewall delete rule name="P2P Share Firefox" >nul 2>&1

echo Done.
pause