import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function getImageListWidget(node) {
    return node?.widgets?.find((w) => w.name === "image_list");
}

function clampInt(v, min, max) {
    v = Math.floor(Number(v));
    if (Number.isNaN(v)) v = min;
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
}

function buildVNCCSPrompt(data) {
    const azimuth = clampInt(data?.azimuth ?? 0, 0, 360) % 360;
    const elevation = clampInt(data?.elevation ?? 0, -30, 60);
    const distance = data?.distance ?? "medium shot";
    const include_trigger = data?.include_trigger !== false;

    const azimuthMap = {
        0: "front view",
        45: "front-right quarter view",
        90: "right side view",
        135: "back-right quarter view",
        180: "back view",
        225: "back-left quarter view",
        270: "left side view",
        315: "front-left quarter view",
    };

    const closestAzimuth = azimuth > 337.5 ? 0 : Object.keys(azimuthMap).map((k) => Number(k)).reduce((best, k) => {
        return Math.abs(k - azimuth) < Math.abs(best - azimuth) ? k : best;
    }, 0);

    const elevationMap = {
        "-30": "low-angle shot",
        "0": "eye-level shot",
        "30": "elevated shot",
        "60": "high-angle shot",
    };

    const closestElevation = Object.keys(elevationMap).map((k) => Number(k)).reduce((best, k) => {
        return Math.abs(k - elevation) < Math.abs(best - elevation) ? k : best;
    }, 0);

    const parts = [];
    if (include_trigger) parts.push("<sks>");
    parts.push(azimuthMap[closestAzimuth]);
    parts.push(elevationMap[String(closestElevation)]);
    parts.push(distance);
    return parts.join(" ");
}

function createVNCCSVisualUI(node) {
    const w = getCameraDataWidget(node);
    if (!w) return null;

    w.type = "hidden";
    w.computeSize = () => [0, -4];

    const container = document.createElement("div");
    container.style.cssText =
        "width:100%;padding:8px;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:6px;margin:5px 0;pointer-events:auto;";

    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";

    const mkField = (labelText) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
        const label = document.createElement("div");
        label.textContent = labelText;
        label.style.cssText = "font-size:12px;opacity:0.9;";
        wrap.appendChild(label);
        return { wrap };
    };

    const azF = mkField("azimuth");
    const elF = mkField("elevation");
    const distF = mkField("distance");
    const trigF = mkField("trigger");

    const az = document.createElement("input");
    az.type = "range";
    az.min = "0";
    az.max = "360";
    az.step = "45";

    const el = document.createElement("input");
    el.type = "range";
    el.min = "-30";
    el.max = "60";
    el.step = "30";

    const dist = document.createElement("select");
    for (const v of ["close-up", "medium shot", "wide shot"]) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        dist.appendChild(opt);
    }

    const trig = document.createElement("input");
    trig.type = "checkbox";

    const azVal = document.createElement("div");
    azVal.style.cssText = "font-size:12px;opacity:0.8;";
    const elVal = document.createElement("div");
    elVal.style.cssText = "font-size:12px;opacity:0.8;";

    const promptOut = document.createElement("input");
    promptOut.type = "text";
    promptOut.readOnly = true;
    promptOut.style.cssText =
        "width:100%;padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;";

    azF.wrap.appendChild(az);
    azF.wrap.appendChild(azVal);
    elF.wrap.appendChild(el);
    elF.wrap.appendChild(elVal);
    distF.wrap.appendChild(dist);
    trigF.wrap.appendChild(trig);

    row.appendChild(azF.wrap);
    row.appendChild(elF.wrap);
    row.appendChild(distF.wrap);
    row.appendChild(trigF.wrap);

    const write = () => {
        const data = {
            azimuth: clampInt(az.value, 0, 360),
            elevation: clampInt(el.value, -30, 60),
            distance: dist.value,
            include_trigger: !!trig.checked,
        };
        w.value = JSON.stringify(data);
        w.callback?.(w.value);
        azVal.textContent = String(data.azimuth);
        elVal.textContent = String(data.elevation);
        promptOut.value = buildVNCCSPrompt(data);
    };

    const read = () => {
        let data;
        try {
            data = JSON.parse(w.value || "{}");
        } catch {
            data = {};
        }
        az.value = String(clampInt(data?.azimuth ?? 0, 0, 360));
        el.value = String(clampInt(data?.elevation ?? 0, -30, 60));
        dist.value = data?.distance ?? "medium shot";
        trig.checked = data?.include_trigger !== false;
        write();
    };

    az.addEventListener("input", write);
    el.addEventListener("input", write);
    dist.addEventListener("change", write);
    trig.addEventListener("change", write);

    container.appendChild(row);
    container.appendChild(promptOut);

    return { container, read };
}

function parseImageList(text) {
    return (text || "")
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => !!s);
}

function setImageList(node, names) {
    const w = getImageListWidget(node);
    if (!w) return;
    w.value = (names || []).join("\n");
    w.callback?.(w.value);
}

function getMaxImagesValue(node) {
    const w = node?.widgets?.find((x) => x.name === "max_images");
    const v = w?.value;
    return typeof v === "number" ? v : 0;
}

