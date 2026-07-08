import { app } from "../../../scripts/app.js";

function getWidgetByName(node, name) {
    return node?.widgets?.find((w) => w.name === name);
}

function createTemplateUI(node) {
    const container = document.createElement("div");
    container.style.cssText =
        "box-sizing:border-box;width:100%;padding:6px;background:var(--comfy-menu-bg);border:1px solid var(--border-color);border-radius:6px;margin:4px 0;pointer-events:auto;overflow:hidden;";

    const previewLabel = document.createElement("div");
    previewLabel.textContent = "预览";
    previewLabel.style.cssText = "font-size:12px;opacity:0.9;margin-bottom:4px;";

    const previewBox = document.createElement("div");
    previewBox.style.cssText =
        "box-sizing:border-box;width:100%;min-height:48px;max-height:160px;overflow-y:auto;padding:8px;background:var(--comfy-input-bg);color:var(--input-text);border:1px solid var(--border-color);border-radius:4px;font-size:13px;white-space:pre-wrap;word-break:break-word;line-height:1.5;";

    container.appendChild(previewLabel);
    container.appendChild(previewBox);

    const updatePreview = () => {
        const tmplWidget = getWidgetByName(node, "template");
        const tmpl = tmplWidget?.value || "";

        const texts = [];
        for (let i = 1; i <= 8; i++) {
            const slot = node.inputs?.find((s) => s.name === `text${i}`);
            let val = "";
            if (slot && slot.link != null) {
                const link = app.graph?.links?.[slot.link];
                if (link) {
                    const srcNode = app.graph?.getNodeById?.(link.origin_id);
                    if (srcNode) {
                        const srcSlot = srcNode.outputs?.[link.origin_slot];
                        const srcWidgetName = srcSlot?.widget ?? srcSlot?.name;
                        const srcWidget = srcWidgetName ? getWidgetByName(srcNode, srcWidgetName) : null;
                        val = srcWidget?.value ?? "";
                    }
                }
            }
            texts.push(val);
        }

        const MAX_DEPTH = 10;
        const resolve = (s, depth) => {
            if (depth >= MAX_DEPTH) return s;
            return s.replace(/@(\d+)/g, (m, n) => {
                const idx = parseInt(n, 10);
                if (idx >= 1 && idx <= texts.length) return resolve(texts[idx - 1] ?? "", depth + 1);
                return m;
            });
        };

        const result = resolve(tmpl, 0);
        previewBox.textContent = result;
        app.graph.setDirtyCanvas(true);
    };

    return { container, updatePreview };
}

app.registerExtension({
    name: "AICoser.PromptTemplate.Extension",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AICoser_PromptTemplate") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated?.apply(this, arguments);

            const ui = createTemplateUI(this);
            this._aicoserTemplateUI = ui;

            const domWidget = this.addDOMWidget("aicoser_template_preview", "customwidget", ui.container);
            domWidget.serialize = false;
            domWidget.hideOnZoom = false;
            domWidget.computeSize = function (width) {
                const h = Math.max(80, ui.container?.scrollHeight || 80);
                return [width, h];
            };

            this.setSize([420, 280]);

            const hookWidget = (name) => {
                const w = getWidgetByName(this, name);
                if (!w) return;
                const origCb = w.callback;
                w.callback = function (value) {
                    origCb?.call(this, value);
                    ui.updatePreview();
                };
            };

            hookWidget("template");

            const origOnConnectionsChange = this.onConnectionsChange;
            this.onConnectionsChange = function (side, slot, connected, linkInfo) {
                const r = origOnConnectionsChange?.apply(this, arguments);
                ui.updatePreview();
                return r;
            };

            requestAnimationFrame(() => ui.updatePreview());

            return r;
        };

        const origOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function () {
            origOnExecuted?.apply(this, arguments);
            this._aicoserTemplateUI?.updatePreview?.();
        };
    },
});
