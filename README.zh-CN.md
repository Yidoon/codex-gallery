# Codex Gallery

语言：[English](./README.md) | 简体中文 | [日本語](./README.ja.md)

Codex Gallery 是一个本地优先的桌面图库应用，用来浏览 Codex 生成的图片。它会扫描本地 Codex 数据目录，按对话会话归类图片，在能读取到会话信息时展示会话标题，并支持收藏、预览、查看元信息和导出图片。

这是一个非官方的 Codex 伴侣应用。

## 为什么做这个

Codex 生成的图片会保存在本地：

```text
~/.codex/generated_images
```

但 Codex 目前主要只能在单个对话里查看该对话生成过的图片。只要你在多个对话里生成图片，就会遇到这些问题：

- 很难一次性浏览所有 Codex 生成的图片。
- 很难知道一张图来自哪个对话。
- 很难找到以前生成过、但想继续二次创作的图片。
- 想把图片上传到其他平台时，需要手动去目录里找图。

Codex Gallery 试图把这些图片整理成一个更接近相册的体验。

## 功能特性

- **时间线**：按修改时间浏览所有 Codex 生成图片。
- **会话分组**：按 Codex conversation/thread id 归类图片。
- **会话标题**：从 Codex 本地 SQLite 状态库中读取会话标题。
- **Missing Session**：即使原始会话元数据不存在，图片也仍然可见。
- **收藏**：收藏数据存储在 Codex Gallery 自己的本地 SQLite 数据库中。
- **大图预览**：点击图片后居中大图预览，并支持上一张/下一张。
- **图片元信息**：查看文件名、尺寸、大小、格式、路径、会话 id、项目目录和修改时间。
- **导出图片**：将选中的图片复制到 Downloads 目录，保留原始文件名，不移动原图。
- **自动刷新**：监听 Codex 图片目录，新图片出现后自动刷新。
- **懒加载缩略图**：扫描时只返回轻量元数据，缩略图按需加载并本地缓存。
- **空状态提示**：当 Codex 目录、图片目录或会话数据库不存在时展示清晰提示。

## 截图

截图暂未加入仓库。建议后续补充：

- Timeline 页面
- Sessions 页面
- 大图预览
- Metadata 侧边栏

## 数据来源

默认读取：

```text
~/.codex/generated_images
~/.codex/state_5.sqlite
```

Codex 生成图片的目录结构通常是：

```text
~/.codex/generated_images/{thread_id}/{image_file}
```

Codex Gallery 会把 `{thread_id}` 当作图片所属的会话 id，并在：

```text
~/.codex/state_5.sqlite -> threads.id
```

中查找对应的会话信息。

会话标题的展示优先级：

1. `threads.title`
2. `threads.first_user_message`
3. 短 session id

如果图片目录存在，但 `state_5.sqlite` 中找不到对应会话，这些图片会归入 **Missing Session**。

## 隐私与安全

Codex Gallery 是本地优先应用。

- 不上传图片。
- 不上传会话信息。
- 不修改 `~/.codex`。
- 以只读方式访问 Codex 的 `state_5.sqlite`。
- 收藏数据保存在应用自己的 `codex-gallery.db` 中。
- 缩略图按需生成，并缓存在应用数据目录。
- 图片读取、导出、Finder 定位等文件命令都限制在 `~/.codex/generated_images` 下。
- 导出操作只复制文件到 Downloads，不会移动或删除原图。

## 系统要求

- v1 优先支持 macOS。
- Node.js 和 pnpm。
- Rust 工具链，需要 `rustc` 和 `cargo` 在 `PATH` 中可用。
- 本地存在 Codex 数据目录，尤其是 `~/.codex/generated_images`。

Tauri 本身可以支持 Windows 和 Linux，但当前项目主要在 macOS 上开发和验证。

## 快速开始

克隆仓库：

```sh
git clone https://github.com/Yidoon/codex-gallery.git
cd codex-gallery
```

安装依赖：

```sh
pnpm install
```

运行桌面应用：

```sh
pnpm tauri:dev
```

也可以单独启动 Vite 页面：

```sh
pnpm dev
```