function deepClone(obj) {
    if (typeof structuredClone === "function") return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

function getWidgetByName(node, name) {
    return node?.widgets?.find((w) => w.name === name);
}

function getCameraDataWidget(node) {
    return getWidgetByName(node, "camera_data");
}

function registerExtensionSafe(extension) {
    try {
        app.registerExtension(extension);
    } catch (e) {
        const message = String(e?.message || e || "");
        if (message.includes("already registered")) {
            console.warn(`[ComfyUI-AICoser-Tools] extension already registered, skipped: ${extension?.name}`);
            return;
        }
        throw e;
    }
}

async function queueCurrent(node) {
    const prompt = await app.graphToPrompt();
    await api.queuePrompt(-1, prompt);
}

async function queueAllSequential(node) {
    const names0 = parseImageList(getImageListWidget(node)?.value);
    if (!names0 || names0.length === 0) return;

    const maxImages = getMaxImagesValue(node);
    const names = maxImages && maxImages > 0 ? names0.slice(0, maxImages) : names0;
    if (names.length === 0) return;

    const wMode = getWidgetByName(node, "mode");
    const wIndex = getWidgetByName(node, "index");
    if (!wMode || !wIndex) {
        // Fallback: modify prompt JSON directly.
        const basePrompt = await app.graphToPrompt();
        const nodeId = String(node.id);
        for (let i = 0; i < names.length; i++) {
            const prompt = deepClone(basePrompt);
            const apiNode = prompt.output?.[nodeId];
            if (!apiNode) continue;
            apiNode.inputs = apiNode.inputs || {};
            apiNode.inputs.mode = "single";
            apiNode.inputs.index = i;
            await api.queuePrompt(-1, prompt);
        }
        return;
    }

    const prevMode = wMode.value;
    const prevIndex = wIndex.value;
    try {
        wMode.value = "single";
        wMode.callback?.(wMode.value);
        for (let i = 0; i < names.length; i++) {
            wIndex.value = i;
            wIndex.callback?.(wIndex.value);
            await queueCurrent(node);
        }
    } finally {
        wMode.value = prevMode;
        wMode.callback?.(wMode.value);
        wIndex.value = prevIndex;
        wIndex.callback?.(wIndex.value);
    }
}

function getViewUrl(filename) {
    const previewParam = app.getPreviewFormatParam?.() || "";
    const randParam = app.getRandParam?.() || "";
    const normalized = String(filename || "").replace(/\\/g, "/");
    const parts = normalized.split("/");
    const basename = parts.pop() || "";
    const subfolder = parts.join("/");
    const subfolderParam = subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : "";
    return api.apiURL(`/view?filename=${encodeURIComponent(basename)}&type=input${subfolderParam}${previewParam}${randParam}`);
}

async function fetchVideoMetadata(filename) {
    if (!filename) return null;
    const resp = await api.fetchApi(`/aicoser/video_metadata?filename=${encodeURIComponent(filename)}`);
    if (!resp.ok) {
        throw new Error(`video metadata failed: HTTP ${resp.status}`);
    }
    return await resp.json();
}

function isFilesDragEvent(e) {
    const dt = e?.dataTransfer;
    if (!dt) return false;
    if (dt.files && dt.files.length > 0) return true;
    // Some browsers only set types during dragover
    return Array.from(dt.types || []).includes("Files");
}

let _globalDragDropInstalled = false;
let _currentDraggingUI = null;
const _batchLoadImagesDomUIs = new Set();
const AICOSER_UPLOAD_SUBFOLDER = "aicoser_uploads";

function _isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function _getUIUnderPointer(e) {
    const x = e?.clientX;
    const y = e?.clientY;
    if (typeof x !== "number" || typeof y !== "number") return null;

    for (const entry of _batchLoadImagesDomUIs) {
        const rect = entry?.container?.getBoundingClientRect?.();
        if (!rect) continue;
        if (_isPointInRect(x, y, rect)) return entry;
    }
    return null;
}

function _setDraggingUI(activeEntry) {
    for (const entry of _batchLoadImagesDomUIs) {
        entry?.setDragging?.(entry === activeEntry);
    }
}

function ensureGlobalDragDropPrevention() {
    if (_globalDragDropInstalled) return;
    _globalDragDropInstalled = true;

    window.addEventListener(
        "dragover",
        (e) => {
            if (!isFilesDragEvent(e)) return;
            const hit = _getUIUnderPointer(e);
            _setDraggingUI(hit);
            if (!hit) return;
            e.preventDefault();
        },
        { capture: true }
    );

    window.addEventListener(
        "drop",
        async (e) => {
            if (!isFilesDragEvent(e)) return;

            const hit = _getUIUnderPointer(e);
            _setDraggingUI(null);
            if (!hit) return;
            e.preventDefault();

            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length === 0) return;
            await uploadFilesSequential(hit.node, files, { replace: false });
            hit.redraw?.();
        },
        { capture: true }
    );

    window.addEventListener(
        "dragleave",
        (e) => {
            if (!isFilesDragEvent(e)) return;
            _setDraggingUI(null);
        },
        { capture: true }
    );
}

async function uploadOneImage(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("type", "input");

    const resp = await api.fetchApi("/upload/image", {
        method: "POST",
        body,
    });

    if (!resp.ok) {
        throw new Error(await resp.text());
    }

    const json = await resp.json();
    return json?.name;
}

async function uploadOneVideo(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("type", "input");
    body.append("subfolder", AICOSER_UPLOAD_SUBFOLDER);

    const resp = await api.fetchApi("/upload/image", {
        method: "POST",
        body,
    });
    if (!resp.ok) {
        throw new Error(`Upload failed: HTTP ${resp.status}`);
    }
    const json = await resp.json();
    const name = json?.name;
    const subfolder = json?.subfolder || AICOSER_UPLOAD_SUBFOLDER;
    if (!name) return "";
    return subfolder ? `${subfolder}/${name}` : name;
}

