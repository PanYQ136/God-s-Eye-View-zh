' Hidden launcher for the gods-eye-view backend (runs at logon via Task Scheduler).
' HOST=0.0.0.0 + PORT=4173 so the phone can reach it over LAN / Tailscale.
' NODE_USE_ENV_PROXY=1 makes Node 24 global fetch honor HTTP(S)_PROXY; without it
' upstreams such as Nominatim are unreachable from CN (geocode/search returns 503).
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\Hermes\gods-eye-view"
WshShell.Run "cmd /c ""D:\Hermes\gods-eye-view\start-dev.cmd""", 0, False
