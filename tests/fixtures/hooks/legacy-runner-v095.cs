using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
public static class JanusxHookRunner {
  private const int MaxStdinBytes = 4194304;
  private const int WaitMs = 10000;
  public static int Main(string[] args) {
    try {
      if (args == null || args.Length < 4) return 0;
      string script = args[0];
      if (string.IsNullOrWhiteSpace(script) || !File.Exists(script)) return 0;
      char q = (char)34;
      StringBuilder sb = new StringBuilder();
      sb.Append("-NoProfile -ExecutionPolicy Bypass -File ");
      sb.Append(q).Append(script).Append(q);
      sb.Append(" -Source ").Append(q).Append(Clean(args[1])).Append(q);
      sb.Append(" -EventName ").Append(q).Append(Clean(args[2])).Append(q);
      sb.Append(" -Marker ").Append(q).Append(Clean(args[3])).Append(q);
      if (args.Length > 4 && !string.IsNullOrWhiteSpace(args[4])) {
        sb.Append(" -Matcher ").Append(q).Append(Clean(args[4])).Append(q);
      }
      byte[] input = ReadStdin();
      ProcessStartInfo psi = new ProcessStartInfo();
      psi.FileName = "powershell.exe";
      psi.Arguments = sb.ToString();
      psi.CreateNoWindow = true;
      psi.UseShellExecute = false;
      psi.RedirectStandardInput = true;
      psi.RedirectStandardOutput = true;
      psi.RedirectStandardError = true;
      using (Process p = Process.Start(psi)) {
        if (p == null) return 0;
        try { p.StandardInput.BaseStream.Write(input, 0, input.Length); } catch { }
        try { p.StandardInput.Close(); } catch { }
        Thread drain = new Thread(delegate() { try { p.StandardOutput.ReadToEnd(); } catch { } });
        drain.IsBackground = true;
        drain.Start();
        try { p.StandardError.ReadToEnd(); } catch { }
        if (!p.WaitForExit(WaitMs)) { try { p.Kill(); } catch { } }
      }
    } catch { }
    return 0;
  }
  private static string Clean(string v) {
    if (v == null) return string.Empty;
    StringBuilder sb = new StringBuilder(v.Length);
    foreach (char c in v) { if (c != (char)34) sb.Append(c); }
    return sb.ToString();
  }
  private static byte[] ReadStdin() {
    using (MemoryStream ms = new MemoryStream()) {
      Stream stdin = Console.OpenStandardInput();
      byte[] buf = new byte[8192];
      int total = 0;
      while (total < MaxStdinBytes) {
        int n = stdin.Read(buf, 0, Math.Min(buf.Length, MaxStdinBytes - total));
        if (n <= 0) break;
        ms.Write(buf, 0, n);
        total += n;
      }
      return ms.ToArray();
    }
  }
}