async function uploadFilesSequential(node, files, { replace = false } = {}) {
    const w = getImageListWidget(node);
    if (!w) return [];

    const existing = replace ? [] : parseImageList(w.value);
    const uploaded = [];

    for (const file of files) {
        if (!file) continue;
        // skip non-images
        if (file?.type && !file.type.startsWith("image/")) continue;
        const name = await uploadOneImage(file);
        if (name) uploaded.push(name);
    }

    const merged = existing.concat(uploaded);
    setImageList(node, merged);
    return uploaded;
}

function openMultiSelect(node, { replace = false } = {}) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = async (e) => {
        try {
            const files = Array.from(e.target.files || []);
            await uploadFilesSequential(node, files, { replace });
        } finally {
            document.body.removeChild(input);
        }
    };

    input.click();
}

function openFolderSelect(node, { replace = false } = {}) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.multiple = true;
    input.webkitdirectory = true;
    input.directory = true;
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = async (e) => {
        try {
            let files = Array.from(e.target.files || []);
            const allowExt = new Set([".png", ".jpg", ".jpeg"]);
            files = files.filter((f) => {
                const name = (f?.name || "").toLowerCase();
                for (const ext of allowExt) {
                    if (name.endsWith(ext)) return true;
                }
                return false;
            });
            // keep stable ordering
            files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
            await uploadFilesSequential(node, files, { replace });
        } finally {
            document.body.removeChild(input);
        }
    };

    input.click();
}

function createBrowserUI(node) {
    const container = document.createElement("div");
    container.style.cssText =
        "width:100%;padding:8px;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:6px;margin:5px 0;pointer-events:auto;";

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px;";

    const mkBtn = (label) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText =
            "flex:1;padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:13px;";
        return b;
    };

    const replaceBtn = mkBtn("Select Images");
    const addBtn = mkBtn("Add Images");
    const folderBtn = mkBtn("Select Folder");
    const queueBtn = mkBtn("Queue All");
    const queueOneBtn = mkBtn("Queue Current");

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.style.cssText =
        "padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:13px;";

    btnRow.appendChild(replaceBtn);
    btnRow.appendChild(addBtn);
    btnRow.appendChild(folderBtn);
    btnRow.appendChild(queueBtn);
    btnRow.appendChild(queueOneBtn);
    btnRow.appendChild(clearBtn);

    const info = document.createElement("div");
    info.style.cssText = "font-size:12px;opacity:0.85;margin-bottom:6px;";

    const grid = document.createElement("div");
    grid.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;max-height:260px;overflow-y:auto;background:var(--comfy-input-bg);padding:6px;border-radius:4px;";

    const updateInfo = () => {
        const names = parseImageList(getImageListWidget(node)?.value);
        info.textContent = `已选择 ${names.length} 张（可拖拽图片到此面板/节点上）`;
    };

    const redraw = () => {
        const names = parseImageList(getImageListWidget(node)?.value);
        grid.innerHTML = "";

        const frag = document.createDocumentFragment();
        names.forEach((name, idx) => {
            const cell = document.createElement("div");
            cell.style.cssText = "display:flex;flex-direction:column;gap:3px;";

            const thumb = document.createElement("div");
            thumb.style.cssText =
                "position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;border:1px solid var(--border-color);background:#000;";

            const img = document.createElement("img");
            img.src = getViewUrl(name);
            img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";

            const del = document.createElement("button");
            del.textContent = "×";
            del.title = "删除";
            del.style.cssText =
                "position:absolute;top:2px;right:2px;width:20px;height:20px;background:rgba(255,0,0,0.75);color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:16px;line-height:1;";
            del.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = names.slice(0, idx).concat(names.slice(idx + 1));
                setImageList(node, next);
                redraw();
            };

            const label = document.createElement("div");
            label.textContent = name;
            label.title = name;
            label.style.cssText =
                "font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.9;";

            thumb.appendChild(img);
            thumb.appendChild(del);
            cell.appendChild(thumb);
            cell.appendChild(label);
            frag.appendChild(cell);
        });

        grid.appendChild(frag);
        updateInfo();
        app.graph.setDirtyCanvas(true);
    };

    const handleDropFiles = async (files, { replace = false } = {}) => {
        if (!files || files.length === 0) return;
        await uploadFilesSequential(node, files, { replace });
        redraw();
    };

    // Most reliable: handle drop on our DOM panel.
    container.addEventListener("dragover", (e) => {
        if (!isFilesDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
    });

    container.addEventListener("drop", async (e) => {
        if (!isFilesDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer?.files || []);
        await handleDropFiles(files, { replace: false });
    });

    const setDragging = (on) => {
        container.style.border = on ? "2px dashed #4a6" : "1px solid var(--border-color)";
    };

    replaceBtn.onclick = async () => {
        openMultiSelect(node, { replace: true });
    };
    addBtn.onclick = async () => {
        openMultiSelect(node, { replace: false });
    };
    folderBtn.onclick = async () => {
        openFolderSelect(node, { replace: true });
    };
    queueBtn.onclick = async () => {
        await queueAllSequential(node);
    };
    queueOneBtn.onclick = async () => {
        const wMode = getWidgetByName(node, "mode");
        if (wMode) {
            wMode.value = "single";
            wMode.callback?.(wMode.value);
        }
        await queueCurrent(node);
    };
    clearBtn.onclick = () => {
        setImageList(node, []);
        redraw();
    };

    container.appendChild(btnRow);
    container.appendChild(info);
    container.appendChild(grid);

    return { container, redraw, setDragging };
}

