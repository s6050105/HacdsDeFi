; 安装语言 → 应用首次启动语言的桥接。
; electron-builder 的多语言安装器在安装时把语言号写到注册表
; HKCU\Software\HacdsDeFiConsole\InstallerLanguage；应用首启读取它作为
; 默认界面语言（仅当用户尚未在应用内自行选择过语言时生效）。
!macro customInstall
  WriteRegStr HKCU "Software\HacdsDeFiConsole" "InstallerLanguage" "$LANGUAGE"
!macroend
!macro customUnInstall
  DeleteRegValue HKCU "Software\HacdsDeFiConsole" "InstallerLanguage"
!macroend
