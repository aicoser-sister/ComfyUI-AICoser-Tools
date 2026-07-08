# ComfyUI-AICoser-Tools

ComfyUI 自定义工具节点集合。

## 节点列表

| 节点 | 显示名称 | 说明 |
|---|---|---|
| BatchLoadImages | ComfyUI-AICoser-BatchLoadImages | 批量加载图片，支持队列管理 |
| PromptQueue | ComfyUI-AICoser-PromptQueue | 提示词队列 |
| AICoser_TextList | ComfyUI-AICoser-TextList | 文本列表 |
| AICoser_SplitLines | ComfyUI-AICoser-SplitLines | 按行拆分文本 |
| AICoser_PromptTemplate | ComfyUI-AICoser Prompt Template | 提示词模板，支持 `@N` 变量替换和嵌套 |
| AICoser_TextBox | ComfyUI-AICoser Text Box | 纯文本输入框节点 |
| AICoser_LoadVideoUpload | ComfyUI-AICoser Load Video (Upload) | 视频上传与帧提取 |
| AICoser_VideoInfo | ComfyUI-AICoser Video Info | 视频信息 |

## 安装

将本目录放入 ComfyUI 的 `custom_nodes` 文件夹下，重启 ComfyUI。

## AICoser_PromptTemplate

模板节点支持 `@1`~`@8` 变量替换，将 `text1`~`text8` 的连线输入替换到模板字符串中。

支持嵌套：`@1` 的内容中如果也包含 `@2`，会递归替换，最大深度 10 层。

示例：
- 模板：`这个@1的女人，穿着@2的衣服`
- text1 连接 TextBox 输入 `漂亮`
- text2 连接 TextBox 输入 `红色`
- 输出：`这个漂亮的女人，穿着红色的衣服`