function getVideoWidget(node) {
    return getWidgetByName(node, "video");
}

function setWidgetValue(node, name, value) {
    const w = getWidgetByName(node, name);
    if (!w) return;
    w.value = value;
    w.callback?.(w.value);
    app.graph.setDirtyCanvas(true);
}

function getWidgetNumber(node, name, fallback = 0) {
    const w = getWidgetByName(node, name);
    const n = Number(w?.value);
    return Number.isFinite(n) ? n : fallback;
}

function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0.000s";
    return `${sec.toFixed(3)}s`;
}

const AICOSER_VIDEO_NODE_MIN_WIDTH = 460;
const AICOSER_VIDEO_NODE_MIN_HEIGHT = 560;
const AICOSER_VIDEO_NODE_DEFAULT_HEIGHT = 640;
const AICOSER_VIDEO_PREVIEW_MIN_HEIGHT = 160;
const AICOSER_VIDEO_PREVIEW_MAX_HEIGHT = 360;
const AICOSER_VIDEO_WIDGET_BASE_HEIGHT = 150;

function createVideoUploadUI(node) {
    const videoWidget = getVideoWidget(node);
    if (!videoWidget) {
        throw new Error("video widget not found");
    }
    const previewFpsWidget = getWidgetByName(node, "preview_fps");
    if (previewFpsWidget) {
        previewFpsWidget.type = "hidden";
        previewFpsWidget.computeSize = () => [0, -4];
    }
    let sourceVideoMeta = null;
    let metadataRequestId = 0;

    const container = document.createElement("div");
    container.style.cssText =
        "box-sizing:border-box;width:100%;min-height:280px;padding:6px;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:6px;margin:4px 0;pointer-events:auto;display:flex;flex-direction:column;gap:6px;overflow:visible;position:relative;z-index:10;";

    const drop = document.createElement("div");
    drop.textContent = "Drop video here or click to upload";
    drop.style.cssText =
        "padding:7px;border:1px dashed var(--border-color);border-radius:6px;text-align:center;cursor:pointer;font-size:12px;";

    const video = document.createElement("video");
    video.controls = false;
    video.preload = "metadata";
    video.disablePictureInPicture = true;
    video.setAttribute("controlsList", "nodownload noplaybackrate");
    video.style.cssText = "display:block;width:100%;height:100%;object-fit:fill;background:#000;";

    const previewWrap = document.createElement("div");
    previewWrap.style.cssText = `width:100%;height:${AICOSER_VIDEO_PREVIEW_MIN_HEIGHT}px;overflow:hidden;background:#000;border-radius:4px;margin:0 auto;`;
    previewWrap.appendChild(video);

    const info = document.createElement("div");
    info.style.cssText = "box-sizing:border-box;font-size:11px;line-height:1.25;opacity:0.95;min-height:42px;overflow:hidden;padding:4px 6px;background:rgba(0,0,0,0.18);border-radius:4px;display:flex;flex-direction:column;gap:2px;";

    const controls = document.createElement("div");
    controls.style.cssText = "box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:4px 6px;background:rgba(0,0,0,0.18);border-radius:4px;";

    const playBtn = document.createElement("button");
    playBtn.textContent = "▶";
    playBtn.style.cssText = "width:30px;height:24px;padding:0;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:12px;line-height:1;";

    const frameLabel = document.createElement("div");
    frameLabel.style.cssText = "min-width:82px;font-size:11px;opacity:0.95;white-space:nowrap;";

    const progressWrap = document.createElement("div");
    progressWrap.style.cssText = "position:relative;flex:1;height:18px;cursor:pointer;";

    const progressTrack = document.createElement("div");
    progressTrack.style.cssText = "position:absolute;left:0;right:0;top:7px;height:4px;background:rgba(255,255,255,0.18);border-radius:999px;overflow:hidden;";

    const rangeFill = document.createElement("div");
    rangeFill.style.cssText = "position:absolute;top:0;height:100%;background:rgba(80,180,255,0.28);";

    const progressFill = document.createElement("div");
    progressFill.style.cssText = "position:absolute;left:0;top:0;height:100%;width:0%;background:rgba(255,255,255,0.72);";

    const startMarker = document.createElement("div");
    startMarker.style.cssText = "position:absolute;top:2px;width:2px;height:14px;background:#6cf;border-radius:2px;transform:translateX(-1px);";

    const endMarker = document.createElement("div");
    endMarker.style.cssText = "position:absolute;top:2px;width:2px;height:14px;background:#f96;border-radius:2px;transform:translateX(-1px);";

    progressTrack.appendChild(rangeFill);
    progressTrack.appendChild(progressFill);
    progressWrap.appendChild(progressTrack);
    progressWrap.appendChild(startMarker);
    progressWrap.appendChild(endMarker);
    controls.appendChild(playBtn);
    controls.appendChild(frameLabel);
    controls.appendChild(progressWrap);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:5px;flex-wrap:wrap;";

    const mkBtn = (label) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText =
            "flex:1;min-width:96px;padding:5px 6px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:11px;";
        return b;
    };
    const setStartBtn = mkBtn("Set Start");
    const setEndBtn = mkBtn("Set End");
    const resetRangeBtn = mkBtn("Reset Range");

    row.appendChild(setStartBtn);
    row.appendChild(setEndBtn);
    row.appendChild(resetRangeBtn);

    const refreshSource = () => {
        const filename = videoWidget.value;
        const requestId = ++metadataRequestId;
        sourceVideoMeta = null;
        video.pause();
        if (!filename) {
            video.removeAttribute("src");
            video.load();
            info.replaceChildren();
            return;
        }
        video.src = getViewUrl(filename);
        video.load();
        updateInfo();
        resizeNode();
        fetchVideoMetadata(filename)
            .then((meta) => {
                if (requestId !== metadataRequestId) return;
                sourceVideoMeta = meta;
                updateInfo();
                resizeNode();
            })
            .catch((e) => {
                if (requestId !== metadataRequestId) return;
                console.warn("[AICoser_LoadVideoUpload] video metadata unavailable, using preview_fps fallback", filename, e);
                updateInfo();
            });
    };

    const getOutputSize = () => {
        const sourceWidth = video.videoWidth || 0;
        const sourceHeight = video.videoHeight || 0;
        const customWidth = Math.max(0, Math.floor(getWidgetNumber(node, "custom_width", 0)));
        const customHeight = Math.max(0, Math.floor(getWidgetNumber(node, "custom_height", 0)));
        if (customWidth > 0 && customHeight > 0) return [customWidth, customHeight];
        if (customWidth > 0 && sourceWidth > 0 && sourceHeight > 0) {
            return [customWidth, Math.max(1, Math.round(sourceHeight * (customWidth / sourceWidth)))];
        }
        if (customHeight > 0 && sourceWidth > 0 && sourceHeight > 0) {
            return [Math.max(1, Math.round(sourceWidth * (customHeight / sourceHeight))), customHeight];
        }
        return [sourceWidth || 16, sourceHeight || 9];
    };

    const resizeNode = () => {
        requestAnimationFrame(() => {
            const width = Math.max(AICOSER_VIDEO_NODE_MIN_WIDTH, node.size?.[0] || AICOSER_VIDEO_NODE_MIN_WIDTH);
            const height = Math.max(AICOSER_VIDEO_NODE_MIN_HEIGHT, node.size?.[1] || AICOSER_VIDEO_NODE_DEFAULT_HEIGHT);
            if ((node.size?.[0] || 0) < AICOSER_VIDEO_NODE_MIN_WIDTH || (node.size?.[1] || 0) < AICOSER_VIDEO_NODE_MIN_HEIGHT) {
                node.setSize?.([width, height]);
            }
            const [outputWidth, outputHeight] = getOutputSize();
            const aspectRatio = outputWidth / outputHeight;
            const maxPreviewWidth = Math.max(1, width - 24);
            const naturalHeight = Math.max(AICOSER_VIDEO_PREVIEW_MIN_HEIGHT, maxPreviewWidth / aspectRatio);
            const previewHeight = Math.min(AICOSER_VIDEO_PREVIEW_MAX_HEIGHT, naturalHeight);
            const previewWidth = Math.min(maxPreviewWidth, Math.max(1, previewHeight * aspectRatio));
            previewWrap.style.width = `${previewWidth}px`;
            previewWrap.style.height = `${previewHeight}px`;
            node._aicoserVideoWidgetHeight = AICOSER_VIDEO_WIDGET_BASE_HEIGHT + previewHeight;
            app.graph.setDirtyCanvas(true, true);
        });
    };

    const getSourceFps = () => Math.max(1, Number(sourceVideoMeta?.fps) || getWidgetNumber(node, "preview_fps", 24));
    const getDisplayFps = () => {
        const forceRate = Number(getWidgetNumber(node, "force_rate", 0));
        return Math.max(1, forceRate > 0 ? forceRate : getSourceFps());
    };
    const getPreviewRange = () => {
        const sourceFps = getSourceFps();
        const displayFps = getDisplayFps();
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const sourceTotalFrames = duration > 0 ? Math.round(duration * sourceFps) : 0;
        const displayTotalFrames = duration > 0 ? Math.round(duration * displayFps) : 0;
        const startFrame = Math.max(0, Math.min(displayTotalFrames, Math.floor(getWidgetNumber(node, "skip_first_frames", 0))));
        const cap = Math.max(0, Math.floor(getWidgetNumber(node, "frame_load_cap", 0)));
        const endFrame = cap > 0 ? Math.min(displayTotalFrames, startFrame + cap) : displayTotalFrames;
        const loadedTotalFrames = Math.max(0, endFrame - startFrame);
        return { sourceFps, displayFps, sourceTotalFrames, displayTotalFrames, startFrame, endFrame, loadedTotalFrames };
    };
    const clampFrameToPreviewRange = (frame) => {
        const { startFrame, endFrame } = getPreviewRange();
        if (endFrame > startFrame) return Math.max(startFrame, Math.min(frame, endFrame));
        return Math.max(0, frame);
    };
    const seekToPreviewStart = () => {
        const { displayFps, startFrame } = getPreviewRange();
        if (displayFps > 0) video.currentTime = (startFrame + 0.001) / displayFps;
        updateInfo();
    };
    const seekToPreviewStartIfOutside = () => {
        const { displayFps, startFrame, endFrame } = getPreviewRange();
        if (displayFps <= 0) return;
        const frame = Math.floor((video.currentTime || 0) * displayFps);
        if (frame < startFrame || (endFrame > startFrame && frame >= endFrame)) {
            video.currentTime = (startFrame + 0.001) / displayFps;
        }
        updateInfo();
    };

    const getOutputSizeText = () => getOutputSize().join("x");

    const updateCustomControls = () => {
        const { displayFps, displayTotalFrames, startFrame, endFrame } = getPreviewRange();
        const displayFrame = Math.max(0, Math.min(displayTotalFrames, Math.round((video.currentTime || 0) * displayFps)));
        const total = Math.max(1, displayTotalFrames);
        const startPct = Math.max(0, Math.min(100, (startFrame / total) * 100));
        const endPct = Math.max(startPct, Math.min(100, ((endFrame || displayTotalFrames) / total) * 100));
        const currentPct = Math.max(0, Math.min(100, (displayFrame / total) * 100));
        playBtn.textContent = video.paused ? "▶" : "❚❚";
        frameLabel.textContent = `${displayFrame}/${displayTotalFrames}`;
        progressFill.style.width = `${currentPct}%`;
        rangeFill.style.left = `${startPct}%`;
        rangeFill.style.width = `${Math.max(0, endPct - startPct)}%`;
        startMarker.style.left = `${startPct}%`;
        endMarker.style.left = `${endPct}%`;
        startMarker.title = `start ${startFrame}`;
        endMarker.title = `end ${endFrame || displayTotalFrames}`;
    };

    const updateInfo = () => {
        const { displayFps, displayTotalFrames, startFrame, endFrame } = getPreviewRange();
        const displayFrame = Math.max(0, Math.min(displayTotalFrames, Math.round((video.currentTime || 0) * displayFps)));
        const fileLine = document.createElement("div");
        fileLine.textContent = videoWidget.value || "";
        fileLine.title = videoWidget.value || "";
        fileLine.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;";

        const metaLine = document.createElement("div");
        metaLine.textContent = [
            `out ${getOutputSizeText()}`,
            `fps ${displayFps}`,
            `frame ${displayFrame}/${displayTotalFrames}`,
            `range ${startFrame}-${endFrame}`,
        ].join("   ");
        metaLine.title = metaLine.textContent;
        metaLine.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

        info.replaceChildren(fileLine, metaLine);
        updateCustomControls();
    };

    const seekToClientX = (clientX) => {
        const rect = progressWrap.getBoundingClientRect();
        if (!rect.width) return;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const { displayFps, displayTotalFrames } = getPreviewRange();
        const targetFrame = Math.max(0, Math.min(displayTotalFrames, Math.round(displayTotalFrames * pct)));
        if (displayFps > 0) video.currentTime = targetFrame / displayFps;
        updateInfo();
    };

    const chooseFile = async (file) => {
        if (!file) return;
        if (file.type && !file.type.startsWith("video/") && file.type !== "image/gif") return;
        const name = await uploadOneVideo(file);
        if (!videoWidget.options.values.includes(name)) {
            videoWidget.options.values.push(name);
        }
        videoWidget.value = name;
        videoWidget.callback?.(name);
        refreshSource();
        app.graph.setDirtyCanvas(true);
    };

    drop.onclick = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "video/webm,video/mp4,video/x-matroska,video/quicktime,image/gif";
        input.onchange = async (e) => {
            try {
                await chooseFile(e.target.files?.[0]);
            } finally {
                input.remove();
            }
        };
        document.body.appendChild(input);
        input.click();
    };

    container.addEventListener("dragover", (e) => {
        if (!isFilesDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        drop.style.borderColor = "#4a6";
    });
    container.addEventListener("dragleave", () => {
        drop.style.borderColor = "var(--border-color)";
    });
    container.addEventListener("drop", async (e) => {
        if (!isFilesDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        drop.style.borderColor = "var(--border-color)";
        await chooseFile(Array.from(e.dataTransfer?.files || [])[0]);
    });

    const preventVideoFullscreenGesture = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
    };
    previewWrap.addEventListener("dblclick", preventVideoFullscreenGesture, true);
    video.addEventListener("dblclick", preventVideoFullscreenGesture, true);
    video.addEventListener("mousedown", (e) => {
        if (e.detail > 1) preventVideoFullscreenGesture(e);
    }, true);
    video.addEventListener("pointerdown", (e) => {
        if (e.detail > 1) preventVideoFullscreenGesture(e);
    }, true);
    video.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement === video) {
            document.exitFullscreen?.();
        }
    });
    video.addEventListener("loadedmetadata", seekToPreviewStart);
    video.addEventListener("loadedmetadata", resizeNode);
    video.addEventListener("timeupdate", () => {
        const { displayFps, startFrame, endFrame } = getPreviewRange();
        if (!video.paused && startFrame > 0 && video.currentTime * displayFps < startFrame) {
            video.currentTime = startFrame / displayFps;
            updateInfo();
            return;
        }
        if (!video.paused && endFrame > 0 && video.currentTime * displayFps >= endFrame) {
            video.currentTime = startFrame / displayFps;
            if (video.paused) {
                updateInfo();
            }
            return;
        }
        updateInfo();
    });
    video.addEventListener("seeked", updateInfo);
    video.addEventListener("play", updateInfo);
    video.addEventListener("pause", updateInfo);

    playBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const { displayFps, startFrame, endFrame } = getPreviewRange();
        if (displayFps > 0 && endFrame > startFrame && (video.currentTime * displayFps < startFrame || video.currentTime * displayFps >= endFrame)) {
            video.currentTime = startFrame / displayFps;
        }
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
        updateInfo();
    };

    progressWrap.addEventListener("pointerdown", (e) => {
        const wasPaused = video.paused;
        if (!wasPaused) video.pause();
        e.preventDefault();
        e.stopPropagation();
        progressWrap.setPointerCapture?.(e.pointerId);
        seekToClientX(e.clientX);
        const move = (moveEvent) => seekToClientX(moveEvent.clientX);
        const up = () => {
            progressWrap.removeEventListener("pointermove", move);
            progressWrap.removeEventListener("pointerup", up);
            progressWrap.removeEventListener("pointercancel", up);
        };
        progressWrap.addEventListener("pointermove", move);
        progressWrap.addEventListener("pointerup", up);
        progressWrap.addEventListener("pointercancel", up);
    });

    setStartBtn.onclick = () => {
        const currentFrame = Math.max(0, Math.round((video.currentTime || 0) * getDisplayFps()));
        setWidgetValue(node, "skip_first_frames", currentFrame);
        seekToPreviewStart();
    };
    setEndBtn.onclick = () => {
        const currentFrame = Math.max(0, Math.round((video.currentTime || 0) * getDisplayFps()));
        const startFrame = Math.max(0, Math.floor(getWidgetNumber(node, "skip_first_frames", 0)));
        setWidgetValue(node, "frame_load_cap", Math.max(0, currentFrame - startFrame));
        seekToPreviewStartIfOutside();
    };
    resetRangeBtn.onclick = () => {
        setWidgetValue(node, "skip_first_frames", 0);
        setWidgetValue(node, "frame_load_cap", 0);
        seekToPreviewStart();
    };

    container.appendChild(drop);
    container.appendChild(previewWrap);
    container.appendChild(controls);
    container.appendChild(info);
    container.appendChild(row);

    const origCallback = videoWidget.callback;
    videoWidget.callback = function (value) {
        origCallback?.call(this, value);
        refreshSource();
    };

    for (const name of ["force_rate", "custom_width", "custom_height", "frame_load_cap", "skip_first_frames", "select_every_nth", "preview_fps"]) {
        const w = getWidgetByName(node, name);
        if (!w) continue;
        const orig = w.callback;
        w.callback = function (value) {
            orig?.call(this, value);
            if (name === "force_rate" || name === "skip_first_frames" || name === "frame_load_cap") {
                seekToPreviewStart();
            }
            updateInfo();
            resizeNode();
        };
    }

    refreshSource();
    resizeNode();
    return { container, refreshSource, updateInfo, resizeNode };
}

