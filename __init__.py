from .batch_load_images import BatchLoadImages, PromptQueue, AICoser_TextList, AICoser_SplitLines, AICoser_PromptTemplate, AICoser_TextBox, AICoser_LoadVideoUpload, AICoser_VideoInfo

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "BatchLoadImages": BatchLoadImages,
    "PromptQueue": PromptQueue,
    "AICoser_TextList": AICoser_TextList,
    "AICoser_SplitLines": AICoser_SplitLines,
    "AICoser_PromptTemplate": AICoser_PromptTemplate,
    "AICoser_TextBox": AICoser_TextBox,
    "AICoser_LoadVideoUpload": AICoser_LoadVideoUpload,
    "AICoser_VideoInfo": AICoser_VideoInfo,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BatchLoadImages": "ComfyUI-AICoser-BatchLoadImages",
    "PromptQueue": "ComfyUI-AICoser-PromptQueue",
    "AICoser_TextList": "ComfyUI-AICoser-TextList",
    "AICoser_SplitLines": "ComfyUI-AICoser-SplitLines",
    "AICoser_PromptTemplate": "ComfyUI-AICoser Prompt Template",
    "AICoser_TextBox": "ComfyUI-AICoser Text Box",
    "AICoser_LoadVideoUpload": "ComfyUI-AICoser Load Video (Upload)",
    "AICoser_VideoInfo": "ComfyUI-AICoser Video Info",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
