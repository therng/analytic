' Hidden launcher for the analytic-bridge scheduled task — window style 0
' (no console flash at logon). bWaitOnReturn=True keeps wscript alive so the
' task stays Running and schtasks /End still takes the whole tree down
' (wscript -> powershell -> cmd -> python). Exit code propagates for
' Last Task Result. Deploys reach the host via git pull like every other
' repo file.
Set sh = CreateObject("WScript.Shell")
rc = sh.Run("powershell -NoProfile -ExecutionPolicy Bypass -File ""C:\analytic\bridge\scripts\run-bridge-task.ps1""", 0, True)
WScript.Quit rc