registerExtensionSafe({
    name: "BatchLoadImages.Extension",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "BatchLoadImages") return;

        ensureGlobalDragDropPrevention();

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated?.apply(this, arguments);

            const imageListWidget = getImageListWidget(this);
            if (imageListWidget) {
                // Hide the giant textbox; we manage it through the DOM UI.
                imageListWidget.type = "hidden";
                imageListWidget.computeSize = () => [0, -4];
            }

            // Create file-browser like UI
            const ui = createBrowserUI(this);
            this._batchLoadImagesUI = ui;
            const domWidget = this.addDOMWidget("batch_load_images", "customwidget", ui.container);
            domWidget.serialize = false;
            domWidget.hideOnZoom = false;
            domWidget.computeSize = function (width) {
                const h = Math.max(320, ui.container?.scrollHeight || 320);
                return [width, h];
            };
            this.setSize([420, 360]);

            _batchLoadImagesDomUIs.add({ node: this, container: ui.container, redraw: ui.redraw, setDragging: ui.setDragging });

            const prevOnRemoved = this.onRemoved;
            this.onRemoved = function () {
                for (const entry of _batchLoadImagesDomUIs) {
                    if (entry?.node === this) {
                        _batchLoadImagesDomUIs.delete(entry);
                        break;
                    }
                }
                return prevOnRemoved?.apply(this, arguments);
            };

            // Keep the DOM gallery in sync if something else changes the widget.
            if (imageListWidget) {
                const origCallback = imageListWidget.callback;
                imageListWidget.callback = function (value) {
                    origCallback?.call(this, value);
                    ui.redraw();
                };
            }

            ui.redraw();

            return r;
        };

        const origOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            origOnExecuted?.apply(this, arguments);
            this._batchLoadImagesUI?.redraw?.();
        };
    },
});

