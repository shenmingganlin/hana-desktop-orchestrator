@echo off
REM Build desktop-uia-helper.exe with .NET Framework 4.8 csc.
REM Requires the .NET Framework 4.8 compiler and UI Automation assemblies.
setlocal
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "WPF=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\"
set "SRC=%~dp0desktop-uia-helper.cs"
set "OUT=%~dp0desktop-uia-helper.exe"

"%CSC%" -nologo -out:"%OUT%" -target:exe -r:"%WPF%UIAutomationClient.dll" -r:"%WPF%UIAutomationTypes.dll" -r:"%WPF%WindowsBase.dll" "%SRC%"
if errorlevel 1 (
  echo Compilation FAILED
  exit /b 1
)
echo Compiled: %OUT%
dir "%OUT%"
