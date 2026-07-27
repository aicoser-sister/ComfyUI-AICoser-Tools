from .batch_load_images import BatchLoadImages, PromptQueue, AICoser_TextList, AICoser_SplitLines, AICoser_PromptTemplate, AICoser_TextBox, AICoser_LoadVideoUpload, AICoser_VideoInfo, _register_aicoser_routes

WEB_DIRECTORY = "./web"

from server import PromptServer

_orig_setup = PromptServer.setup
def _patched_setup(self, *args, **kwargs):
    result = _orig_setup(self, *args, **kwargs)
    try:
        _register_aicoser_routes()
    except Exception as e:
        print(f"[AICoser] route registration failed: {e}")
    return result
PromptServer.setup = _patched_setup

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
