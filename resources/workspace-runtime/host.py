#!/usr/bin/env python3
"""JanusX Linux workspace host. Private Unix socket; no network listener.

The daemon owns PTYs independently of the SSH/WSL transport. Disconnecting a
client never sends a signal to those processes. Only terminal.end does that.
See .agents/notes/sessions/workspace-runtime-import.md.
"""
import base64
import collections
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import platform
import re
import pty
import select
import selectors
import shutil
import signal
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time

PROTOCOL = 3
MAX_FRAME = 48 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024
MAX_OUTPUT = 4 * 1024 * 1024
BASE = pathlib.Path(os.environ.get('JANUSX_RUNTIME_HOME', '~/.local/share/janusx/runtime-v1')).expanduser()
SOCKET = BASE / 'host.sock'
WRITE_LOCK = threading.RLock()
TERMINALS = {}
TERMINALS_LOCK = threading.RLock()
PROCESSES = {}
PROCESS_LOCK = threading.RLock()
CANCELLED = {}
BACKEND = None
BACKEND_VERSION = None
BACKEND_UNCERTAIN = False
BACKEND_LOCK = threading.RLock()


def backend_request(data):
    global BACKEND, BACKEND_VERSION, BACKEND_UNCERTAIN
    with BACKEND_LOCK:
        if BACKEND_UNCERTAIN:
            raise ValueError('A previous backend operation has an unknown outcome; inspect the target before restarting its backend')
        digest = hashlib.sha256((BASE / 'backend.cjs').read_bytes()).hexdigest()
        if BACKEND is not None and BACKEND_VERSION != digest and BACKEND.poll() is None:
            # The lock guarantees the previous transaction has completed. Only
            # replace the document worker; persistent terminals are unaffected.
            BACKEND.stdin.close()
            try:
                BACKEND.wait(timeout=5)
            except subprocess.TimeoutExpired:
                BACKEND.terminate()
                BACKEND.wait(timeout=5)
        if BACKEND is None or BACKEND.poll() is not None:
            node = BASE / 'node' / 'bin' / 'node'
            if not node.exists():
                raise ValueError('Workspace backend runtime is not installed')
            BACKEND = subprocess.Popen([str(node), str(BASE / 'backend.cjs')], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
            BACKEND_VERSION = digest
        request = dict(data, root=str(safe(data['root'], data.get('path', ''))), id=1)
        BACKEND.stdin.write(json.dumps(request) + '\n')
        BACKEND.stdin.flush()
        ready, _, _ = select.select([BACKEND.stdout], [], [], 120)
        if not ready:
            # Do not retry a write with an unknown outcome.
            BACKEND_UNCERTAIN = True
            raise ValueError('Workspace backend timed out; inspect the target before repeating a write')
        line = BACKEND.stdout.readline(MAX_FRAME + 1)
        if not line or len(line) > MAX_FRAME:
            raise ValueError('Workspace backend disconnected or returned an oversized response')
        reply = json.loads(line)
        if reply.get('error'):
            error = reply['error']
            raise ValueError(str(error.get('code', 'IO_ERROR')) + ': ' + error['message'])
        return reply.get('result')


def stop_process(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_process(data, target):
    argv = data['argv']
    if not isinstance(argv, list) or not argv or any(not isinstance(arg, str) or '\x00' in arg for arg in argv):
        raise ValueError('Invalid process arguments')
    identity = data.get('operationId')
    limit = min(MAX_FILE, max(1, int(data.get('maxBytes', MAX_FILE))))
    timeout = min(120, max(.1, float(data.get('timeout', 15))))
    with PROCESS_LOCK:
        for key, expiry in list(CANCELLED.items()):
            if expiry < time.monotonic():
                del CANCELLED[key]
        if identity and identity in CANCELLED:
            raise ValueError('Process cancelled')
        process = subprocess.Popen(argv, cwd=target, env={**os.environ, **data.get('env', {})},
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True)
        if identity:
            PROCESSES[identity] = process
    output, errors = bytearray(), bytearray()
    truncated = False
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, (output, limit))
            selector.register(process.stderr, selectors.EVENT_READ, (errors, 65536))
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise TimeoutError('Process timed out')
                with PROCESS_LOCK:
                    if identity and identity in CANCELLED:
                        raise ValueError('Process cancelled')
                for key, _ in selector.select(.1):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    buffer, budget = key.data
                    remaining = max(0, budget - len(buffer))
                    buffer.extend(chunk[:remaining])
                    if len(chunk) > remaining and buffer is output:
                        truncated = True
                        if not data.get('truncate'):
                            raise ValueError('Process output exceeds the limit')
            code = process.wait(timeout=max(.01, deadline - time.monotonic()))
        return dict(stdout=output.decode('utf8', 'replace'), stderr=errors.decode('utf8', 'replace'),
                    exitCode=code, truncated=truncated)
    finally:
        # Reap descendants too if they retain inherited output pipes.
        stop_process(process)
        process.wait()
        process.stdout.close()
        process.stderr.close()
        with PROCESS_LOCK:
            if identity:
                PROCESSES.pop(identity, None)
                CANCELLED.pop(identity, None)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def safe(root, relative='', allow_root=True):
    root = pathlib.Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Workspace root is not a directory')
    relative = pathlib.PurePosixPath(relative)
    if relative.is_absolute() or '..' in relative.parts or '\x00' in str(relative):
        raise ValueError('Invalid workspace-relative path')
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or (not allow_root and target == root):
        raise ValueError('Path is outside the workspace')
    return target


def read_bytes(path, limit=MAX_FILE):
    with open(path, 'rb') as source:
        data = source.read(limit + 1)
    if len(data) > limit:
        raise ValueError('File exceeds the read limit')
    return data


def version(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(path, data):
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, temporary = tempfile.mkstemp(prefix='.janusx-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class Terminal:
    def __init__(self, data):
        self.id = data['id']
        self.workspace = data['workspaceId']
        self.preset = data.get('preset', 'shell')
        self.cwd = str(pathlib.Path(data['cwd']).resolve(strict=True))
        self.argv = data.get('argv') or [os.environ.get('SHELL', '/bin/sh'), '-l']
        self.cols = max(2, min(1000, int(data.get('cols', 120))))
        self.rows = max(1, min(1000, int(data.get('rows', 40))))
        self.created = now()
        self.exit = None
        self.sequence = 0
        self.output = collections.deque()
        self.size = 0
        self.lock = threading.RLock()
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', self.rows, self.cols, 0, 0))
        env = {**os.environ, 'TERM': 'xterm-256color', 'TERM_PROGRAM': 'JanusX'}
        env.update(data.get('env', {}))

        try:
            # Never run Python preexec_fn in this multithreaded daemon. A fresh
            # interpreter sets the controlling tty after setsid, then execs.
            launcher = 'import fcntl,os,sys,termios; fcntl.ioctl(0,termios.TIOCSCTTY,0); os.execvpe(sys.argv[1],sys.argv[1:],os.environ)'
            self.process = subprocess.Popen([sys.executable, '-c', launcher, *self.argv], cwd=self.cwd, env=env,
                                            stdin=slave, stdout=slave, stderr=slave,
                                            start_new_session=True, close_fds=True)
        except Exception:
            os.close(master)
            raise
        finally:
            os.close(slave)
        self.fd = master
        threading.Thread(target=self.drain, daemon=True).start()

    def drain(self):
        try:
            while True:
                ready, _, _ = select.select([self.fd], [], [], 0.5)
                if not ready:
                    if self.process.poll() is not None:
                        break
                    continue
                chunk = os.read(self.fd, 65536)
                if not chunk:
                    break
                with self.lock:
                    self.sequence += 1
                    self.output.append((self.sequence, chunk))
                    self.size += len(chunk)
                    while self.size > MAX_OUTPUT and len(self.output) > 1:
                        self.size -= len(self.output.popleft()[1])
        except OSError:
            pass
        finally:
            code = self.process.wait()
            self.exit = code if code >= 0 else 128 - code
            try:
                os.close(self.fd)
            except OSError:
                pass

    def summary(self):
        return dict(id=self.id, workspaceId=self.workspace, cwd=self.cwd, argv=self.argv, preset=self.preset,
                    pid=self.process.pid, cols=self.cols, rows=self.rows, exitCode=self.exit,
                    sequence=self.sequence, createdAt=self.created)

    def poll(self, after):
        with self.lock:
            chunks = [(seq, value) for seq, value in self.output if seq > after]
            return dict(**self.summary(), data=base64.b64encode(b''.join(value for _, value in chunks)).decode(),
                        truncated=bool(self.output and after and after < self.output[0][0] - 1))


def directory(path, root=None):
    path = pathlib.Path(path).expanduser().resolve(strict=True)
    entries = []
    for entry in sorted(path.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold())):
        if len(entries) >= 10000:
            raise ValueError('Directory contains too many entries; use a narrower directory')
        if root is not None and not entry.resolve().is_relative_to(root):
            continue
        item = dict(name=entry.name, path=str(entry), directory=entry.is_dir())
        if root is not None:
            item.update(path=entry.relative_to(root).as_posix(), type='directory' if entry.is_dir() else 'file')
            if entry.is_dir():
                item.update(hasChildren=True, loaded=False)
        entries.append(item)
    return dict(path=str(path), entries=entries)


def git_worktrees(root):
    result = run_process(dict(argv=['git', 'worktree', 'list', '--porcelain', '-z']), root)
    if result['exitCode'] != 0:
        raise ValueError(result['stderr'].strip() or 'Unable to read Git worktrees')
    entries, item = [], None
    for field in result['stdout'].split('\x00'):
        if field.startswith('worktree '):
            item = dict(path=field[9:], branch=None, detached=False, locked=False, prunable=False, bare=False)
            entries.append(item)
        elif item is not None:
            if field.startswith('branch '):
                item['branch'] = field[7:].removeprefix('refs/heads/')
            elif field.split(' ', 1)[0] in {'detached', 'locked', 'prunable', 'bare'}:
                item[field.split(' ', 1)[0]] = True
    return entries


def scoped_root(root, requested):
    root = pathlib.Path(root).resolve(strict=True)
    requested = pathlib.Path(requested).resolve()
    if requested.is_relative_to(root):
        return root
    matches = []
    for item in git_worktrees(root):
        candidate = pathlib.Path(item['path'])
        if item['bare'] or item['prunable'] or not candidate.is_dir():
            continue
        candidate = candidate.resolve(strict=True)
        if requested.is_relative_to(candidate):
            matches.append(candidate)
    if not matches:
        raise ValueError('Directory is not a registered workspace or Git worktree')
    return max(matches, key=lambda path: len(str(path)))


def worktree_operation(method, data):
    root = pathlib.Path(data['root']).resolve(strict=True)
    if method == 'worktree.list':
        try:
            return git_worktrees(root)
        except ValueError as error:
            if 'not a git repository' in str(error).lower():
                return [dict(path=str(root), branch=None, detached=False, locked=False, prunable=False, bare=False)]
            raise
    if method == 'worktree.create':
        name = data['name'].strip()
        if not name:
            raise ValueError('Worktree name is required')
        slug = re.sub('[^a-z0-9-]', '-', name.lower()).strip('-')[:64] or 'worktree'
        branch = data.get('branch') or slug
        start = data.get('startFrom') or 'origin/main'
        checked = run_process(dict(argv=['git', 'check-ref-format', '--branch', branch]), root)
        if checked['exitCode']:
            raise ValueError('Invalid branch name')
        path = root.parent / (root.name + '-' + slug)
        attempt = 2
        while path.exists() or path.is_symlink():
            path = root.parent / (root.name + '-' + slug + '-' + str(attempt))
            attempt += 1
        result = run_process(dict(argv=['git', 'worktree', 'add', '-b', branch, '--', str(path), start],
                                  operationId=data.get('operationId'), timeout=120), root)
        if result['exitCode']:
            raise ValueError(result['stderr'].strip() or 'Worktree creation failed or was cancelled')
        return dict(path=str(path), branch=branch)
    if method == 'worktree.remove':
        target = pathlib.Path(data['target']).resolve()
        entries = git_worktrees(root)
        if target == root or (entries and target == pathlib.Path(entries[0]['path']).resolve()):
            raise ValueError('The primary workspace cannot be removed')
        entry = next((item for item in entries if not item['bare'] and pathlib.Path(item['path']).resolve() == target), None)
        if not entry:
            raise ValueError('Refusing to delete an unregistered worktree')
        with TERMINALS_LOCK:
            if any(item.exit is None and pathlib.Path(item.cwd).is_relative_to(target) for item in TERMINALS.values()):
                raise ValueError('End running terminals in this worktree before removing it')
        argv = ['git', 'worktree', 'remove'] + (['--force'] if data.get('force') else []) + ['--', str(target)]
        result = run_process(dict(argv=argv, timeout=120), root)
        if result['exitCode']:
            raise ValueError(result['stderr'].strip() or 'Worktree removal failed')
        branch = entry['branch']
        deleted = bool(branch and run_process(dict(argv=['git', 'branch', '-d', '--', branch]), root)['exitCode'] == 0)
        return dict(path=str(target), branch=branch, branchDeleted=deleted, **({'branchKept': branch} if branch and not deleted else {}))
    raise ValueError('Unsupported worktree operation')


def dispatch(method, data):
    if method == 'backend.request':
        return backend_request(data)
    if method == 'hello':
        return dict(protocol=PROTOCOL, home=str(pathlib.Path.home()), platform=sys.platform,
                    architecture=platform.machine(), python=platform.python_version(), git=bool(shutil.which('git')))
    if method == 'browse':
        return directory(data.get('path') or str(pathlib.Path.home()))
    if method == 'scope.resolve':
        root = scoped_root(data['root'], data['path'])
        return dict(root=str(root), path=str(pathlib.Path(data['path']).resolve()))
    if method.startswith('worktree.'):
        return worktree_operation(method, data)
    if method == 'process.cancel':
        identity = data['operationId']
        if not isinstance(identity, str) or not 1 <= len(identity) <= 160:
            raise ValueError('Invalid process identity')
        with PROCESS_LOCK:
            if len(CANCELLED) >= 1024:
                raise ValueError('Too many cancellations')
            CANCELLED[identity] = time.monotonic() + 130
            process = PROCESSES.get(identity)
            if process:
                stop_process(process)
        return True
    if method.startswith('terminal.'):
        with TERMINALS_LOCK:
            if method == 'terminal.list':
                return [item.summary() for item in TERMINALS.values() if item.workspace == data['workspaceId']]
            identity = data['id']
            if not isinstance(identity, str) or not identity or len(identity) > 160:
                raise ValueError('Invalid terminal id')
            if method == 'terminal.create':
                existing = TERMINALS.get(identity)
                if existing:
                    if existing.workspace != data['workspaceId'] or existing.cwd != str(pathlib.Path(data['cwd']).resolve()):
                        raise ValueError('Terminal identity belongs to another workspace or directory')
                    return existing.summary()
                if sum(item.exit is None for item in TERMINALS.values()) >= 64:
                    raise ValueError('Too many running remote terminals')
                if data.get('attachOnly'):
                    raise ValueError('Remote terminal no longer exists; start a new terminal explicitly')
                terminal = Terminal(data)
                TERMINALS[identity] = terminal
                return terminal.summary()
            terminal = TERMINALS.get(identity)
        if terminal is None or terminal.workspace != data['workspaceId']:
            raise ValueError('Remote terminal is unavailable')
        if method == 'terminal.poll':
            return terminal.poll(max(0, int(data.get('after', 0))))
        if method == 'terminal.write':
            payload = base64.b64decode(data['data'], validate=True)
            if len(payload) > 1024 * 1024:
                raise ValueError('Terminal input is too large')
            if terminal.exit is not None:
                raise ValueError('Terminal has exited')
            os.write(terminal.fd, payload)
            return True
        if method == 'terminal.resize':
            terminal.cols = max(2, min(1000, int(data['cols'])))
            terminal.rows = max(1, min(1000, int(data['rows'])))
            if terminal.exit is None:
                fcntl.ioctl(terminal.fd, termios.TIOCSWINSZ, struct.pack('HHHH', terminal.rows, terminal.cols, 0, 0))
            return True
        if method == 'terminal.end':
            if terminal.exit is None:
                # Interactive shells can ignore SIGTERM and give jobs their
                # own process group. End every process in this PTY's session.
                session_id = terminal.process.pid
                def terminate_session(sig):
                    for item in pathlib.Path('/proc').iterdir():
                        if not item.name.isdigit():
                            continue
                        try:
                            pid = int(item.name)
                            if os.getsid(pid) == session_id:
                                os.kill(pid, sig)
                        except (ProcessLookupError, PermissionError):
                            pass
                terminate_session(signal.SIGTERM)
                def finish():
                    time.sleep(1)
                    terminate_session(signal.SIGKILL)
                threading.Thread(target=finish, daemon=True).start()
            return True
        raise ValueError('Unsupported terminal operation')
    root = pathlib.Path(data['root']).resolve(strict=True)
    target = safe(root, data.get('path', ''))
    if method == 'fs.list':
        return directory(target, root)['entries']
    if method == 'fs.stat':
        info = target.stat()
        return dict(size=info.st_size, mtime=info.st_mtime * 1000, isFile=target.is_file(), isDirectory=target.is_dir())
    if method == 'fs.read':
        raw = read_bytes(target)
        return dict(content=raw.decode('utf8'), size=len(raw), mtime=target.stat().st_mtime * 1000,
                    encoding='utf-8', version=version(raw))
    if method == 'fs.binary':
        raw = read_bytes(target)
        return dict(base64=base64.b64encode(raw).decode(), size=len(raw), mtime=target.stat().st_mtime * 1000)
    if method == 'fs.scan':
        if data.get('mode') != 'office':
            raise ValueError('Unsupported scan mode')
        extensions = {'.docx', '.xlsx', '.pptx'}
        excluded = {'.git', '.janusX', 'node_modules', 'out', 'dist', 'build', 'release', 'coverage'}
        files, visited = [], 0
        for parent, directories, names in os.walk(target, followlinks=False):
            directories[:] = sorted(name for name in directories if name not in excluded and not (pathlib.Path(parent) / name).is_symlink())
            for name in sorted(names):
                visited += 1
                if visited > 20000 or len(files) >= 400:
                    return dict(files=files, truncated=True)
                path = pathlib.Path(parent) / name
                if path.is_symlink() or path.suffix.lower() not in extensions:
                    continue
                path = safe(root, path.relative_to(root).as_posix())
                info = path.stat()
                files.append(dict(relPath=path.relative_to(target).as_posix(), size=info.st_size,
                                  mtimeMs=info.st_mtime * 1000, ext=path.suffix.lower()))
        return dict(files=files, truncated=False)
    if method == 'fs.save':
        raw = data['content'].encode('utf8')
        if len(raw) > MAX_FILE:
            raise ValueError('File exceeds the write limit')
        with WRITE_LOCK:
            expected = data.get('expectedVersion')
            if expected is not None:
                current = read_bytes(target)
                current_version = version(current)
                if expected != current_version:
                    return dict(conflict=True, error='DOCUMENT_CONFLICT', current=dict(text=current.decode('utf8'), version=current_version))
            atomic_write(target, raw)
        return dict(success=True, version=version(raw))
    if method == 'fs.mutate':
        operation = data['operation']
        target = safe(root, data.get('path', ''), allow_root=False)
        # Rename/delete the entry, not the file an in-root symlink points to.
        target = root / pathlib.PurePosixPath(data['path'])
        with WRITE_LOCK:
            if operation == 'mkdir':
                target.mkdir()
            elif operation == 'create':
                with open(target, 'xb'):
                    pass
            elif operation == 'delete':
                if target.is_dir() and not target.is_symlink():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            elif operation == 'rename':
                destination = safe(root, data['destination'], allow_root=False)
                destination = root / pathlib.PurePosixPath(data['destination'])
                if destination.exists() or destination.is_symlink():
                    raise ValueError('Destination already exists')
                target.rename(destination)
                target = destination
            else:
                raise ValueError('Unsupported file operation')
        return dict(success=True, path=target.relative_to(root).as_posix())
    if method == 'process.run':
        return run_process(data, target)
    if method == 'notes.files':
        paths = [root / '.agents' / 'harness.json']
        notes = root / '.agents' / 'notes'
        if notes.exists():
            paths.extend(notes.rglob('*.md'))
        output = []
        total = 0
        for path in paths:
            if len(output) >= 2000:
                raise ValueError('Too many Note files')
            relative = path.relative_to(root).as_posix()
            path = safe(root, relative)
            if not path.is_file():
                continue
            raw = read_bytes(path, 2 * 1024 * 1024)
            total += len(raw)
            if total > 16 * 1024 * 1024:
                raise ValueError('Notes exceed the snapshot limit')
            output.append(dict(path=relative, content=raw.decode('utf8'), version=version(raw)))
        return output
    raise ValueError('Unsupported workspace operation: ' + method)


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        while True:
            line = self.rfile.readline(MAX_FRAME + 1)
            if not line:
                return
            if len(line) > MAX_FRAME:
                return
            identity = None
            try:
                request = json.loads(line)
                identity = request.get('id')
                result = dispatch(request['method'], request.get('params', {}))
                response = dict(id=identity, result=result)
            except Exception as error:
                response = dict(id=identity, error=str(error))
            try:
                self.wfile.write((json.dumps(response, ensure_ascii=True, separators=(',', ':')) + '\n').encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def serve():
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(BASE, 0o700)
    # Exclusive lifetime lock prevents simultaneous bootstrap from unlinking a
    # live daemon's socket and orphaning its terminals.
    lock = open(BASE / 'host.lock', 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    if SOCKET.exists():
        SOCKET.unlink()
    with Server(str(SOCKET), Handler) as server:
        os.chmod(SOCKET, 0o600)
        server.serve_forever()


def connect():
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(BASE, 0o700)
    connection = socket.socket(socket.AF_UNIX)
    try:
        connection.connect(str(SOCKET))
    except (FileNotFoundError, ConnectionRefusedError):
        log = open(BASE / 'host.log', 'ab')
        subprocess.Popen([sys.executable, __file__, 'serve'], stdin=subprocess.DEVNULL,
                         stdout=log, stderr=log, start_new_session=True, close_fds=True)
        log.close()
        for attempt in range(100):
            try:
                connection.connect(str(SOCKET))
                break
            except (FileNotFoundError, ConnectionRefusedError):
                time.sleep(0.05)
        else:
            raise RuntimeError('Remote workspace host did not start; inspect host.log')

    def receive():
        try:
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
        except (BrokenPipeError, OSError):
            pass

    reader = threading.Thread(target=receive, daemon=True)
    reader.start()
    for line in sys.stdin.buffer:
        if len(line) > MAX_FRAME:
            raise ValueError('Request exceeds frame limit')
        connection.sendall(line)
    connection.shutdown(socket.SHUT_WR)
    reader.join()
    connection.close()


if __name__ == '__main__':
    if sys.platform != 'linux':
        raise SystemExit('JanusX remote workspaces currently require Linux')
    if len(sys.argv) > 1 and sys.argv[1] == 'serve':
        serve()
    else:
        connect()
