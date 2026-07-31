# Reproducible Builds

This plugin ships precompiled native executables to replace PowerShell-based tools.
All binaries can be reproduced from source using the instructions below.

## desktop-helper.exe

Source: `helper/desktop-helper.cs` (C#, .NET 8)

```powershell
cd helper
dotnet publish -c Release -o . --self-contained false
```

Requires .NET 8 SDK installed. Output: `helper/desktop-helper.exe` (~150KB).

## desktop-uia-helper.exe

Source: `helper/desktop-uia-helper.cs` (C#, .NET Framework 4.8)

```batch
helper\compile-uia-helper.bat
```

Or manually with csc:

```batch
"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" ^
  -nologo -out:helper\desktop-uia-helper.exe -target:exe ^
  -r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationClient.dll" ^
  -r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationTypes.dll" ^
  -r:"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll" ^
  helper\desktop-uia-helper.cs
```

Requires .NET Framework 4.8 (pre-installed on Windows 10/11). Output: `helper/desktop-uia-helper.exe` (~13KB).

## HanaWin32.dll

Source: `helper/HanaWin32.cs` (C#, compiled inline via PowerShell at runtime).

The DLL is compiled on first use by PowerShell's `Add-Type` command.
The source is the single `.cs` file; no separate build step is needed.

## Deterministic Plugin Package

The plugin ZIP is built by `scripts/build-package.js` with a stable sorted file order and a fixed archive entry timestamp. The package uses an explicit documentation allowlist so repository-only `RELEASE_CANDIDATE_*.md` audit records are not included in the installable artifact. Build the package twice from an unchanged tree and compare the ZIP SHA-256; the hashes must match.

## Verify Against Shipped Binary

After building, compare SHA-256 hashes:

```powershell
Get-FileHash helper\desktop-helper.exe
Get-FileHash helper\desktop-uia-helper.exe
```

If hashes differ from the shipped version, the binary was rebuilt from possibly different source.
This is expected after source changes — the source in this repo is authoritative.

## Why Authenticode Signatures Are Absent

The executables are unsigned (NotSigned) because:
- Authenticode certificates cost money and require organizational identity
- The plugin is open-source MIT; anyone can rebuild and trust their own build
- The source is in the same repo as the binary, enabling local reproduction

If you need signed binaries for enterprise deployment, build from source and sign with your own certificate.
