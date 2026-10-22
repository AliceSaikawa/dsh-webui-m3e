# dsh-webui-m3e

[日本語](README.ja.md) | [English](README.md) | 简体中文

这是一个插件，让你在手机上通过易用的 Material 3 Expressive（M3E）界面操作 DeepSeek Harness（DSH）。

<p>
  <img src="docs/images/home.zh-CN.png" alt="会话列表" width="200">
  <img src="docs/images/chat.zh-CN.png" alt="会话聊天" width="200">
  <img src="docs/images/approval.zh-CN.png" alt="工具审批" width="200">
  <img src="docs/images/inbox.zh-CN.png" alt="待处理事项" width="200">
</p>

这些截图展示经过翻译的模拟画面；实际应用界面仅提供日语。

> [!NOTE]
> 这是个人项目，并非 DeepSeek 官方产品。项目仍在开发中，可能存在缺陷，请谨慎使用。

## 快速开始

> [!IMPORTANT]
> 当前发布的 0.0.8 面向 **DSH 0.2.0-rc.2**。请用 `npm i -g @deepseek-ai/dsh@0.2.0-rc.2` 安装 DSH 0.2.0-rc.2，并用 `dsh --version` 确认版本。**支持 DSH 0.2.1-rc.2 的是预发布版本 v0.0.9-rc.2**（GitHub 的 Latest 仍是 0.0.8）。安装方法与下面相同，只需把 URL 中的 `v0.0.8` 和 `0.0.8` 换成 `v0.0.9-rc.2` 和 `0.0.9-rc.2`。0.0.8 无法在 DSH 0.2.1-rc.2 上运行。如果你继续使用 DSH 0.2.0-rc.2，回退目标同样是 0.0.8。

1. 在运行 DSH 的机器上执行以下命令：

   ```bash
   dsh plugin --profile web add https://github.com/AliceSaikawa/dsh-webui-m3e/releases/download/v0.0.8/dsh-webui-m3e-0.0.8.tgz
   ```

   `web` 只是示例，请指定实际提供 Web 界面的配置档案（名称拼错时也只会创建新档案，安装成功并不代表目标正确）。

2. 打开 `dsh web` 输出的登录 URL，登录标准界面（DSH 原有的 Web 界面）。

3. 用同一地址打开 `http://<host>/m3e/`。如果返回 404，请重启该配置档案的 Host。重启 Host（用 Ctrl+C 停止 `dsh web`，再用同一命令重新启动）后登录 URL 可能会改变，因此请从第 2 步重新开始。

M3E 未发布到 npm registry，因此不能只用名称执行 `add dsh-webui-m3e` 来安装。M3E 无需另外安装运行时依赖包，也无需获取源码、手动构建或安装开发依赖。更新或回退会切换 Host 代码的版本，因此必须重启 Host。

## 功能

> [!NOTE]
> 本节介绍 main 的内容。0.0.8 没有固定会话、显示和恢复已归档的会话、选择基准色、插件列表，也没有通用的错误界面和设置中的「モード」页面。预发布版本 v0.0.9-rc.2 已包含这些功能。

- **会话**：在手机屏幕上阅读 AI 的回复、工具执行结果和思考内容，也可以切换到按时间顺序排列的「トレース」（追踪）视图。
- **会话列表**：可以把会话固定到列表顶部。固定状态在所有工作区之间共用，标准界面或其他设备上的更改也会反映过来。已归档的会话可以通过切换显示来查看，并在长按菜单中恢复归档。
- **回复**：无论当前在哪个页面，都可以通过底部弹出的面板审批工具、回答 AI 的提问或确认计划。
- **待处理事项**：集中查看需要回复的会话和已结束的会话。
- **输入**：支持附加图片、用 `@` 引用文件、用 `/` 显示命令候选项，以及切换模型、思考深度、权限预设和计划模式。
- **会话工具**：可以从会话菜单打开统计、文件、作业、子代理和目标。
- **搜索**：搜索会话。
- **设置**：管理 DSH 的设置、API 密钥和自定义提供方。在「モード」（模式）页面中，可以查看代理预设，并选择新会话使用的预设。
- **工作区**：在会话列表的抽屉中切换工作区。
- **外观**：除了明暗之外，还可以在每台设备上从 6 种预设颜色（紫、蓝、青绿、绿、橙、红）或任意颜色中选择基准色。所选颜色会应用到整个界面。
- **插件**：可以从设置中以只读列表查看已安装插件的状态。
- **错误**：对于渲染失败、不存在的页面、无法打开的会话以及启动时离线，会用统一的界面说明原因和下一步操作。
- **主屏幕**：在 iPhone 上，可以通过 Safari 的「添加到主屏幕」，像应用一样打开。作为添加到主屏幕的应用运行时的表现尚未验证。

DSH 原有的界面会保留。你可以在每台设备上分别选择使用哪个界面。

## 环境要求

- DeepSeek Harness **0.2.0-rc.2**（使用当前发布的 0.0.8 时）
  - 0.0.8 适用于这个版本。安装方法见「快速开始」。
  - 验证结果、已知差异和未验证的操作见 [docs/dsh-compatibility.md](docs/dsh-compatibility.md)（日文）。
- DeepSeek Harness **0.2.1-rc.2**（本仓库的 main 和预发布版本 v0.0.9-rc.2）
  - main 和 v0.0.9-rc.2 支持这个版本。已取消对 0.1.5 系列的支持。
  - 安装 DSH 本体时需要指定版本。npm 的 `latest`、`next` 等标签会随时间变动（截至 2026-10-20，两者都指向 0.2.1-rc.2），请固定为本仓库支持的版本。

    ```bash
    npm i -g @deepseek-ai/dsh@0.2.1-rc.2
    ```

    可用 `dsh --version` 确认本机版本。
