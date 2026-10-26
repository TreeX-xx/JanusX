"""Run with Linux Python; real subprocesses and install locks, isolated HOME."""
import importlib.util
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
        self.assertEqual(cli.locate('codex')['executable'], str(executable))
        executable.write_text('#!/bin/sh\necho missing-library >&2\nexit 1\n')
        with self.assertRaisesRegex(ValueError, 'exists but cannot run'):
            cli.locate('codex')

    def test_detached_install_is_deduplicated_and_immediately_discoverable(self):
        self.executable('.local/bin/npm', '''echo call >> "$HOME/calls"
sleep 0.3
mkdir -p "$HOME/.local/share/janusx/agents/codex/bin"
printf '#!/bin/sh\\necho installed-fixture\\n' > "$HOME/.local/share/janusx/agents/codex/bin/codex"
chmod +x "$HOME/.local/share/janusx/agents/codex/bin/codex"
''')
        self.assertEqual(cli.start('codex', ['fixture'])['state'], 'running')
        self.assertEqual(cli.start('codex', ['fixture'])['state'], 'running')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = cli.read_status('codex')
            if state['state'] != 'running':
                break
            time.sleep(.1)
        self.assertEqual(state['state'], 'complete', state)
        self.assertEqual((self.home / 'calls').read_text().count('call'), 1)
        self.assertTrue(cli.locate('codex')['installed'])

    def test_interrupted_state_is_not_reported_as_running(self):
        directory = cli.BASE / 'codex'
        directory.mkdir(parents=True)
        cli.save(directory / 'install.json', dict(state='running'))
        self.assertEqual(cli.read_status('codex')['state'], 'failed')


if __name__ == '__main__':
    unittest.main()
