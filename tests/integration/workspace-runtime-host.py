"""Run with Linux Python: python3 tests/integration/workspace-runtime-host.py."""
import base64
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import threading
import unittest


class WorkspaceHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='janusx-runtime-test-')
        cls.directory = pathlib.Path(cls.temp.name)
        cls.root = cls.directory / 'project with spaces'
        cls.root.mkdir()
        cls.host = pathlib.Path(__file__).resolve().parents[2] / 'resources/workspace-runtime/host.py'
        cls.env = {**os.environ, 'JANUSX_RUNTIME_HOME': str(cls.directory / 'runtime')}
        cls.server = subprocess.Popen([sys.executable, str(cls.host), 'serve'], env=cls.env)
        for _ in range(100):
            if (cls.directory / 'runtime/host.sock').exists():
                break
            time.sleep(.05)
        else:
            raise RuntimeError('Host did not start')

    @classmethod
    def tearDownClass(cls):
        for item in cls.call('terminal.list', dict(workspaceId='test')):
            cls.call('terminal.end', dict(id=item['id'], workspaceId='test'))
        cls.server.terminate()
        cls.server.wait(timeout=5)
        cls.temp.cleanup()

    @classmethod
    def call(cls, method, params=None):
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(10)
            client.connect(str(cls.directory / 'runtime/host.sock'))
            client.sendall((json.dumps(dict(id=1, method=method, params=params or {})) + '\n').encode())
            response = json.loads(client.makefile('rb').readline())
            if 'error' in response:
                raise RuntimeError(response['error'])
            return response['result']

    def test_worktree_scope_and_running_terminal_deletion_guard(self):
        root = self.directory / 'worktree-main'
        root.mkdir()
        def git(*args):
            subprocess.run(['git', *args], cwd=root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        git('init', '-q')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'test@example.invalid')
        git('commit', '--allow-empty', '-qm', 'fixture')
        linked = self.call('worktree.create', dict(root=str(root), name='linked', startFrom='HEAD'))
        file = str(pathlib.Path(linked['path']) / 'new.txt')
        self.assertEqual(self.call('scope.resolve', dict(root=str(root), path=file))['root'], linked['path'])
        with self.assertRaises(RuntimeError):
            self.call('scope.resolve', dict(root=str(root), path=str(self.directory / 'unrelated')))
        terminal = dict(id='worktree-busy', workspaceId='test', cwd=linked['path'], argv=['sleep', '30'])
        self.call('terminal.create', terminal)
        with self.assertRaisesRegex(RuntimeError, 'running terminals'):
            self.call('worktree.remove', dict(root=str(root), target=linked['path'], force=True))
        self.call('terminal.end', terminal)
        for _ in range(100):
            if self.call('terminal.poll', terminal)['exitCode'] is not None:
                break
            time.sleep(.02)
        self.assertTrue(self.call('worktree.remove', dict(root=str(root), target=linked['path']))['branchDeleted'])
        with self.assertRaises(RuntimeError):
            self.call('worktree.remove', dict(root=str(root), target=str(root), force=True))

    def test_file_version_conflict_and_root_guard(self):
        path = self.root / '你好.txt'
        path.write_text('before', encoding='utf8')
        read = self.call('fs.read', dict(root=str(self.root), path=path.name))
        path.write_text('external', encoding='utf8')
        conflict = self.call('fs.save', dict(root=str(self.root), path=path.name,
                                             content='mine', expectedVersion=read['version']))
        self.assertTrue(conflict['conflict'])
        self.assertEqual(path.read_text(), 'external')
        saved = self.call('fs.save', dict(root=str(self.root), path=path.name,
                         content='mine', expectedVersion=hashlib.sha256(b'external').hexdigest()))
        self.assertTrue(saved['success'])
        self.assertEqual(path.read_text(), 'mine')
        with self.assertRaises(RuntimeError):
            self.call('fs.mutate', dict(root=str(self.root), operation='delete', path=''))
        outside = self.directory / 'outside.txt'
        outside.write_text('outside')
        (self.root / 'link').symlink_to(outside)
        with self.assertRaises(RuntimeError):
            self.call('fs.read', dict(root=str(self.root), path='link'))

    def test_git_runs_in_target_and_preserves_argument_boundaries(self):
        result = self.call('process.run', dict(root=str(self.root), argv=['git', 'init', '-q']))
        self.assertEqual(result['exitCode'], 0)
        result = self.call('process.run', dict(root=str(self.root), argv=['git', 'rev-parse', '--show-toplevel']))
        self.assertEqual(result['stdout'].strip(), str(self.root))
        result = self.call('process.run', dict(root=str(self.root), argv=[sys.executable, '-c', 'import sys;print(sys.argv[1])', "a;$(touch nope)'你好"]))
        self.assertEqual(result['stdout'].strip(), "a;$(touch nope)'你好")
        self.assertFalse((self.root / 'nope').exists())

    def test_terminal_survives_transport_exit_and_reuses_identity(self):
        params = dict(id='persistent', workspaceId='test', cwd=str(self.root),
                      argv=[sys.executable, '-u', '-c', 'import time;print("ready");time.sleep(1);print("still-running");time.sleep(30)'])
        request = dict(id=1, method='terminal.create', params=params)
        proxy = subprocess.run([sys.executable, str(self.host), 'connect'], input=json.dumps(request)+'\n',
                               text=True, capture_output=True, timeout=10, env=self.env)
        self.assertEqual(proxy.returncode, 0, proxy.stderr)
        original = json.loads(proxy.stdout)['result']
        # No SSH/WSL proxy remains, but the independently owned Linux PTY lives.
        time.sleep(1.3)
        listed = self.call('terminal.list', dict(workspaceId='test'))
        self.assertEqual(listed[0]['pid'], original['pid'])
        self.assertIsNone(listed[0]['exitCode'])
        replay = self.call('terminal.poll', dict(workspaceId='test', id='persistent', after=0))
        self.assertIn('still-running', base64.b64decode(replay['data']).decode())
        again = self.call('terminal.create', params)
        self.assertEqual(again['pid'], original['pid'])
        self.call('terminal.end', dict(workspaceId='test', id='persistent'))

    def test_attach_only_never_relaunches_missing_task(self):
        with self.assertRaisesRegex(RuntimeError, 'no longer exists'):
            self.call('terminal.create', dict(id='missing', workspaceId='test', cwd=str(self.root),
                      attachOnly=True, argv=['touch', 'must-not-exist']))
        self.assertFalse((self.root / 'must-not-exist').exists())

    def test_mutating_in_root_symlink_preserves_target(self):
        target = self.root / 'kept.txt'
        target.write_text('keep me')
        (self.root / 'alias.txt').symlink_to(target)
        self.call('fs.mutate', dict(root=str(self.root), operation='rename', path='alias.txt', destination='renamed.txt'))
        self.assertTrue((self.root / 'renamed.txt').is_symlink())
        self.call('fs.mutate', dict(root=str(self.root), operation='delete', path='renamed.txt'))
        self.assertEqual(target.read_text(), 'keep me')

    def test_office_scan_excludes_sources_and_dependencies(self):
        (self.root / 'source.ts').write_text('export const value = 1')
        (self.root / 'preview.docx').write_bytes(b'fixture')
        ignored = self.root / 'node_modules'
        ignored.mkdir(exist_ok=True)
        (ignored / 'ignored.docx').write_bytes(b'skip')
        with self.assertRaisesRegex(RuntimeError, 'Unsupported scan mode'):
            self.call('fs.scan', dict(root=str(self.root), mode='source'))
        result = self.call('fs.scan', dict(root=str(self.root), mode='office'))
        self.assertEqual([item['relPath'] for item in result['files']], ['preview.docx'])

    def test_process_output_is_bounded_and_can_be_cancelled(self):
        result = self.call('process.run', dict(root=str(self.root), maxBytes=128, truncate=True,
                           argv=[sys.executable, '-c', 'print("x"*1000000)']))
        self.assertEqual(len(result['stdout']), 128)
        self.assertTrue(result['truncated'])
        with self.assertRaisesRegex(RuntimeError, 'exceeds'):
            self.call('process.run', dict(root=str(self.root), maxBytes=128,
                      argv=[sys.executable, '-c', 'print("x"*1000000)']))
        errors = []
        def run():
            try:
                self.call('process.run', dict(root=str(self.root), operationId='cancel-test',
                          argv=[sys.executable, '-c', 'import time;time.sleep(30)']))
            except RuntimeError as error:
                errors.append(str(error))
        worker = threading.Thread(target=run)
        worker.start()
        time.sleep(.2)
        self.call('process.cancel', dict(operationId='cancel-test'))
        worker.join(timeout=3)
        self.assertFalse(worker.is_alive())
        # Cancellation may be observed as a killed process or an explicit error.
        self.assertTrue(not errors or 'cancelled' in errors[0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
