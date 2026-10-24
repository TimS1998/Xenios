@echo off
rem Startet den Xenios-Server im Vordergrund (zum Testen). Fenster offen lassen.
cd /d "%~dp0\..\.."
rem Beim ersten Start zeigt das Fenster einen Einrichtungscode; eingerichtet wird dann im Browser.
node src\index.js
pause
