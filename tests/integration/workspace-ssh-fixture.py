"""Isolated Linux sshd fixture. Extracts downloaded packages; installs no service.

Run in NewAPI-WSL with Linux Python. The Windows test reads the JSON manifest.
Touch <directory>/stop (or wait thirty minutes) to stop sshd and clean up the
fixture's own runtime processes. No user SSH configuration is modified.
"""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time

cache = pathlib.Path.home() / '.cache/janusx-workspace-test'
packages = cache / 'packages'
extracted = cache / 'extracted'
extracted.mkdir(parents=True, exist_ok=True)
for package in packages.glob('*.deb'):
    subprocess.run(['dpkg-deb', '-x', str(package), str(extracted)], check=True)
directory = pathlib.Path(tempfile.mkdtemp(prefix='fixture-', dir=cache))
home = directory / 'home'
home.mkdir(mode=0o700)
project = home / "project 你好 ' space"
project.mkdir()
for name in ['host_key', 'client_key']:
    subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(directory / name)], check=True)
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
wrapper = directory / 'command.sh'
wrapper.write_text('#!/bin/sh\nexport HOME=' + str(home) + '\nexec /bin/sh -c "$SSH_ORIGINAL_COMMAND"\n')
wrapper.chmod(0o700)
config = directory / 'sshd_config'
config.write_text(f'''Port {port}
ListenAddress 127.0.0.1
HostKey {directory}/host_key
PidFile {directory}/sshd.pid
AuthorizedKeysFile {directory}/client_key.pub
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes yes
AllowUsers {os.environ['USER']}
AllowTcpForwarding no
X11Forwarding no
PermitTunnel no
ForceCommand {wrapper}
''')
environment = {**os.environ, 'LD_LIBRARY_PATH': str(extracted / 'usr/lib/x86_64-linux-gnu')}
log = open(directory / 'sshd.log', 'wb')
server = subprocess.Popen([str(extracted / 'usr/sbin/sshd'), '-D', '-e', '-f', str(config)], env=environment, stdout=log, stderr=log)
try:
    for _ in range(100):
        if server.poll() is not None:
            raise RuntimeError((directory / 'sshd.log').read_text())
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.2):
                break
        except OSError:
            time.sleep(.1)
    manifest = dict(directory=str(directory), home=str(home), root=str(project), port=port, user=os.environ['USER'])
    (cache / 'active-fixture.json').write_text(json.dumps(manifest))
    print(json.dumps(manifest), flush=True)
    deadline = time.monotonic() + 1800
    while not (directory / 'stop').exists() and time.monotonic() < deadline:
        time.sleep(.2)
finally:
    server.terminate()
    server.wait(timeout=5)
    log.close()
    host_path = str(home / '.local/share/janusx/runtime-v1/host.py').encode()
    for process in pathlib.Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            arguments = (process / 'cmdline').read_bytes().split(b'\x00')
            if host_path in arguments and b'serve' in arguments:
                os.kill(int(process.name), 15)
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    # This is the exact mkdtemp directory created above, never a computed root.
    shutil.rmtree(directory)
