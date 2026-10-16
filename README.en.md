# dsh-webui-m3e

[日本語](README.md) | English | [简体中文](README.zh-CN.md)

A Material 3 Expressive mobile Web UI plugin for DeepSeek Harness (DSH), so you can use DSH comfortably on a phone.

<p>
  <img src="docs/images/home.en.png" alt="Session list" width="200">
  <img src="docs/images/chat.en.png" alt="Conversation chat" width="200">
  <img src="docs/images/approval.en.png" alt="Tool approval" width="200">
  <img src="docs/images/inbox.en.png" alt="Items needing attention" width="200">
</p>

The screenshots show translated mock screens. The actual app UI is Japanese only.

> [!NOTE]
> This is a personal project and is not an official DeepSeek product. It is under development and may contain bugs. Please use it with care.

## Quick Start

1. Run this on the machine running DSH:

   ```bash
   dsh plugin --profile web add https://github.com/AliceSaikawa/dsh-webui-m3e/releases/download/v0.0.8/dsh-webui-m3e-0.0.8.tgz
   ```

   `web` is an example, so select the profile that actually serves your Web UI (a misspelled name still creates a new profile, and a successful install alone does not confirm the target).

2. Open the sign-in URL printed by `dsh web` to sign in to the standard interface.

3. Open `http://<host>/m3e/` on the same address. If it returns 404, restart that profile's Host.

M3E is not published to the npm registry, so installing by name with `add dsh-webui-m3e` is unavailable. M3E has no additional runtime packages to install, and you do not need its source, a local build, or its development dependencies. Always restart the Host after an update or rollback, because that switches the Host code between versions.

## Features

- **Conversations:** Read AI responses, tool results, and reasoning at phone width. You can also switch to a chronological trace view.
- **Responses:** Approve tools, answer AI questions, and review plans from a bottom sheet, whatever screen you are on.
- **Inbox:** See conversations that need a response together with completed conversations.
- **Composer:** Attach images, reference files with `@`, get command suggestions with `/`, and switch models, reasoning effort, permission presets, and plan mode.
- **Session tools:** Open stats, files, jobs, subagents, and goals from the conversation menu.
- **Search:** Search conversations.
- **Settings:** Manage DSH settings, API keys, custom providers, and this device's appearance (light or dark).
- **Home screen:** On iPhone, choose "Add to Home Screen" in Safari to open it like an app.

The existing DSH interface remains available. You can choose which interface to use on each device.

## Requirements

- DeepSeek Harness **0.2.0-rc.2**
  - Only this version is supported. Support for the 0.1.5 series has been removed. See [docs/dsh-compatibility.md](docs/dsh-compatibility.md) (Japanese) for results, known differences, and unverified paths.
- Node.js that meets DSH's and pnpm's requirements, and pnpm on PATH (used by the regular npm-installed DSH CLI).
  - DSH itself declares no minimum Node version, but its CLI dependency commander 15 requires Node `>=22.12.0`, and pnpm 11.17.0 requires `>=22.13`. Use Node that meets both DSH's and your pnpm version's requirements.
- The tested environment is macOS 27.2, Node.js 26.7.0 and pnpm 11.17.0; those dependency declarations do not establish M3E's minimum supported Node version.
- Desktop has not been verified for this release in this environment. There is an [upstream bundled-pnpm path](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime), but keep it separate from the regular CLI results.

## Usage

1. Sign in to the standard interface once (open the sign-in URL printed by `dsh web`).
2. Open `http://<host>/m3e/`.
3. On iPhone, choose "Add to Home Screen" from Safari's Share menu to open it like an app.

### Switching interfaces

Choose which interface to use on this device with any of the following options. Your choice is saved separately on each device.

- In the standard interface: `設定 → 一般 → この端末で M3E の画面を使う` (Settings → General → Use the M3E interface on this device)
- In this interface: `設定 → 今の画面に戻す` (Settings → Switch back to the classic interface)
- Add `?ui=m3e` or `?ui=classic` to the URL

If either interface fails to load, open `http://<host>/?ui=classic` to return to the standard interface.

## Updates, installed version, and removal

Read `dependencies.dsh-webui-m3e.version` in the JSON output for the installed version and `resolved` for its source.

```bash
dsh plugin --profile web list dsh-webui-m3e --depth 0 --json
```

To update, choose a compatible version from the [release list](https://github.com/AliceSaikawa/dsh-webui-m3e/releases) and add its attached tgz URL. URLs follow `https://github.com/AliceSaikawa/dsh-webui-m3e/releases/download/v<version>/dsh-webui-m3e-<version>.tgz`. This example migrates to 0.0.8. Local-tgz users use the same command in the same profile, restart the Host, and check the installed version above. No manual version editing is needed.

```bash
dsh plugin --profile web add https://github.com/AliceSaikawa/dsh-webui-m3e/releases/download/v0.0.8/dsh-webui-m3e-0.0.8.tgz
```

To roll back from a future release, choose a verified compatible version's URL from the release list, add it again, and restart the Host. The same command returns to 0.0.8. Do not use the previously distributed 0.0.7 as a rollback target with DSH 0.2.0-rc.2. A saved compatible tarball can also be selected:

```bash
dsh plugin --profile web add file:/path/to/dsh-webui-m3e-<version>.tgz
```

Before removing M3E, open the standard interface (`http://<host>/?ui=classic`). After removal, `/m3e/` returns 404, so use the standard interface:

```bash
dsh plugin --profile web remove dsh-webui-m3e
```

If something fails, check the following.

- A download returning 404: check the tag, asset filename and URL in the release list.
- Missing pnpm: check PATH.
- A missing UI: check the profile and restart the Host.
- Failed CLI operations also print a diagnostics path.

For source builds, see the [development and distribution guide](docs/development.md#配布) (Japanese).

## Notes

- The UI text is Japanese only for now. The foundation for following DSH's language setting exists ([docs/design/11-i18n.md](docs/design/11-i18n.md)), but the English and Chinese translations are not added yet.
- This plugin bundles internal DSH libraries (`@deepseek-ai/cordis` and `@deepseek-ai/dsh-client-store`), so it may not work with every DSH version.
- Real-device testing has been done only on an iPhone 17 Pro Max with Safari. Other devices and browsers are not tested.
- UI tests mainly use mock data, and the DSH connection is checked with an isolated real DSH and a fake LLM. See [docs/dsh-compatibility.md](docs/dsh-compatibility.md) for the detailed verification scope.
- See [docs/development.md](docs/development.md) for architecture, development instructions and verification records.

## License

MIT. See [LICENSE](LICENSE).
