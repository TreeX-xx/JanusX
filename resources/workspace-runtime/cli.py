"""Per-user Linux CLI discovery and durable installation. No daemon restart needed."""
import fcntl
import glob
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time

BASE = pathlib.Path.home() / '.local/share/janusx/agents'
TOOLS = {'claude', 'codex', 'opencode', 'janus', 'pi', 'dsh'}


def environment(tool):
    env = dict(os.environ)
    home = pathlib.Path.home()
    paths = []
    shell = env.get('SHELL', '/bin/sh')
    try:
        result = subprocess.run([shell, '-lc', 'printf "\\0JANUSX_PATH\\0%s\\0" "$PATH"'],
                                env=env, capture_output=True, timeout=5)
        parts = result.stdout.split(b'\0JANUSX_PATH\0')
        if len(parts) > 1:
            paths = parts[-1].split(b'\0')[0].decode().split(':')
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        pass
    known = [str(home / p) for p in ('.local/bin', '.npm-global/bin', '.volta/bin', '.bun/bin', '.opencode/bin')]
    nvm = sorted(glob.glob(str(home / '.nvm/versions/node/*/bin')),
                 key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p)), reverse=True)
    candidates = [str(BASE / tool / 'bin'), str(home / '.local/share/janusx/runtime-v1/node/bin'),
                  *paths, *env.get('PATH', '').split(':'), *known, *nvm, '/usr/local/bin', '/usr/bin', '/bin']
    # WSL may inherit the Windows PATH. Never launch a Windows npm/agent for a Linux workspace.
    env['PATH'] = ':'.join(dict.fromkeys(p for p in candidates if p.startswith('/') and not re.match(r'^/mnt/[a-zA-Z]/', p)))
    return env


def locate(tool):
    env = environment(tool)
    executable = shutil.which(tool, path=env['PATH'])
    result = dict(installed=False, environment=f'{os.environ.get("USER", "user")}@{platform.node()}',
                  architecture=platform.machine(), platform=sys.platform,
                  libc=list(platform.libc_ver()), nodeMajor=0,
                  node=shutil.which('node', path=env['PATH']), npm=shutil.which('npm', path=env['PATH']))
    if result['node']:
        check = subprocess.run([result['node'], '--version'], env=env, capture_output=True, timeout=10)
        match = re.match(rb'v(\d+)', check.stdout.strip())
        if check.returncode == 0 and match:
            result['nodeMajor'] = int(match[1])
    if executable:
        check = subprocess.run([executable, '--version'], env=env, cwd=str(pathlib.Path.home()),
                               capture_output=True, timeout=20)
        if check.returncode:
            raise ValueError(f'{tool} exists but cannot run: ' + (check.stderr or check.stdout).decode(errors='replace')[-1500:])
        result.update(installed=True, executable=executable)
    return result


def save(path, state):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        json.dump(state, stream)
        temporary = stream.name
    os.replace(temporary, path)


def read_status(tool):
    directory = BASE / tool
    statefile = directory / 'install.json'
    if not statefile.exists():
        return dict(state='idle', log='')
    state = json.loads(statefile.read_text())
    log = directory / 'install.log'
    if log.exists():
        with log.open('rb') as stream:
            stream.seek(max(0, log.stat().st_size - 4000))
            state['log'] = stream.read(4000).decode(errors='replace')
    if state['state'] == 'running':
        with (directory / 'install.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                state.update(state='failed', error='Installation was interrupted. Retry to continue.')
            except BlockingIOError:
                pass
    return state


def worker(tool, packages, lockfd):
    directory = BASE / tool
    statefile = directory / 'install.json'
    try:
        env = environment(tool)
        npm = shutil.which('npm', path=env['PATH'])
        if not npm:
            raise ValueError('Node.js and npm are unavailable in this Linux environment.')
        env.update(npm_config_update_notifier='false', npm_config_fund='false', npm_config_audit='false', npm_config_engine_strict='true')
        print('Installing ' + tool + ' for ' + str(pathlib.Path.home()), flush=True)
        process = subprocess.Popen([npm, 'install', '--global', '--prefix', str(directory), *packages],
                                   cwd=str(directory), env=env, start_new_session=True)
        try:
            code = process.wait(timeout=900)
        except subprocess.TimeoutExpired:
            import signal
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise ValueError('Installation timed out. Check the target network and retry.')
        if code:
            raise ValueError(f'Installer exited ({code}). See installation output.')
        result = locate(tool)
        if not result['installed']:
            raise ValueError('Installer finished but the CLI executable was not found.')
        save(statefile, dict(state='complete', installed=True))
        print('Ready: ' + result['executable'], flush=True)
    except Exception as error:
        save(statefile, dict(state='failed', error=str(error)))
        print(str(error), flush=True)
    finally:
        os.close(lockfd)


def start(tool, packages):
    if sys.platform != 'linux':
        raise ValueError('Automatic installation requires Linux.')
    if platform.machine() not in ('x86_64', 'aarch64', 'arm64'):
        raise ValueError('Unsupported Linux architecture: ' + platform.machine())
    directory = BASE / tool
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (directory / 'install.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return read_status(tool)
    try:
        save(directory / 'install.json', dict(state='running', startedAt=time.time()))
        with (directory / 'install.log').open('w') as output:
            subprocess.Popen([sys.executable, __file__, '--worker', tool, json.dumps(packages), str(lock.fileno())],
                             stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                             start_new_session=True, pass_fds=(lock.fileno(),))
        return dict(state='running', log='')
    finally:
        lock.close()


if __name__ == '__main__':
    if sys.argv[1] == '--worker':
        worker(sys.argv[2], json.loads(sys.argv[3]), int(sys.argv[4]))
    elif sys.argv[1] == '--launch':
        tool = sys.argv[2]
        if tool not in TOOLS:
            raise ValueError('Unsupported CLI')
        env = environment(tool)
        os.execvpe(tool, [tool, *sys.argv[3:]], env)
    else:
        try:
            request = json.load(sys.stdin)
            tool = request['tool']
            if tool not in TOOLS:
                raise ValueError('Unsupported CLI')
            method = request['method']
            result = locate(tool) if method == 'detect' else read_status(tool) if method == 'status' else start(tool, request['packages']) if method == 'install' else None
            if result is None:
                raise ValueError('Unsupported operation')
            print(json.dumps(result))
        except Exception as error:
            print(str(error), file=sys.stderr)
            sys.exit(1)
