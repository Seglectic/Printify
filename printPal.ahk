#Requires AutoHotkey v2.0

; Watches the downloads folder for
; commonly printed files and sends them
; to Printify with printChan.py

watchPath := A_Home "\Downloads"
Msgbox 