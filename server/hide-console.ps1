# Hides the console window that Task Scheduler / cmd opens for start-server.bat,
# so the sync server window cannot be closed (or Ctrl+C'd) by accident.
# Hiding the console does not stop the server - output goes to autostart.log.
Add-Type -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@ -Name Native -Namespace QCLauncher | Out-Null

$handle = [QCLauncher.Native]::GetConsoleWindow()
if ($handle -ne [IntPtr]::Zero) {
    # 0 = SW_HIDE
    [QCLauncher.Native]::ShowWindow($handle, 0) | Out-Null
}
