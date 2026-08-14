iRite for Visual Studio Code
============================

This extension adds support for the iRite Language to Visual Studio
Code. It supports:

-   Syntax Colorization
-   Snippets
-   Preprocessing
-   Compiling
-   Deployment to Indicator

Installation
============

Click on the Extension tab, and type in iRite. Click install and allow
VScode to restart. You now have syntax highlighting and snippets.

Compilation and Deployment
--------------------------

-   Ensure Revolution is installed:
    [Revolution](https://www.ricelake.com/en-us/products/product-details/revolution-scale-software#/resources-downloads "Revolution Scale Software")
-   Click the "iRite: Build" button, this will initally generate an
    irite.settings.json file in your directory

### Linux / macOS (via Wine)

Revolution only ships for Windows. On Linux/macOS the extension runs the
build engine through [Wine](https://www.winehq.org/) instead:

1.  Install Wine (Debian/Ubuntu also needs the 32-bit architecture, since
    the engine is a 32-bit .NET binary):
    ```
    sudo dpkg --add-architecture i386
    sudo apt update
    sudo apt install wine
    ```
2.  `iRite_preprocessor.exe` is a .NET assembly, so it also needs
    [wine-mono](https://dl.winehq.org/wine/wine-mono/) — Debian/Ubuntu
    don't package it, so install the `.msi` manually:
    ```
    curl -LO https://dl.winehq.org/wine/wine-mono/11.2.0/wine-mono-11.2.0-x86.msi
    wine msiexec /i wine-mono-11.2.0-x86.msi /qn
    ```
3.  Copy the Revolution `iRite Editor` folder (`iRite_preprocessor.exe`,
    its dependency DLLs — `rlws.dll`, `log4net.dll`, `newtonsoft.json.dll`,
    etc. — and the `Compilers` folder) into your Wine prefix at the same
    relative path as the Windows default, so the extension's default
    settings work without any changes:
    ```
    ~/.wine/drive_c/Program Files (x86)/Rice Lake Weighing Systems/Revolution/iRite Editor/
    ```
    You do not need the full Revolution installer or `iriteeditor.exe` —
    only `iRite_preprocessor.exe`, its DLLs, and `Compilers/` are required
    for `irite.build`/`irite.deploy`.
4.  If you place the toolchain somewhere else, update `irite.build.enginePath`
    and `irite.build.compilerPath` in your VS Code settings to match. On
    Linux, filesystem paths are case-sensitive — make sure the casing
    matches the files on disk exactly.

### irite.settings.json

Defaults are established on build, but must be modified for which
indicator you are deploying to. \* method: TCP, RS232 \* indicator:
1280, 920, 880, 820 \* ipaddress: If using TCP connection \* tcpport: If
using TCP connection \* comport: If using RS232 \* baudrate: If using
RS232 \* databits: If using RS232 \* parity: If using RS232 \* stopbits:
If using RS232

Deployment
==========

-   Ensure the irite.settings.json file has been modified to your system
    specs and then click iRite: Deploy
