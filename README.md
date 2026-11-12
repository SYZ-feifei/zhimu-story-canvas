# 枝幕 Zhimu Story Canvas

枝幕是一款为影视剧本开发设计的 Windows 桌面软件。把梗概、情节动作、前因后果和伏笔放在同一张无限画布上。在任意节拍探索备选，比较它们会改动哪些前后剧情，再把选中的方案锁进主线。

![枝幕的故事画布、编剧台和情绪曲线](docs/preview.png)

## 运行桌面版

双击 Windows x64 便携版 `Zhimu-0.1.0-Windows-x64.exe` 即可打开独立窗口。首次启动创建本机账号，登录后进入项目首页。可以新建项目、导入已有剧本，或点开虚构示例《雨夜失物招领》进入画布。

![枝幕项目首页](docs/home.png)

从源码启动需要 Node.js 22.13 或更新版本。在仓库目录执行下面两条命令。

```sh
npm ci
npm start
```

运行 `npm run package:win` 可在 `dist/` 生成 Windows x64 便携版。开发时也可用 `npm run preview` 在本机浏览器预览界面。

## 在画布上推演

1. 写一句话梗概，记录已确定的人物、关系和规则。四拍推演可按 **C 反转底牌 → B 误导与施压 → A 失衡开场 → D 兑现与尾钩** 开发。主线大纲的顺序是成片的叙事顺序，可以手动调整。
2. 在卡片下方为该节点选择模型，点星标进入 **AI 发散**。可选同拍备选或后续情节。每轮的三个候选会随项目保存，选择 **应用为分支** 或 **应用到主线** 才添加卡片。
3. 用 **对比分支** 查看动作、前因、后果、伏笔和联动修改。应用新主线方案会把旧方案留作备选。需要长期沿用的节点细节可以存入项目的共享设定。
4. 拖动空白平移，拖动卡片调整布局，使用 Ctrl / Cmd 加滚轮或左下角控件缩放。用 **连线** 依次点选起点和终点，可标记额外因果关系。
5. 下方曲线按当前主线排列。紫线表示观众情绪正负（−5 到 +5），橙线表示冲突或悬念张力（0 到 10）。点选曲线可定位到相应剧情。分值可以手动录入，也可以用当前模型批量标注，再由创作者调整。

## 接入模型

打开右上角 **模型** 添加配置，再在各节点选择。不同模型会读取同一份项目底稿，包括共享设定、完整主线的结构化剧情、已上画布的备选及因果连线。主线与备选在发送的上下文中有明确标识，当前焦点的场景正文也会发送。模型 ID 以你在对应服务看到的值为准。

