/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */

/** Quote one argv item using the Windows CommandLineToArgvW / CRT convention. */
export function quoteWindowsArgument(value: string): string {
  return (
    '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
  );
}

/**
 * The supervisor owns a non-inheritable, kill-on-close Windows Job Object.
 * Its stdin is a private lifetime lease from the desktop process, not app input.
 * User commands are data (base64 UTF-16), never PowerShell source.
 */
export function windowsJobScript(
  command: string,
  args: string[],
  marker: string,
): string {
  if (!/^[a-zA-Z0-9-]+$/.test(marker))
    throw new Error('Invalid process marker.');
  const commandLine = [command, ...args].map(quoteWindowsArgument).join(' ');
  if (commandLine.includes('\0'))
    throw new Error('Process arguments cannot contain NUL.');
  if (commandLine.length >= 32767)
    throw new Error('Windows command line is too long.');
  const encoded = Buffer.from(commandLine, 'utf16le').toString('base64');
  return `$ErrorActionPreference = 'Stop'
try {
Add-Type -WarningAction SilentlyContinue -TypeDefinition @'
using System;
using System.Text;
using System.IO;
using System.Threading;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class OwnedJob {
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS {
    public long processTime, jobTime; public uint flags; public UIntPtr minWorkingSet, maxWorkingSet;
    public uint activeProcesses; public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS {
    public BASIC_LIMITS basic; public IO_COUNTERS io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public uint cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort show,reservedSize;
    public IntPtr reservedBytes, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public uint pid, tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref EXTENDED_LIMITS info, uint size);
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr attributes; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int number);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr attributes, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static int Run(string command, string ready) {
    IntPtr job = IntPtr.Zero, input = new IntPtr(-1);
    PROCESS_INFORMATION child = new PROCESS_INFORMATION();
    IntPtr attributes = IntPtr.Zero, jobValue = IntPtr.Zero;
    bool attributesReady = false;
    using (var leaseEnded = new EventWaitHandle(false, EventResetMode.ManualReset)) {
      var monitor = new Thread(() => {
        try { using (Stream stream = Console.OpenStandardInput()) { while (stream.ReadByte() != -1) {} } } catch (IOException) {}
        try { leaseEnded.Set(); } catch (ObjectDisposedException) {}
      });
      monitor.IsBackground = true;
      monitor.Start();
      try {
        job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
        var limits = new EXTENDED_LIMITS(); limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)));
        input = CreateFile("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        Check(input != new IntPtr(-1));
        var startup = new STARTUPINFOEX(); startup.startup.cb = (uint)Marshal.SizeOf(startup); startup.startup.flags = 0x100;
        startup.startup.input = input; startup.startup.output = GetStdHandle(-11); startup.startup.error = GetStdHandle(-12);
        Check(SetHandleInformation(input, 1, 1));
        Check(SetHandleInformation(startup.startup.output, 1, 1)); Check(SetHandleInformation(startup.startup.error, 1, 1));
        if (leaseEnded.WaitOne(0)) return 1;
        IntPtr size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        attributes = Marshal.AllocHGlobal(size);
        Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); attributesReady = true;
        jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
        // PROC_THREAD_ATTRIBUTE_JOB_LIST assigns ownership atomically during creation.
        Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
        startup.attributes = attributes;
        Check(CreateProcess(null, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true,
          0x08080004, IntPtr.Zero, null, ref startup, out child)); // NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | SUSPENDED
        if (leaseEnded.WaitOne(0)) return 1;
        Console.WriteLine(ready); Console.Out.Flush();
        Check(ResumeThread(child.thread) != 0xffffffff);
        uint wait = WaitForMultipleObjects(2, new IntPtr[] { child.process, leaseEnded.SafeWaitHandle.DangerousGetHandle() }, false, 0xffffffff);
        if (wait == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (wait != 0) return 1;
        uint code; Check(GetExitCodeProcess(child.process, out code)); return unchecked((int)code);
      } finally {
        if (attributesReady) DeleteProcThreadAttributeList(attributes);
        if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
        if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
        if (job != IntPtr.Zero) CloseHandle(job);
        if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
        if (child.process != IntPtr.Zero) CloseHandle(child.process);
        if (input != new IntPtr(-1)) CloseHandle(input);
      }
    }
  }
}
'@
$command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))
exit ([OwnedJob]::Run($command, 'SLR_JOB_READY_${marker}'))
} catch {
[Console]::Error.WriteLine('Could not start managed process: ' + $_.Exception.Message)
exit 1
}
`;
}
