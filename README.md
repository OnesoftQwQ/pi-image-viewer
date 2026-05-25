# pi-image-viewer

[中文](#pi-image-viewer-中文) | [English](#pi-image-viewer-english)

---

## pi-image-viewer (中文)

让纯文本模型也能「看」图片的 Pi 扩展。

纯文本模型（如 DeepSeek V4 Flash）本身不支持图片输入。这个扩展会自动拦截粘贴或读取的图片，替换为 `[Image: ID = img_X]` 引用，并通过 `ask_image` 工具调用视觉模型来分析图片内容。

如果当前模型本身就支持图片（如 Qwen3.6-Plus），则图片直接通过，不拦截。

### 安装

```bash
# 从 GitHub 安装
pi install git:github.com/OnesoftQwQ/pi-image-viewer

# 或从 npm 安装
pi install npm:pi-image-viewer
```

### 使用方法

1. **粘贴图片** — `Ctrl+V` 或拖拽图片到 Pi 编辑器
2. **或读取图片文件** — 模型用 `read` 工具读取图片
3. 模型会自动使用 `ask_image` 工具来分析图片内容

#### 命令

| 命令 | 作用 |
|------|------|
| `/vision-model` | 交互式选择用于图片识别的视觉模型 |
| `/vision-status` | 查看当前视觉模型和拦截状态 |

### 配置

无需配置，开箱即用。扩展会自动：

1. 检查当前模型是否支持图片 → 支持则直接通过
2. 不支持则从同提供商找视觉模型（优先 qwen\*，其次选版本号最大的）
3. 都没有则从其他已登录的提供商找

也可以用 `/vision-model` 手动指定。

### 工作流程

模型会按以下流程处理图片：

1. 先问 `ask_image("请简要描述这张图片")` 获取概览
2. 再问 `ask_image("请详细描述...")` 或针对具体细节提问

### 开发

```bash
# 本地测试
pi -e ./extensions/image-viewer.ts

# 或放到自动发现目录
cp -r extensions ~/.pi/agent/extensions/image-viewer
pi
```

---

## pi-image-viewer (English)

Let pure-text models "see" images in Pi.

Pure-text models (e.g., DeepSeek V4 Flash) cannot process image inputs natively. This extension automatically intercepts pasted or read images, replaces them with `[Image: ID = img_X]` references, and provides an `ask_image` tool that calls a vision-capable model to analyze the image content.

If the current model already supports images natively (e.g., Qwen3.6-Plus), images pass through without interception.

### Installation

```bash
# Install from GitHub
pi install git:github.com/OnesoftQwQ/pi-image-viewer

# Or install from npm
pi install npm:pi-image-viewer
```

### Usage

1. **Paste an image** — `Ctrl+V` or drag & drop an image into the Pi editor
2. **Or read an image file** — the model reads it via the `read` tool
3. The model automatically uses the `ask_image` tool to analyze the image

#### Commands

| Command | Description |
|---------|-------------|
| `/vision-model` | Interactively select which vision model to use |
| `/vision-status` | Show current vision model and interception status |

### Configuration

No configuration needed — works out of the box. The extension automatically:

1. Checks if the current model supports images → if yes, passes through
2. If not, finds a vision model from the same provider (prefers `qwen*` models, otherwise picks the highest version number)
3. Falls back to other authenticated providers

You can also use `/vision-model` to set it manually.

### Workflow

The model follows this workflow when handling images:

1. First call `ask_image("Describe this image briefly.")` for an overview
2. Then call `ask_image("Describe this image in detail.")` or ask targeted questions for specific details

### Development

```bash
# Test locally
pi -e ./extensions/image-viewer.ts

# Or copy to auto-discovery directory
cp -r extensions ~/.pi/agent/extensions/image-viewer
pi
```

## License

MIT
