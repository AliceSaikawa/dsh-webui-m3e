# dsh-webui-m3e

[日本語](README.md) | [English](README.en.md) | 简体中文

这是一个插件，让你通过适合智能手机使用的 Material 3 Expressive 界面操作 DeepSeek Harness（DSH）。界面文字仅提供日语。

<p>
  <img src="docs/images/home.zh-CN.png" alt="会话列表" width="200">
  <img src="docs/images/chat.zh-CN.png" alt="会话聊天" width="200">
  <img src="docs/images/approval.zh-CN.png" alt="工具审批" width="200">
  <img src="docs/images/inbox.zh-CN.png" alt="待处理事项" width="200">
</p>

这些截图展示经过翻译的模拟画面；实际应用界面仍仅提供日语。

> [!NOTE]
> 这是个人项目，并非 DeepSeek 官方产品。项目仍在开发中，可能存在缺陷，请谨慎使用。

## 快速开始

**0.0.8 正在准备发布。发布前，按名称安装会返回 npm 404。** 发布后，请在运行 DSH 的机器上执行：

```bash
dsh plugin --profile web add dsh-webui-m3e
```

`web` 只是示例，请选择实际提供 Web 界面的配置档案。名称拼错时也可能直接创建新档案，不会报错，因此安装成功不代表目标正确。

仅支持 **DSH 0.2.0-rc.2**，运行环境要求 Node.js 22 或更高版本。通过 npm 安装的普通 DSH CLI 使用 **PATH 中的 pnpm**（验证环境：macOS 27.2、Node.js 26.7.0、pnpm 11.17.0）。无需获取 M3E 源码、手动构建或安装开发依赖。

添加后，先在标准界面（`http://<host>/?ui=classic`）登录，再打开 `http://<host>/m3e/`。在隔离的普通 CLI 环境中，从未安装状态添加 M3E 无需重启 Host 即可生效。更新和回退时，界面文件先发生变化，Host 代码在重启前仍是原来的版本，因此更新或回退后必须重启该配置档案的 Host。

Desktop 有[上游关于内置 pnpm 的说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)。本版本尚未在此环境中验证 Desktop，普通 CLI 的验证结果不代表 Desktop 已验证。

## 功能

- **会话**：在手机屏幕上阅读与 AI 的对话、工具执行结果和思考内容，也可以切换到按时间顺序排列记录的「トレース」（追踪）视图。
- **回复**：无论当前在哪个页面，都可以通过底部弹出的面板审批工具、回答 AI 的提问或确认计划。
- **待处理事项**：集中查看需要回复的会话和已结束的会话。
- **输入**：支持附加图片、显示文件和命令候选项，以及切换模型和权限。
- **其他功能**：搜索会话、配置 DSH 并登记 API 密钥，以及将网页添加到主屏幕后作为 Web 应用使用。

DSH 原有的界面会保留。你可以在每台设备上分别选择使用哪个界面。

## 环境要求

- DeepSeek Harness **0.2.0-rc.2**（已使用真实的 DSH 和模拟的 LLM 验证启动、发送、停止、审批、提问、重新连接等）
  - 已移除对 0.1.5 系列的支持。验证结果、已知差异和未验证的操作见 [docs/dsh-compatibility.md](docs/dsh-compatibility.md)（日文）。
- Node.js 22 或更高版本，以及 PATH 中的 pnpm（普通 CLI）。无需构建 M3E。

## 更新、版本确认与卸载

查看 JSON 输出中的 `dependencies.dsh-webui-m3e.version`。普通列表可能只显示 `file:` 引用。

```bash
dsh plugin --profile web list dsh-webui-m3e --depth 0 --json
```

更新时，用明确指定的已发布兼容版本重新添加同名软件包。下面是迁移到首个 registry 版本的示例（发布后执行）。已通过本地 tgz 安装的用户也在同一配置档案中执行此命令，重启 Host，再用上面的命令检查版本，无需手动修改版本号。

```bash
dsh plugin --profile web add dsh-webui-m3e@0.0.8
```

从未来的新版本回退时，同样指定已验证的兼容版本重新添加，再重启。回到 0.0.8 可使用同一命令。请勿将以前分发的 0.0.7 作为 DSH 0.2.0-rc.2 的回退目标。也可以使用保留的兼容 tgz：

```bash
dsh plugin --profile web add file:/path/to/dsh-webui-m3e-<version>.tgz
```

卸载前，请打开 `http://<host>/?ui=classic`，卸载后仍可使用该标准界面。在验证环境中，卸载无需重启即可生效，`/m3e/` 返回 404。重启后也确认了标准界面和已保存的会话仍可访问：

```bash
dsh plugin --profile web remove dsh-webui-m3e
```

已在隔离环境中手动验证本地 tgz 的添加、更新、回退和卸载：一个工作区、一段会话以及另一个内置插件的 Shell 设置均得到保留。这一完整流程没有自动化测试。通过 registry 操作、第三方插件和长期使用的既有数据仍未验证。遇到 404 请检查发布状态和版本；找不到 pnpm 时检查 PATH；界面未出现时检查配置档案并重启 Host。CLI 失败时还会输出诊断日志位置。

从源码构建请参阅[开发与分发指南](docs/development.md#配布)（日文）。

## 使用方法

1. 先在常用的 DSH 界面（`http://<host>/`）登录一次。
2. 打开 `http://<host>/m3e/`。
3. 在 iPhone 上，可以通过 Safari 的分享菜单选择「添加到主屏幕」，像应用一样打开。

### 切换界面

你可以通过以下任一方式选择这台设备使用的界面。所选设置会分别保存在每台设备上。

- 在原有界面中选择「設定 → 一般 → この端末で M3E の画面を使う」（设置 → 常规 → 在此设备上使用 M3E 界面）
- 在本界面中选择「設定 → 今の画面に戻す」（设置 → 返回原有界面）
- 在 URL 后附加 `?ui=m3e` 或 `?ui=classic` 后打开

如果某个界面无法正常打开，请访问 `http://<host>/?ui=classic`，返回原有界面。

## 注意事项

- 界面文字仅提供日语。
- 插件随附 DSH 的内部库（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`），因此可能无法在某些 DSH 版本上运行。
- 界面测试主要使用模拟数据。与 DSH 的连接使用与生产环境隔离的真实 DSH 和模拟的 LLM 进行验证。本次迁移尚未使用真实 LLM 或 iPhone 验证。开发方法和工作原理见 [docs/development.md](docs/development.md)。

## 许可证

采用 MIT 许可证。详见 [LICENSE](LICENSE)。
