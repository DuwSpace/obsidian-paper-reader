# Paper Reader

支持 Codex 和 OpenCode 的 Obsidian 桌面端论文阅读助手。

阅读视图中直接拖选正文、公式及本地图片，侧栏流式解释；较长解读和研究想法可保存为独立笔记，并自动关联来源章节。插件本身免费，模型服务可能需要账号、订阅或 API 费用。

公开版本采用独立 ID `paper-reader`，不会读取旧版 `codex-reader` 的私人对话。默认归档根目录为 `Papers`，子目录为 `Explanations` 和 `Ideas`。设置中可改为原有的 `omni`、`解读` 和 `想法`，并将元数据与回答语言改为中文。

侧栏「执行后端」切换 Codex/OpenCode，各自记住模型与思考强度。「刷新」从本机后端重新读取模型。OpenCode 模型 ID 使用 `provider/model`。当前界面仍有中文控件；英文使用说明见仓库首页。

需要自行安装并配置 Codex 或 OpenCode。插件不分发密钥、模型厂商配置、论文或个人对话。只在 macOS、Obsidian 1.13.7、Codex 0.155.1、OpenCode 1.3.0 验证过真实应用行为。

安装步骤、限制、开发方法详见 [README](../README.md)。使用前请阅读 [数据与权限说明](privacy.md)，尤其注意 OpenCode 任务权限不等同于系统沙箱。