registerExtensionSafe({
    name: "AICoser.LoadVideoUpload.Extension",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AICoser_LoadVideoUpload") return;

        ensureGlobalDragDropPrevention();

        function scheduleEnsureVideoUploadUI(node) {
            requestAnimationFrame(() => ensureVideoUploadUI(node));
            setTimeout(() => ensureVideoUploadUI(node), 50);
            setTimeout(() => ensureVideoUploadUI(node), 250);
        }

        function mountVideoUploadWidget(node, container) {
            const widget = node.addDOMWidget("aicoser_video_upload", "customwidget", container);
            widget.serialize = false;
            widget.hideOnZoom = false;
            widget.computeSize = function (width) {
                const height = node._aicoserVideoWidgetHeight || AICOSER_VIDEO_WIDGET_BASE_HEIGHT + AICOSER_VIDEO_PREVIEW_MIN_HEIGHT;
                return [width, height];
            };
            node._aicoserVideoWidget = widget;
            return widget;
        }

        function ensureVideoUploadUI(node) {
            if (node._aicoserVideoUI) {
                const widgetMissing = !node._aicoserVideoWidget || !node.widgets?.includes(node._aicoserVideoWidget);
                if (widgetMissing) {
                    mountVideoUploadWidget(node, node._aicoserVideoUI.container);
                }
                node._aicoserVideoUI.refreshSource?.();
                node._aicoserVideoUI.resizeNode?.();
                return node._aicoserVideoUI;
            }

            let ui = null;
            try {
                ui = createVideoUploadUI(node);
            } catch (e) {
                if (e?.message === "video widget not found") {
                    console.warn("[AICoser_LoadVideoUpload] video widget not found, retrying", node?.widgets?.map((w) => w?.name));
                    return null;
                }
                console.error("[AICoser_LoadVideoUpload] failed to create video UI", e);
                const container = document.createElement("div");
                container.style.cssText = "box-sizing:border-box;width:100%;min-height:80px;padding:8px;background:#2a1111;border:1px solid #a44;border-radius:6px;color:#fff;font-size:12px;white-space:pre-wrap;pointer-events:auto;";
                container.textContent = `AICoser video UI failed:\n${e?.message || e}`;
                ui = {
                    container,
                    refreshSource: () => {},
                    updateInfo: () => {},
                    resizeNode: () => {},
                };
            }
            if (!ui) return null;

            node._aicoserVideoUI = ui;
            mountVideoUploadWidget(node, ui.container);
            node.setSize([
                Math.max(AICOSER_VIDEO_NODE_MIN_WIDTH, node.size?.[0] || AICOSER_VIDEO_NODE_MIN_WIDTH),
                Math.max(AICOSER_VIDEO_NODE_DEFAULT_HEIGHT, node.size?.[1] || AICOSER_VIDEO_NODE_DEFAULT_HEIGHT),
            ]);
            app.graph.setDirtyCanvas(true, true);
            return ui;
        }
        window.__aicoserEnsureVideoUploadUI = ensureVideoUploadUI;
        window.__aicoserScanVideoUploadUI?.();

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated?.apply(this, arguments);
            scheduleEnsureVideoUploadUI(this);
            return r;
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const r = origOnConfigure?.apply(this, arguments);
            scheduleEnsureVideoUploadUI(this);
            return r;
        };

        const origOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function () {
            const r = origOnAdded?.apply(this, arguments);
            scheduleEnsureVideoUploadUI(this);
            return r;
        };

        const origOnResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            const r = origOnResize?.apply(this, arguments);
            this._aicoserVideoUI?.resizeNode?.();
            return r;
        };
    },
    setup() {
        const fallbackEnsure = (node) => {
            if (node._aicoserVideoUI && node._aicoserVideoWidget && node.widgets?.includes(node._aicoserVideoWidget)) {
                node._aicoserVideoUI.refreshSource?.();
                node._aicoserVideoUI.resizeNode?.();
                return;
            }
            if (!node._aicoserVideoUI) {
                try {
                    node._aicoserVideoUI = createVideoUploadUI(node);
                } catch (e) {
                    console.error("[AICoser_LoadVideoUpload] fallback create failed", e);
                    return;
                }
            }
            const widget = node.addDOMWidget("aicoser_video_upload", "customwidget", node._aicoserVideoUI.container);
            widget.serialize = false;
            widget.hideOnZoom = false;
            widget.computeSize = function (width) {
                const height = node._aicoserVideoWidgetHeight || AICOSER_VIDEO_WIDGET_BASE_HEIGHT + AICOSER_VIDEO_PREVIEW_MIN_HEIGHT;
                return [width, height];
            };
            node._aicoserVideoWidget = widget;
            node.setSize([
                Math.max(AICOSER_VIDEO_NODE_MIN_WIDTH, node.size?.[0] || AICOSER_VIDEO_NODE_MIN_WIDTH),
                Math.max(AICOSER_VIDEO_NODE_DEFAULT_HEIGHT, node.size?.[1] || AICOSER_VIDEO_NODE_DEFAULT_HEIGHT),
            ]);
            node._aicoserVideoUI.refreshSource?.();
            node._aicoserVideoUI.resizeNode?.();
            app.graph.setDirtyCanvas(true, true);
        };
        const scan = () => {
            for (const node of app.graph?._nodes || []) {
                if (node?.type === "AICoser_LoadVideoUpload") {
                    if (window.__aicoserEnsureVideoUploadUI) {
                        window.__aicoserEnsureVideoUploadUI(node);
                    }
                    if (!node.widgets?.some((w) => w?.name === "aicoser_video_upload")) {
                        fallbackEnsure(node);
                    }
                }
            }
        };
        window.__aicoserScanVideoUploadUI = scan;
        requestAnimationFrame(scan);
        for (const delay of [50, 250, 500, 1000, 1500, 2500, 4000, 6000]) {
            setTimeout(scan, delay);
        }
    },
});

registerExtensionSafe({
    name: "VNCCS.VisualPositionControl.Extension",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "VNCCS_VisualPositionControl") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated?.apply(this, arguments);

            const ui = createVNCCSVisualUI(this);
            if (ui) {
                this.addDOMWidget("vnccs_visual", "customwidget", ui.container);
                this.setSize([420, 220]);
                ui.read();
            }

            return r;
        };
    },
});
