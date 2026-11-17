"""Run with Linux Python; real subprocesses and install locks, isolated HOME."""
import importlib.util
import fcntl
import os
import pathlib
import tempfile
import time
import unittest
from unittest.mock import patch

source = pathlib.Path(__file__).resolve().parents[2] / 'resources/workspace-runtime/cli.py'
spec = importlib.util.spec_from_file_location('workspace_cli', source)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='janusx-cli-test-')
        self.home = pathlib.Path(self.temp.name)
        self.env = patch.dict(os.environ, HOME=str(self.home), PATH='/usr/bin:/bin:/mnt/c/Windows', SHELL='/nonexistent')
        self.env.start()
        self.base = patch.object(cli, 'BASE', self.home / '.local/share/janusx/agents')
        self.base.start()

    def tearDown(self):
        self.base.stop()
        self.env.stop()
        self.temp.cleanup()

    def executable(self, name, content):
        path = self.home / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#!/bin/sh\n' + content)
        path.chmod(0o700)
        return path

    def test_missing_and_user_install(self):
        self.assertFalse(cli.locate('codex')['installed'])
        executable = self.executable('.local/bin/codex', 'echo codex-fixture-1\n')
        self.assertEqual(cli.locate('codex')['executable'], str(executable))
        self.assertNotIn('/mnt/c/', cli.environment('codex')['PATH'])

    def test_nvm_and_broken_executable(self):
        executable = self.executable('.nvm/versions/node/v22.20.0/bin/codex', 'echo from-nvm\n')
        os.environ['PATH'] = str(executable.parent) + ':' + os.environ['PATH']
        self.assertEqual(cli.locate('codex')['executable'], str(executable))
        executable.write_text('#!/bin/sh\necho missing-library >&2\nexit 1\n')
        with self.assertRaisesRegex(ValueError, 'exists but cannot run'):
            cli.locate('codex')

    def setup_npm(self, failure=False):
        self.executable('.local/bin/node', 'echo v22.20.0\n')
        self.executable('.local/bin/npm', '''case "$1" in
prefix) echo "$HOME/.local"; exit 0;;
root) echo "$HOME/.local/lib/node_modules"; exit 0;;
esac
echo "$*" >> "$HOME/calls"
if [ "$INSTALL_FAIL" = 1 ]; then exit 13; fi
sleep 0.3
mkdir -p "$HOME/.local/lib/node_modules/fixture"
printf '{"name":"fixture","version":"1.2.3"}' > "$HOME/.local/lib/node_modules/fixture/package.json"
printf '#!/bin/sh\\necho 1.2.3\\n' > "$HOME/.local/lib/node_modules/fixture/cli"
chmod +x "$HOME/.local/lib/node_modules/fixture/cli"
ln -sf "$HOME/.local/lib/node_modules/fixture/cli" "$HOME/.local/bin/codex"
''')
        os.environ['PATH'] = str(self.home / '.local/bin') + ':/usr/bin:/bin'
        os.environ['INSTALL_FAIL'] = '1' if failure else '0'

    def test_detached_install_is_deduplicated_and_immediately_discoverable(self):
        self.setup_npm()
        self.assertEqual(cli.start('codex', ['fixture'])['state'], 'running')
        self.assertEqual(cli.start('codex', ['fixture'])['state'], 'running')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = cli.read_status('codex')
            if state['state'] != 'running':
                break
            time.sleep(.1)
        self.assertEqual(state['state'], 'complete', state)
        calls = (self.home / 'calls').read_text().splitlines()
        self.assertEqual(len(calls), 1)
        self.assertIn('--prefix ' + str(self.home / '.local'), calls[0])
        self.assertTrue(cli.locate('codex')['installed'])

    def test_private_directories_are_not_injected(self):
        self.executable('.local/share/janusx/agents/codex/bin/codex', 'echo private\n')
        self.executable('.local/share/janusx/runtime-v1/node/bin/node', 'echo v24.0.0\n')
        self.assertNotIn('/.local/share/janusx/', cli.environment('codex')['PATH'])
        self.assertFalse(cli.locate('codex')['installed'])

    def test_shared_npm_lock_blocks_mutation_until_released(self):
        self.setup_npm()
        cli.BASE.mkdir(parents=True)
        with (cli.BASE / 'npm-install.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(cli.start('codex', ['fixture'])['state'], 'running')
            time.sleep(.3)
            self.assertFalse((self.home / 'calls').exists())
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = cli.read_status('codex')
            if state['state'] != 'running':
                break
            time.sleep(.1)
        self.assertEqual(state['state'], 'complete', state)

    def test_install_outside_active_path_does_not_report_success(self):
        self.setup_npm()
        for name in ('node', 'npm'):
            self.executable('toolchain/' + name, (self.home / '.local/bin' / name).read_text().split('\n', 1)[1])
        env = cli.environment('codex')
        env['PATH'] = str(self.home / 'toolchain') + ':/usr/bin:/bin'
        with self.assertRaisesRegex(ValueError, 'not the active command'):
            cli.install_system('codex', ['fixture'], env)

    def test_existing_native_is_reused_without_npm(self):
        command = self.executable('.local/bin/codex', 'echo 1.0.0\n')
        result = cli.install_system('codex', ['fixture'], cli.environment('codex'))
        self.assertEqual(result['executable'], str(command))
        self.assertFalse((self.home / 'calls').exists())

    def test_permission_failure_has_no_private_fallback(self):
        self.setup_npm(failure=True)
        with self.assertRaisesRegex(ValueError, 'no private fallback'):
            cli.install_system('codex', ['fixture'], cli.environment('codex'))
        self.assertFalse((cli.BASE / 'codex/bin').exists())

    def test_mismatched_root_stops_before_mutation(self):
        self.setup_npm()
        npm = self.home / '.local/bin/npm'
        npm.write_text(npm.read_text().replace('lib/node_modules"; exit', 'wrong-root"; exit'))
        with self.assertRaisesRegex(ValueError, 'disagree'):
            cli.install_system('codex', ['fixture'], cli.environment('codex'))
        self.assertFalse((self.home / 'calls').exists())

    def test_wrong_package_version_cannot_report_success(self):
        self.setup_npm()
        npm = self.home / '.local/bin/npm'
        npm.write_text(npm.read_text().replace('echo 1.2.3', 'echo 9.9.9'))
        with self.assertRaisesRegex(ValueError, 'expected package version'):
            cli.install_system('codex', ['fixture'], cli.environment('codex'))

    def test_interrupted_state_is_not_reported_as_running(self):
        directory = cli.BASE / 'codex'
        directory.mkdir(parents=True)
        cli.save(directory / 'install.json', dict(state='running'))
        self.assertEqual(cli.read_status('codex')['state'], 'failed')


if __name__ == '__main__':
    unittest.main()