- 满足 DSH 和 pnpm 要求的 Node.js，以及 PATH 中的 pnpm（供通过 npm 安装的普通 DSH CLI 使用）。
  - DSH 本身未声明 Node 版本下限，但 CLI 使用的 commander 15 要求 Node `>=22.12.0`，pnpm 11.17.0 要求 `>=22.13`。请使用同时满足 DSH 和所用 pnpm 版本要求的 Node。
- 验证环境为 macOS 27.2、Node.js 26.7.0 和 pnpm 11.17.0；依赖声明的下限不代表 M3E 保证支持的最低版本。
- 本版本尚未在此环境中验证 Desktop。虽然有[上游关于内置 pnpm 的说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)，但请与普通 CLI 的验证结果区分开。

## 使用方法

安装、登录标准界面以及打开 `http://<host>/m3e/` 的步骤见「快速开始」。

在 iPhone 上，可以通过 Safari 的分享菜单选择「添加到主屏幕」，像应用一样打开。实机上仅验证了在 Safari 中打开的情况，作为添加到主屏幕的 Web 应用运行时的表现尚未验证。

### 切换界面

本 README 中的「标准界面」指 DSH 原有的 Web 界面（URL 参数和设置中称为「classic」）。你可以通过以下任一方式选择这台设备使用的界面。所选设置会分别保存在每台设备上。

- 在标准界面中选择「设置 → 通用设置 → 在此设备上使用 M3E 界面」（该行随标准界面的语言显示）
- 在本界面中选择「設定 → 今の画面に戻す」（设置 → 返回标准界面）
- 在 URL 后附加 `?ui=m3e` 或 `?ui=classic` 后打开

在选择了 M3E 的设备上，手机上新打开 `/` 会切换到 M3E。在电脑上（主要输入设备为鼠标或触控板），`/` 仍保持标准界面；直接打开 `/m3e/` 即可使用 M3E。带触摸屏的 Windows Firefox 等设备可能不会被判定为电脑，因此 `/` 仍会像手机一样跳转到 `/m3e/`。在显示 M3E 的标签页中，从 URL 中去掉 `/m3e/` 后打开 `/`，该标签页会保持标准界面。新打开的标签页在手机上会遵循设置。0.0.8 在电脑上也会从 `/` 跳转到 `/m3e/`，没有按标签页保持标准界面的行为。

如果某个界面无法正常打开，请访问 `http://<host>/?ui=classic`，返回标准界面。

## 更新、版本确认与卸载

查看 JSON 输出中的 `dependencies.dsh-webui-m3e.version` 确认已安装版本，`resolved` 则显示来源。

```bash
dsh plugin --profile web list dsh-webui-m3e --depth 0 --json
```

更新时，从[发布列表](https://github.com/AliceSaikawa/dsh-webui-m3e/releases)选择兼容版本，用其 tgz 附件的 URL 重新添加。URL 格式为 `https://github.com/AliceSaikawa/dsh-webui-m3e/releases/download/v<version>/dsh-webui-m3e-<version>.tgz`。下面是迁移到 0.0.8 的示例。通过本地 tgz 安装的用户也在同一配置档案中执行此命令，重启 Host，再用上面的命令检查版本，无需手动修改版本号。

```bash
dsh plugin --profile web add https://github.com/AliceSaikawa/dsh-webui-m3e/releases/download/v0.0.8/dsh-webui-m3e-0.0.8.tgz
```

从未来的新版本回退时，从发布列表选择已验证的兼容版本的 URL，重新添加并重启 Host。回到 0.0.8 可使用同一命令。请勿将以前分发的 0.0.7 作为 DSH 0.2.0-rc.2 的回退目标。也可以使用保留的兼容 tgz：

```bash
dsh plugin --profile web add file:/path/to/dsh-webui-m3e-<version>.tgz
```

卸载前，请打开标准界面（`http://<host>/?ui=classic`）。卸载后 `/m3e/` 返回 404，请使用标准界面：

```bash
dsh plugin --profile web remove dsh-webui-m3e
```

如果遇到问题，请检查以下几点。

- 下载时遇到 404：在发布列表检查标签、附件名称和 URL。
- 找不到 pnpm：检查 PATH。
- 界面未出现：检查配置档案并重启 Host。
- 在没有 cookie 的情况下打开 `/m3e/` 时，会显示请从地址栏重新打开的提示（从 v0.0.9-rc.2 开始；该页面跟随浏览器语言，以日语、英语或简体中文显示，其他语言显示英语）。在 0.0.8 中如果无法打开，请重新打开 `dsh web` 输出的登录 URL。
- CLI 失败时还会输出诊断日志位置。

从源码构建请参阅[开发与分发指南](docs/development.md#配布)（日文）。

## 注意事项

- 界面文字目前仅提供日语。虽然已有跟随 DSH 语言设置的机制（[docs/design/11-i18n.md](docs/design/11-i18n.md)，日文），但英语和中文的译文尚未加入。
- 插件随附 DSH 的内部库（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`），因此可能无法在某些 DSH 版本上运行。
- 实机验证仅限于在 iPhone 17 Pro Max 的 Safari 中打开的情况。作为添加到主屏幕的应用运行时的表现，以及其他设备和浏览器，尚未验证。
- 界面测试主要使用模拟数据，与 DSH 的连接则通过隔离的真实 DSH 和模拟 LLM 验证。尚未验证使用真实 LLM 时的表现。详细验证范围见 [docs/dsh-compatibility.md](docs/dsh-compatibility.md)（日文）。
- 开发方法、工作原理和验证记录见 [docs/development.md](docs/development.md)（日文）。

## 许可证

采用 MIT 许可证。详见 [LICENSE](LICENSE)。
