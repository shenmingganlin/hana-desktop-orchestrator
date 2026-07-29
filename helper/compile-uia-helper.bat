@echo off
REM compile-uia-helper.bat — Build desktop-uia-helper.exe with .NET Framework 4.8 csc
REM Requires: Windows SDK / .NET Framework 4.8 csc (built into Windows 10+)
setlocal
set CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set WPF=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\
set SRC=%~dp0desktop-uia-helper.cs
set OUT=%~dp0desktop-uia-helper.exe

"%CSC%" -nologo -out:"%OUT%" -target:exe ^
  -r:"%WPF%UIAutomationClient.dll" ^
  -r:"%WPF%UIAutomationTypes.dll" ^
  -r:"%WPF%WindowsBase.dll" ^
  "%SRC%"

if %ERRORLEVEL% equ 0 (
  echo Compiled: %OUT%
  dir "%OUT%"
) else (
  echo Compilation FAILED
  exit /b 1
)
