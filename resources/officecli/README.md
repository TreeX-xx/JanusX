# Bundled OfficeCLI

Place the pinned Windows binary here before packaging:

- `resources/officecli/officecli.exe` (`1.0.135`, arch matches the build target)

Windows x64 source: https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.135/officecli-win-x64.exe

SHA256: `937db176b585e874aa5bff48d536bce78037665cd862b5deefe56e79977e6588`.
Windows packaging verifies this resource before building the application.

`electron-builder.yml` copies this directory to `<resources>/officecli`.
The main process resolves it via `resolveBundledOfficecliBinary()` and never
downloads, installs, or prompts for OfficeCLI at runtime.