但普通浏览器页面无法读取本地 Codex 文件。要体验完整功能，请使用 `pnpm tauri:dev`。

## 常用命令

```sh
pnpm dev              # 启动 Vite web shell
pnpm tauri:dev        # 启动 Tauri 桌面应用
pnpm build            # TypeScript 检查并构建前端
pnpm lint             # 运行 ESLint
pnpm tauri:build      # 构建 macOS .app
pnpm tauri:build:dmg  # 在本地环境支持时构建 DMG
pnpm icons            # 重新生成应用图标
```

Rust 侧检查：

```sh
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

## 构建产物

默认 app-only 构建产物：

```text
src-tauri/target/release/bundle/macos/Codex Gallery.app
```

DMG 构建可以使用：

```sh
pnpm tauri:build:dmg
```

DMG 打包可能依赖本地 macOS 打包环境、签名和 notarization 设置。

## Release 工作流

GitHub Actions 只会在推送版本 tag 时构建 macOS DMG Release。普通 `main` 分支更新不会发布 Release。

创建 Release tag 之前，需要确认这些版本号一致：

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

创建并推送版本 tag：

```sh
git tag v1.0.0
git push origin v1.0.0
```

workflow 会先检查前端和 Rust 后端，然后把 Apple Silicon 和 Intel 两个 macOS DMG 上传到 GitHub Release。当前构建还没有 notarization，所以 macOS 可能会显示 unidentified developer 警告。

## macOS Gatekeeper

Codex Gallery 当前的 Release 还没有签名，也没有 notarization。下载 DMG 后，macOS 可能会提示“Codex Gallery 已损坏，无法打开”。

如果遇到这个提示，先把 App 拖到 Applications，然后移除 quarantine 属性：

```sh
xattr -dr com.apple.quarantine "/Applications/Codex Gallery.app"
```

然后再从 Applications 打开 Codex Gallery。

## 项目结构

```text
.
├── src/                    # React + TypeScript 前端
│   ├── App.tsx             # 主界面状态和视图组合
│   ├── api.ts              # Tauri command 封装
│   ├── components/         # 可复用 UI 组件
│   └── types.ts            # 前端共享类型
├── src-tauri/              # Rust/Tauri 后端
│   ├── src/lib.rs          # 扫描、SQLite 读取、watcher、导出和图片命令
│   ├── capabilities/       # Tauri 权限配置
│   └── tauri.conf.json     # Tauri 应用配置
├── scripts/                # 工具脚本
└── public/                 # 静态资源
```

## 数据模型

Codex Gallery 会组合两类本地数据：

- 图片文件：`~/.codex/generated_images/{thread_id}`
- 会话元数据：`~/.codex/state_5.sqlite`

扫描阶段只返回轻量图片元数据。缩略图和原图数据会通过独立的 Tauri command 按需读取。

## 当前限制

- v1 是 macOS-first。
- 默认 Codex 数据目录固定为 `~/.codex`。
- 导出目录目前默认是 Downloads。
- 导出文件名目前默认保留原始文件名。
- 暂时还没有正式 release 流程。
- 截图和项目 logo 仍待补充。

## Roadmap

- 支持自定义 Codex 数据目录。
- 支持 Windows。
- 支持更灵活的导出命名模板。
- 优化多选操作体验。
- 增加缩略图缓存清理。
- 增加签名和 release workflow。
- 增加更多扫描、Missing Session、导出相关测试。

## 贡献

欢迎提交 issue 和 pull request。

提交 PR 前建议先运行：

```sh
pnpm lint
pnpm build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

贡献时请尽量遵守这些原则：

- 保持本地优先。
- 不写入 `~/.codex`。
- 文件访问权限尽量收窄。
- 优先保持 UI 简洁、克制、易理解。
- 修改图片扫描或导出逻辑时，请补充对应测试。

## License

本项目使用 MIT License。详见 [LICENSE](./LICENSE)。

## 免责声明

Codex Gallery 与 OpenAI 没有关联，也不是 OpenAI 官方维护或背书的项目。它只是一个用于浏览 Codex 本地生成图片的独立伴侣应用。
