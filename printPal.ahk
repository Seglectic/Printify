#Requires AutoHotkey v2.0

; Watches the downloads folder for
; commonly printed files and sends them
; to Printify with printChan.py

; File path to watch
; Get users home directory:
; MsgBox % A_Home
watchPath := A_Home "\Downloads"
MsgBox % watchPath