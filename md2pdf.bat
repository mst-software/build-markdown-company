@echo off
rem Drag and drop a .md file onto this file (or: md2pdf.bat file.md --toc)
node "%~dp0src\md2pdf.js" %*
if "%~1"=="" pause
if errorlevel 1 pause
