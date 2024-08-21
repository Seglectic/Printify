#Requires AutoHotkey v2.0

; Watches the downloads folder for
; commonly printed files and sends them
; to Printify with printChan.py

; //TODO Translate printChan.py to work on windows with this script

watchPath := A_Home "\Downloads"
Msgbox 