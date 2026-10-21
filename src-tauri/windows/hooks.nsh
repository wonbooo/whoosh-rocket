; Node.js is installed while the exe installs, and FreeLM is started right after
; the files land, so the app opens with the server already running.
; The current-user installer has no admin rights, so the Node check only looks at
; HKCU and installs for the current user (ALLUSERS=). A machine-wide Node shows up
; in the app's own PATH check at launch, so a missing HKCU entry just means Node
; gets installed twice at worst, never that the install is blocked.

!define NODE_MSI_URL "https://nodejs.org/dist/v24.22.0/node-v24.22.0-x64.msi"
!define NODE_REG_KEY "Software\Node.js"
!define FREELM_PORT "4000"
!define FREELM_API_KEY "freelm"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKCU "${NODE_REG_KEY}" "InstallPath"
  ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\node.exe"
      DetailPrint "Node.js is already installed, skipping."
      Goto node_done
  ${EndIf}

  DetailPrint "Downloading Node.js..."
  Delete "$TEMP\node-setup.msi"
  NSISdl::download /TIMEOUT=300000 "${NODE_MSI_URL}" "$TEMP\node-setup.msi"
  Pop $1
  ${If} $1 != "success"
    MessageBox MB_ICONSTOP "Node.js 下载失败（$1）。请检查网络后重新安装。"
    Abort
  ${EndIf}

  DetailPrint "Installing Node.js..."
  ExecWait 'msiexec /i "$TEMP\node-setup.msi" /qn /norestart ALLUSERS= ADDLOCAL=ALL' $2
  Delete "$TEMP\node-setup.msi"
  ${If} $2 != 0
    MessageBox MB_ICONSTOP "Node.js 安装失败（退出码 $2）。"
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

  ; Node's MSI adds itself to PATH, but this installer process keeps the PATH it
  ; started with, so the freshly installed node.exe has to be named in full.
  ReadRegStr $2 HKCU "${NODE_REG_KEY}" "InstallPath"
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
  nsExec::Exec 'wmic process call create "$LOCALAPPDATA\${BUNDLEID}\freelm-start.cmd"'
  Pop $5
  Delete "$LOCALAPPDATA\${BUNDLEID}\freelm-start.cmd"
  ${If} $5 != 0
    DetailPrint "FreeLM did not start (exit code $5). The app will start it on launch."
  ${EndIf}

  freelm_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WhooshRocket"
!macroend