| 接口类型 | 默认 API Base URL | 密钥 |
| --- | --- | --- |
| [OpenAI 兼容](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) | `https://api.openai.com/v1` | 云服务使用该服务的 API Key |
| [Anthropic](https://platform.claude.com/docs/en/api/messages/create) | `https://api.anthropic.com/v1` | Anthropic API Key |
| [Gemini](https://ai.google.dev/api/generate-content) | `https://generativelanguage.googleapis.com/v1beta` | Gemini API Key |
| [Ollama](https://docs.ollama.com/api/openai-compatibility) | `http://127.0.0.1:11434/v1` | 本机服务可留空 |

Base URL 填接口前缀，例如 `https://api.openai.com/v1`。枝幕根据配置追加请求路径。选模型后用 **测试连接** 检查凭据、地址和模型 ID。

界面中填写的 Key 只留在本次打开期间的内存。需要固定一个本机默认配置时，可按 `.env.example` 填写 `STORY_AI_PROVIDER`、`STORY_AI_MODEL` 及所需地址和密钥。从源码启动时使用仓库内的 `.env`，便携版使用 `%APPDATA%\ZhimuStoryCanvas\model.env`。重启枝幕后在模型设置中选择 **本机环境配置**。所选模型服务会收到完成本轮操作所需的剧情上下文。

## 导入剧本并拆解

在首页选 **导入剧本**，选择或拖入 DOCX、带文字层的 PDF、Markdown、TXT 或 Fountain。文件读完后选模型和作品体量，点 **拆解结构**。较长的文本会逐段提取线索，再合并成结构。审阅情节节点、结构诊断和可在原文中核对的引句，勾选要保留的节点并 **应用为新项目**。单个文档上限 16 MB，正文上限 18 万字符。

## 导出与备份

- **Word、PDF、Markdown、纯文本**导出当前主线、梗概、已定设定、节点因果、伏笔、情绪标注及已写入的场景正文。
- **项目 JSON**保留所有节点、待选候选、模型配置引用、备选、画布坐标、因果连线和主线顺序。在首页选 **导入项目备份** 恢复为独立项目。换电脑后可以重新为节点选择可用模型。

桌面版按本机账号保存项目，每个项目最多 500 个节点。

## 源码

- `public/` 包含工作台、画布、情绪曲线和项目数据结构。
- `lib/ai.mjs` 包含模型接口适配及剧本开发提示词。
- `lib/documents.mjs` 负责各格式导出，`lib/service.mjs` 提供应用内接口。
- `lib/import.mjs` 读取剧本文字，`lib/accounts.mjs` 管理本机账号。
- `desktop.mjs` 启动桌面窗口，`server.mjs` 提供开发预览。

节点交互参考了 LibTV 的画布形式。枝幕将节点用于剧本节拍、因果和备选路线。 [LibTV 官网](https://www.liblib.tv/)

代码采用 [MIT 许可](LICENSE)。PDF 内嵌 Noto Sans SC 字体。示例故事、封面与 SYZ 图标为本项目制作。 [字体项目](https://github.com/notofonts/noto-cjk) · [字体许可](lib/fonts/OFL.txt)

<details>
<summary>SYZ 图标</summary>

`public/assets/syz.png` 由内置 ImageGen 生成并精修。S 曲线对应故事推进，Y 分叉对应多条备选，Z 的折线与末端节点对应选定路线继续向下一拍推进。

> Generate a genuinely designed abstract SYZ monogram symbol as a polished square Windows app icon, completely fresh concept. A single continuous custom geometric ribbon glyph merges an S-shaped curved upper path, a Y junction with one short split arm, and an angular Z-like lower turn in the same central sign. Shared strokes and thoughtfully cut negative space form the letter references. One bold clean silhouette, recognizable even at 24 pixels. The emblem is pale periwinkle and nearly white at its top, softly violet at its base, on a very dark ink-plum rounded-square tile. Use restrained modern graphic design, crisp vector-like edges, optical balance, generous negative space, and at most one tiny lilac terminal to suggest a story node. The icon tile fills about 94 percent of the square image, with transparent alpha outside the tile. Show a single straight-on finished icon centered, no separate typography, no caption, no accompanying wordmark, no shadows outside the tile, no 3D or mockup, no watermark.

> Produce a clean finished app-icon version of the supplied SYZ ribbon monogram. Preserve the distinct continuous S curve, Y-shaped branch, angular Z foot, and the single small lilac terminal at lower right. Preserve their overall shape, location, proportions, and pale-lavender-to-violet fill. Set them on one perfectly clean, fully opaque, smooth midnight ink-plum rounded-square tile, with very subtle uniform tonal gradient and no surface texture. The background immediately to the right of the Y branch is continuous clean dark plum. The only transparent pixels are the exterior beyond the rounded-square tile. Large crisp centered flat icon suitable for the Windows taskbar. The ribbon, one dot, and one tile are the complete artwork.

</details>

<details>
<summary>示例封面来源</summary>

`public/assets/rain.png` 由内置 ImageGen 生成。使用的提示词如下。

> Create a landscape cinematic film still for a small thumbnail cover of an original Chinese suspense short about a red umbrella in a train station lost-and-found office. Medium-wide shot through a rain-speckled glass ticket window late at night. A single folded vivid vermilion umbrella, with its curved handle visible, leans at the center-right of a worn counter beside a few small blank paper claim slips. Warm tungsten task lamp inside, desaturated midnight blue and teal reflections outside, strong contrast, realistic water and metal textures, restrained 35mm film grain. Compose so the umbrella and lamp are immediately legible in a tight 2:1 horizontal crop at very small size. Contemporary modest municipal station, completely empty, no people. No legible text, no typography, no logos, no watermark.

</details>
