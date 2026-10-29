// Windows-only deterministic CLI substitute. It never contacts or installs a Docker engine.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export const fixtureIds = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]
export async function createDockerCliFixture(root: string): Promise<{ directory: string; state: string; context: string }> {
  const directory = join(root, 'cli'), state = join(directory, 'state.txt')
  await mkdir(directory, { recursive: true }); await writeFile(state, 'running\nrunning\nexited')
  const context = join(directory, 'context.txt'); await writeFile(context, 'npipe:////./pipe/dockerFixture')
  const literal = (value: string) => '@"' + value.replaceAll('"', '""') + '"'
  const rows = fixtureIds.map((ID, index) => ({ ID, Names: ['atlas-web', 'atlas-worker', 'local-db'][index], Image: ['nginx:alpine', 'node:22-alpine', 'postgres:17'][index], State: 'STATE', Status: 'STATUS', Labels: index < 2 ? 'com.docker.compose.project=atlas,com.docker.compose.service=' + (index ? 'worker' : 'web') : '', Ports: index === 0 ? '0.0.0.0:18080->80/tcp' : '' }))
  const source = `using System; using System.IO; using System.Threading; using System.Diagnostics;
class DockerFixture {
  static string statePath = ${literal(state)};
  static string[] ids = new string[] {${fixtureIds.map(literal).join(',')}};
  static string[] rows = new string[] {${rows.map(row => literal(JSON.stringify(row))).join(',')}};
  static int Main(string[] args) {
    if(args.Length == 0) return 1;
    if(args[0] == "context") { Console.WriteLine(args[1] == "show" ? "desktop-linux" : "[{\\"Endpoints\\":{\\"docker\\":{\\"Host\\":\\"" + File.ReadAllText(${literal(context)}) + "\\"}}}]"); return 0; }
    if(args.Length < 3 || args[0] != "--host" || args[1] != "npipe:////./pipe/dockerFixture") return 2;
    string cmd = args[2];
    if(cmd == "info") { Console.WriteLine(${literal('{"Name":"Fixture engine","ServerVersion":"28.0.0-fixture","OSType":"linux"}')}); return 0; }
    var states = File.ReadAllLines(statePath);
    if(cmd == "ps") { for(int i=0;i<ids.Length;i++) Console.WriteLine(rows[i].Replace("STATE",states[i]).Replace("STATUS",states[i] == "running" ? "Up 2 minutes" : "Exited (0)")); return 0; }
    if(cmd == "logs") { for(int i=0;;i++){ Console.WriteLine("2026-10-29T00:00:00Z fixture log " + i); Thread.Sleep(180); } }
    if(cmd == "exec") { Console.WriteLine("fixture-shell:" + Process.GetCurrentProcess().Id); string saved=""; string line;
      while((line=Console.ReadLine()) != null) { if(line == "exit") break; if(line.StartsWith("remember ")) saved=line.Substring(9); if(line == "recall") Console.WriteLine("retained:"+saved); else Console.WriteLine("fixture:"+line); } return 0; }
    int index=Array.IndexOf(ids,args[args.Length-1]); if(index<0) return 3;
    if(cmd == "start" || cmd == "restart") states[index]="running"; else if(cmd == "stop") states[index]="exited"; else return 4;
    File.WriteAllLines(statePath,states); Console.WriteLine(ids[index]); return 0;
  }
}`
  await writeFile(join(directory, 'fixture.cs'), source)
  execFileSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', ['/nologo', '/target:exe', '/out:' + join(directory, 'docker.exe'), join(directory, 'fixture.cs')], { windowsHide: true, stdio: 'pipe' })
  return { directory, state, context }
}
