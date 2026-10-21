; Node.js is installed into the app folder while the exe installs, and FreeLM is
; started right after the files land, so the app opens with the server already
; running.
; The official MSI installs per-machine (Program Files + HKLM), which fails for
; the non-admin current-user installer this app ships. The portable win-x64 zip
; has the same node.exe and needs no elevation, so node.exe is pulled out of it.

!define NODE_VERSION "v24.22.0"
!define NODE_ZIP_URL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip"
!define NODE_REG_KEY "Software\Node.js"
!define FREELM_PORT "4000"
!define FREELM_API_KEY "freelm"

!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$INSTDIR\nodejs\node.exe"
    DetailPrint "Node.js is already installed, skipping."
    Goto node_done
  ${EndIf}

  ; A machine-wide Node from the official MSI is usable too.
  ReadRegStr $0 HKCU "${NODE_REG_KEY}" "InstallPath"
  ${If} $0 == ""
    ReadRegStr $0 HKLM "${NODE_REG_KEY}" "InstallPath"
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\node.exe"
    DetailPrint "Node.js is already installed, skipping."
    Goto node_done
  ${EndIf}

  DetailPrint "Downloading Node.js..."
  Delete "$TEMP\node-win-x64.zip"
  NSISdl::download /TIMEOUT=600000 "${NODE_ZIP_URL}" "$TEMP\node-win-x64.zip"
  Pop $1
  ${If} $1 != "success"
    MessageBox MB_ICONSTOP "Node.js 下载失败（$1）。请检查网络后重新安装。"
    Abort
  ${EndIf}

  DetailPrint "Installing Node.js..."
  CreateDirectory "$INSTDIR\nodejs"
  ; The paths go in as arguments so the script stays ASCII: the install folder
  ; is named in Chinese and NSIS writes files in the ANSI code page.
  FileOpen $4 "$TEMP\node-extract.ps1" w
  FileWrite $4 "param([string]$$Zip, [string]$$Dest)$\r$\n"
  FileWrite $4 "$$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $4 "Add-Type -AssemblyName System.IO.Compression.FileSystem$\r$\n"
  FileWrite $4 "$$archive = [System.IO.Compression.ZipFile]::OpenRead($$Zip)$\r$\n"
  FileWrite $4 "try {$\r$\n"
  FileWrite $4 "  $$entry = $$archive.Entries | Where-Object { $$_.FullName -like '*/node.exe' } | Select-Object -First 1$\r$\n"
  FileWrite $4 "  if (-not $$entry) { throw 'node.exe is missing from the archive' }$\r$\n"
  FileWrite $4 "  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($$entry, $$Dest, $$true)$\r$\n"
  FileWrite $4 "} finally {$\r$\n"
  FileWrite $4 "  $$archive.Dispose()$\r$\n"
  FileWrite $4 "}$\r$\n"
  FileClose $4
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$TEMP\node-extract.ps1" "$TEMP\node-win-x64.zip" "$INSTDIR\nodejs\node.exe"'
  Pop $2
  Pop $3
  Delete "$TEMP\node-extract.ps1"
  Delete "$TEMP\node-win-x64.zip"
  ${IfNot} ${FileExists} "$INSTDIR\nodejs\node.exe"
    DetailPrint "Node.js extract output: $3"
    MessageBox MB_ICONSTOP "Node.js 解压失败（退出码 $2）。请检查网络和磁盘空间后重新安装。"
    Abort
  ${EndIf}

  node_done:
!macroend

; Files are copied before this runs, so the bundled runtime is already in place.
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack 'powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:${FREELM_PORT}/health -TimeoutSec 2).StatusCode } catch { 0 }"'
  Pop $0
  Pop $1
  ${If} $1 == "200"
    DetailPrint "FreeLM is already running, skipping."
    Goto freelm_done
  ${EndIf}

  ; Node was installed into the app folder by the pre-install hook; a Node that
  ; was already on the machine is used as-is.
  StrCpy $2 "$INSTDIR\nodejs"
  ${IfNot} ${FileExists} "$2\node.exe"
    ReadRegStr $2 HKCU "${NODE_REG_KEY}" "InstallPath"
  ${EndIf}
  ${If} $2 == ""
  ${OrIfNot} ${FileExists} "$2\node.exe"
    ReadRegStr $2 HKLM "${NODE_REG_KEY}" "InstallPath"
  ${EndIf}
  ${If} $2 == ""
  ${OrIfNot} ${FileExists} "$2\node.exe"
    ReadEnvStr $2 ProgramFiles
    StrCpy $2 "$2\nodejs"
  ${EndIf}
  ${IfNot} ${FileExists} "$2\node.exe"
    MessageBox MB_ICONEXCLAMATION "已安装 Node.js，但没有找到 node.exe，FreeLM 没能启动。打开应用后会再试一次。"
    Goto freelm_done
  ${EndIf}

  StrCpy $3 "$INSTDIR\resources\freelm"
  ${IfNot} ${FileExists} "$3\node_modules\freelm\bin\freelm.mjs"
    DetailPrint "FreeLM runtime was not bundled, skipping."
    Goto freelm_done
  ${EndIf}

  DetailPrint "Starting FreeLM..."
  CreateDirectory "$LOCALAPPDATA\${BUNDLEID}"
  FileOpen $4 "$LOCALAPPDATA\${BUNDLEID}\freelm-start.cmd" w
  FileWrite $4 "@echo off$\r$\n"
  FileWrite $4 'cd /d "$3"$\r$\n'
  FileWrite $4 '"$2\node.exe" "$3\node_modules\freelm\bin\freelm.mjs" serve --host 127.0.0.1 --port ${FREELM_PORT} --api-key ${FREELM_API_KEY} --quiet >> "$LOCALAPPDATA\${BUNDLEID}\freelm.log" 2>&1$\r$\n'
  FileClose $4
  ; A detached process survives this installer and keeps serving after it closes.
  ; wmic is gone from current Windows 11 builds, so PowerShell does the launch.
  ; The batch file stays on disk because the new shell reads it as it starts.
  FileOpen $4 "$TEMP\freelm-launch.ps1" w
  FileWrite $4 "param([string]$$Cmd)$\r$\n"
  FileWrite $4 "Start-Process -WindowStyle Hidden -FilePath $$Cmd$\r$\n"
  FileClose $4
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$TEMP\freelm-launch.ps1" "$LOCALAPPDATA\${BUNDLEID}\freelm-start.cmd"'
  Pop $5
  Pop $6
  Delete "$TEMP\freelm-launch.ps1"
  ${If} $5 != 0
    DetailPrint "FreeLM did not start (exit code $5): $6. The app will start it on launch."
  ${EndIf}

  freelm_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The FreeLM server runs detached on this node.exe and would keep the file
  ; locked; stop the copies that belong to this install before deleting them.
  FileOpen $0 "$TEMP\node-stop.ps1" w
  FileWrite $0 "param([string]$$Node)$\r$\n"
  FileWrite $0 "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -eq $$Node } | Stop-Process -Force -ErrorAction SilentlyContinue$\r$\n"
  FileClose $0
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$TEMP\node-stop.ps1" "$INSTDIR\nodejs\node.exe"'
  Pop $0
  Pop $1
  Delete "$TEMP\node-stop.ps1"
  Sleep 500
  RMDir /r "$INSTDIR\nodejs"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WhooshRocket"
!macroend
