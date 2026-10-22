// VNCCS Character Wizard — assisted drafting workspace (P2)
// Split-view popup: editable draft sheet (left) + AI assist console (right).
// Draft is decoupled from the node: nothing touches node state until Apply & Close.

import { injectStyles } from "./vnccs_common.js";

const Z_INDEX = 10000;

const CSS = `
.vnccs-ws-exp{display:none;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 12px;font-size:12px;border-top:1px solid var(--border, #333);}
.vnccs-ws-exp-label{opacity:.7;}
.vnccs-ws-exp-chip{display:inline-flex;gap:4px;align-items:center;border:1px dashed var(--border, #444);padding:2px 8px;border-radius:10px;}
.vnccs-ws-exp-chip button{background:none;border:none;color:inherit;cursor:pointer;padding:0 2px;opacity:.7;font-size:12px;}
.vnccs-ws-exp-toggle{display:inline-flex;gap:4px;align-items:center;opacity:.85;cursor:pointer;}
.vnccs-ws-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: ${Z_INDEX}; }
.vnccs-ws-panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%);
  width: min(1120px, 94vw); height: min(740px, 90vh); min-width: 760px; min-height: 480px;
  display: flex; flex-direction: column; background: #1b1b22; color: #e8e8ee;
  border: 1px solid #3a3a46; border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,.6);
  resize: both; overflow: hidden; font-family: system-ui, sans-serif; font-size: 13px; }
.vnccs-ws-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 1px solid #33333f; background: #20202a; }
.vnccs-ws-title { font-weight: 700; font-size: 14px; letter-spacing: .3px; flex: 1; }
.vnccs-ws-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #444; }
.vnccs-ws-badge.remote { color: #8fd3ff; border-color: #2f6f9f; background: #16283a; }
.vnccs-ws-badge.local { color: #b9b9c6; border-color: #4a4a55; background: #24242c; }
.vnccs-ws-close { background: none; border: none; color: #b9b9c6; font-size: 18px; cursor: pointer; }
.vnccs-ws-close:hover { color: #fff; }
.vnccs-ws-body { flex: 1; display: grid; grid-template-columns: 1.05fr 1fr; gap: 12px;
  padding: 12px; overflow: hidden; min-height: 0; }
.vnccs-ws-pane { overflow: auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.vnccs-ws-pane h4 { margin: 0 0 2px; font-size: 11px; text-transform: uppercase;
  letter-spacing: 1px; color: #8f8fa0; }
.vnccs-ws-row { display: flex; flex-direction: column; gap: 3px; }
.vnccs-ws-row label { font-size: 11px; color: #a8a8ba; }
.vnccs-ws-row input, .vnccs-ws-row select, .vnccs-ws-row textarea, .vnccs-ws-input {
  background: #14141a; color: #eee; border: 1px solid #3a3a46; border-radius: 6px;
  padding: 6px 8px; font: inherit; outline: none; }
.vnccs-ws-row input:focus, .vnccs-ws-row textarea:focus, .vnccs-ws-input:focus { border-color: #5b8bd0; }
.vnccs-ws-row.modified input, .vnccs-ws-row.modified textarea { border-color: #c9973f; }
.vnccs-ws-name-hint { font-size: 10px; color: #c9973f; min-height: 12px; }
.vnccs-ws-flash { animation: vnccsWsFlash .7s ease; }
@keyframes vnccsWsFlash { 0% { box-shadow: 0 0 0 2px #7fd08a; } 100% { box-shadow: none; } }
.vnccs-ws-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vnccs-ws-console { border-right: 1px solid #33333f; padding-right: 12px; }
.vnccs-ws-msgs { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 8px;
  min-height: 0; padding-right: 4px; }
.vnccs-ws-turn { border-radius: 8px; padding: 7px 10px; max-width: 96%; }
.vnccs-ws-turn.user { align-self: flex-end; background: #24344d; }
.vnccs-ws-turn.model { align-self: flex-start; background: #23232c; border: 1px solid #34343f; }
.vnccs-ws-turn.info { align-self: center; color: #9a9aac; font-size: 11px; }
.vnccs-ws-turn.err { align-self: stretch; background: #3a2026; border: 1px solid #6f3040; white-space: pre-wrap; }
.vnccs-ws-turn .meta { display: block; margin-top: 4px; font-size: 10px; color: #77778a; }
.vnccs-ws-kv { margin: 4px 0 0; white-space: pre-wrap; font-size: 12px; color: #cfcfda; }
.vnccs-ws-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.vnccs-ws-chip { background: #2b3a52; border: 1px solid #3f5878; color: #cfe4ff; border-radius: 999px;
  padding: 3px 10px; font: inherit; cursor: pointer; }
.vnccs-ws-chip:hover { background: #35486a; }
.vnccs-ws-chip.ghost { background: #26262e; border-color: #3d3d49; color: #b9b9c6; }
.vnccs-ws-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.vnccs-ws-mode { background: #26262e; border: 1px solid #3d3d49; color: #b9b9c6; border-radius: 999px;
  padding: 3px 11px; font: inherit; cursor: pointer; }
.vnccs-ws-mode.active { background: #33507a; border-color: #4b74ad; color: #fff; }
.vnccs-ws-sendrow { display: flex; gap: 6px; align-items: flex-end; }
.vnccs-ws-input { flex: 1; resize: none; min-height: 44px; }
.vnccs-ws-btn { background: #33507a; border: 1px solid #4b74ad; color: #fff; border-radius: 7px;
  padding: 7px 14px; font: inherit; cursor: pointer; }
.vnccs-ws-btn:disabled { opacity: .5; cursor: default; }
.vnccs-ws-btn.plain { background: #26262e; border-color: #3d3d49; color: #c9c9d6; }
.vnccs-ws-btn.primary { background: #2f7d4f; border-color: #43a46c; }
.vnccs-ws-foot { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px;
  border-top: 1px solid #33333f; background: #20202a; }
`;

const TEXT_FIELDS = [
    { key: "race", label: "Race / species" },
    { key: "skin_color", label: "Skin" },
    { key: "body", label: "Body" },
    { key: "breast_size", label: "Breast size", femaleOnly: true },
    { key: "face", label: "Face" },
    { key: "hair", label: "Hair" },
    { key: "eyes", label: "Eyes" },
    { key: "additional_details", label: "Additional details", textarea: true },
];

const MODES = [
    { id: "draft", label: "Draft", needsText: true, placeholder: "Chat with the designer — e.g. \u201cmake me a character based on an Egyptian god\u201d, then keep asking for changes" },
    { id: "reroll_field", label: "Reroll field", needsField: true, needsText: false, placeholder: "Optional steer: 'something more exotic'…" },
    { id: "polish_field", label: "Polish field", needsField: true, needsText: false, placeholder: "Optional steer: 'more vivid, keep the concept'…" },
    { id: "edit_command", label: "Fix…", needsText: true, placeholder: "Tell the AI what to change… e.g. make her older and add a scar" },
    { id: "names", label: "Names", needsText: false, placeholder: "Name suggestions for the current draft (Enter to run)" },
    { id: "review", label: "Review", needsText: false, placeholder: "Consistency check of the current draft (Enter to run)" },
];

const catalogCache = {};

function seedDraft(info) {
    const draft = {};
    // "" means "keep the current character"; a typed value becomes a
    // create-on-Apply target (see the Apply button handler).
    draft.name = "";
    draft.sex = info.sex === "male" ? "male" : "female";
    const age = parseInt(info.age, 10);
    draft.age = Number.isFinite(age) ? Math.max(1, Math.min(100, age)) : 18;
    for (const f of TEXT_FIELDS) draft[f.key] = String(info[f.key] ?? "");
    return draft;
}

function stripName(d) {
    // name is workspace-only routing state; it must never reach the assist
    // model or the node's character_info fields.
    const copy = { ...d };
    delete copy.name;
    return copy;
}

function newRequestId() {
    return (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)) + "";
}

export async function openWizardWorkspace(ctx) {
    if (ctx.node?._vnccsStateRestoreError) return;
    const { node, state, els, api } = ctx;
    const character = state.character;
    const currentRequest = ctx.beginCharacterWizardRequest();
    const isCurrent = () => currentRequest() && !node._vnccsStateRestoreError && state.character === character;
    const existingCharacter = (name) => canonicalCharacterName(name) !== null;
    // Dropdown values are the canonical spellings; the server matches the
    // metadata name exactly, so always route loads through the canonical value.
    function canonicalCharacterName(name) {
        const hit = Array.from(els.charSelect?.options || [])
            .find(o => String(o.value).toLowerCase() === String(name).toLowerCase());
        return hit ? String(hit.value) : null;
    }

    injectStyles(CSS, "vnccs-wizard-workspace");

    let draft = seedDraft(state.character_info || {});
    let dirty = false;
    let busy = false;
    // Opt-in prompt experiments: unknown species tokens the sanitizer would
    // otherwise drop. Asterisks are a render-time signal only — never stored.
    const seedExperimentTags = () => (Array.isArray(state.character_info?.experiment_tags)
        ? state.character_info.experiment_tags.map(String).slice(0, 8) : []);
    let experimentTags = seedExperimentTags();

    const overlay = document.createElement("div");
    overlay.className = "vnccs-ws-overlay";
    const panel = document.createElement("div");
    panel.className = "vnccs-ws-panel";
    panel.tabIndex = -1;
    overlay.appendChild(panel);

    // ---- header -------------------------------------------------------------
    const head = document.createElement("div");
    head.className = "vnccs-ws-head";
    const title = document.createElement("div");
    title.className = "vnccs-ws-title";
    title.textContent = `Character Wizard — ${character || "draft"}`;
    const badge = document.createElement("span");
    badge.className = "vnccs-ws-badge local";
    badge.textContent = "backend…";
    const closeBtn = document.createElement("button");
    closeBtn.className = "vnccs-ws-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.title = "Close (Esc)";
    head.append(title, badge, closeBtn);
    panel.appendChild(head);

    // ---- body ---------------------------------------------------------------
    const body = document.createElement("div");
    body.className = "vnccs-ws-body";
    const draftPane = document.createElement("div");
    draftPane.className = "vnccs-ws-pane";
    const consolePane = document.createElement("div");
    consolePane.className = "vnccs-ws-pane vnccs-ws-console";
    body.append(consolePane, draftPane);
    panel.appendChild(body);

    // ---- draft sheet --------------------------------------------------------
    const rowsByKey = {};
    function renderDraftSheet() {
        // Safe: constant-string child clear (no external content); codebase-wide idiom.
        draftPane.innerHTML = "";
        const h = document.createElement("h4");
        h.textContent = "Draft sheet (edits stay here until Apply)";
        draftPane.appendChild(h);

        // Character name: empty = apply to the current character. A new name
        // turns Apply into "create the character, then fill its fields".
        const nameRow = document.createElement("div");
        nameRow.className = "vnccs-ws-row";
        const nameLabel = document.createElement("label");
        nameLabel.textContent = "Character name";
        const nameInp = document.createElement("input");
        nameInp.type = "text";
        nameInp.className = "vnccs-ws-name";
        nameInp.maxLength = 40;
        nameInp.value = draft.name || "";
        nameInp.placeholder = `keep “${state.character || "current"}” — or type a new name`;
        const nameHint = document.createElement("span");
        nameHint.className = "vnccs-ws-name-hint";
        const updateNameHint = () => {
            const n = (draft.name || "").trim();
            if (!n) { nameHint.textContent = ""; }
            else if (n.toLowerCase() === String(state.character || "").toLowerCase()) { nameHint.textContent = "same as current character"; }
            else if (existingCharacter(n)) { nameHint.textContent = `“${n}” exists — Apply switches to it`; }
            else { nameHint.textContent = `new character “${n}” will be created on Apply`; }
        };
        nameInp.addEventListener("input", () => { draft.name = nameInp.value; markDirty(); updateNameHint(); });
        nameRow.append(nameLabel, nameInp, nameHint);
        draftPane.appendChild(nameRow);
        rowsByKey.name = nameRow;
        updateNameHint();

        const sexAge = document.createElement("div");
        sexAge.className = "vnccs-ws-grid2";
        const sexRow = document.createElement("div");
        sexRow.className = "vnccs-ws-row";
        sexRow.innerHTML = "<label>Sex</label>"; // Safe: static literal, no interpolation.
        const sexSel = document.createElement("select");
        for (const [v, l] of [["female", "Female"], ["male", "Male"]]) {
            const o = document.createElement("option");
            o.value = v; o.textContent = l;
            sexSel.appendChild(o);
        }
        sexSel.value = draft.sex;
        sexSel.addEventListener("change", () => { draft.sex = sexSel.value; markDirty(); syncFemaleOnly(); });
        sexRow.appendChild(sexSel);
        const ageRow = document.createElement("div");
        ageRow.className = "vnccs-ws-row";
        ageRow.innerHTML = "<label>Age</label>";
        const ageInp = document.createElement("input");
        ageInp.type = "number"; ageInp.min = "1"; ageInp.max = "100"; ageInp.value = draft.age;
        ageInp.addEventListener("input", () => {
            const v = parseInt(ageInp.value, 10);
            draft.age = Number.isFinite(v) ? Math.max(1, Math.min(100, v)) : 18;
            markDirty();
        });
        ageRow.appendChild(ageInp);
        sexAge.append(sexRow, ageRow);
        draftPane.appendChild(sexAge);
        rowsByKey.sex = sexRow; rowsByKey.age = ageRow;

        for (const f of TEXT_FIELDS) {
            const row = document.createElement("div");
            row.className = "vnccs-ws-row";
            const label = document.createElement("label");
            label.textContent = f.label;
            row.appendChild(label);
            let input;
            if (f.textarea) {
                input = document.createElement("textarea");
                input.rows = 2;
            } else {
                input = document.createElement("input");
                input.type = "text";
            }
            input.value = draft[f.key] || "";
            input.placeholder = f.key === "additional_details"
                ? "free-form traits the AI or you add; shown in the prompt" : "";
            input.addEventListener("input", () => { draft[f.key] = input.value; markDirty(); });
            row.appendChild(input);
            draftPane.appendChild(row);
            rowsByKey[f.key] = { row, input };
        }
        syncFemaleOnly();
    }

    function syncFemaleOnly() {
        const r = rowsByKey.breast_size;
        if (r?.row) r.row.style.display = draft.sex === "female" ? "" : "none";
    }

    function markDirty() { dirty = true; refreshModifiedMarks(); }

    function refreshModifiedMarks() {
        const seed = seedDraft(state.character_info || {});
        for (const f of TEXT_FIELDS) {
            const r = rowsByKey[f.key];
            if (r?.row) r.row.classList.toggle("modified", draft[f.key] !== seed[f.key]);
        }
    }

    function flashField(key) {
        const r = rowsByKey[key];
        const el = r?.input || r?.row;
        if (!el) return;
        el.classList.remove("vnccs-ws-flash");
        void el.offsetWidth;
        el.classList.add("vnccs-ws-flash");
    }

    function setDraftField(key, value) {
        draft[key] = value;
        const r = rowsByKey[key];
        if (r?.input) r.input.value = value;
        markDirty();
        flashField(key);
    }

    renderDraftSheet();

    // curated datalists (best-effort; catalog rule mirrors openTagConstructor)
    (async () => {
        try {
            const mode = (state.gen_settings?.generation_mode || "illustrious").toLowerCase();
            const catalogKey = mode === "qi2" ? "creator_v2" : "legacy";
            if (!catalogCache[catalogKey]) {
                const r = await api.fetchApi(catalogKey === "creator_v2"
                    ? "/vnccs/get_tags?catalog=creator_v2" : "/vnccs/get_tags");
                if (!r.ok) return;
                catalogCache[catalogKey] = await r.json();
            }
            if (!isCurrent() || !overlay.isConnected) return;
            const tags = catalogCache[catalogKey]?.tags || {};
            const namesOf = (list) => (Array.isArray(list) ? list : [])
                .map((t) => (typeof t === "string" ? t : t?.tag)).filter(Boolean);
            for (const [key, list] of [["race", tags.race], ["skin_color", tags.skin_color]]) {
                const names = namesOf(list);
                if (!names.length) continue;
                const dlId = `vnccs-ws-dl-${key}`;
                let dl = document.getElementById(dlId);
                if (!dl) {
                    dl = document.createElement("datalist");
                    dl.id = dlId;
                    panel.appendChild(dl);
                }
                // Safe: constant-string child clear (no external content).
                dl.innerHTML = "";
                for (const n of names) {
                    const o = document.createElement("option");
                    o.value = n;
                    dl.appendChild(o);
                }
                const r = rowsByKey[key];
                if (r?.input) r.input.setAttribute("list", dlId);
            }
        } catch (e) { /* datalists are cosmetic; never block the workspace */ }
    })();

    // ---- AI console ---------------------------------------------------------
    const h = document.createElement("h4");
    h.textContent = "AI assistant";
    consolePane.appendChild(h);
    const msgs = document.createElement("div");
    msgs.className = "vnccs-ws-msgs";
    consolePane.appendChild(msgs);

    const toolbar = document.createElement("div");
    toolbar.className = "vnccs-ws-toolbar";
    let activeMode = MODES[0];
    const draftConvo = [];   // chat history for the Draft action only
    const modeBtns = {};
    const fieldSel = document.createElement("select");
    fieldSel.style.display = "none";
    for (const f of TEXT_FIELDS) {
        const o = document.createElement("option");
        o.value = f.key; o.textContent = f.label;
        fieldSel.appendChild(o);
    }
    for (const m of MODES) {
        const b = document.createElement("button");
        b.className = "vnccs-ws-mode" + (m === activeMode ? " active" : "");
        b.textContent = m.label;
        b.addEventListener("click", () => {
            activeMode = m;
            for (const mm of MODES) modeBtns[mm.id].classList.toggle("active", mm === m);
            fieldSel.style.display = m.needsField ? "" : "none";
            inputEl.placeholder = m.placeholder || "";
            inputEl.focus();
        });
        modeBtns[m.id] = b;
        toolbar.appendChild(b);
    }
    const newChatBtn = document.createElement("button");
    newChatBtn.className = "vnccs-ws-chip ghost";
    newChatBtn.textContent = "New chat";
    newChatBtn.title = "Clear the assistant chat (the draft sheet stays)";
    newChatBtn.addEventListener("click", () => {
        draftConvo.length = 0;
        msgs.innerHTML = ""; // Safe: constant-string child clear (no external content).
        infoTurn("New chat — the designer starts fresh; your draft sheet is unchanged.");
    });
    toolbar.appendChild(newChatBtn);
    toolbar.appendChild(fieldSel);
    consolePane.appendChild(toolbar);

    const sendRow = document.createElement("div");
    sendRow.className = "vnccs-ws-sendrow";
    const inputEl = document.createElement("textarea");
    inputEl.className = "vnccs-ws-input";
    inputEl.placeholder = activeMode.placeholder;
    inputEl.maxLength = 1500;
    const sendBtn = document.createElement("button");
    sendBtn.className = "vnccs-ws-btn";
    sendBtn.textContent = "Send";
    sendRow.append(inputEl, sendBtn);
    consolePane.appendChild(sendRow);

    function turn(cls) {
        const t = document.createElement("div");
        t.className = "vnccs-ws-turn " + cls;
        msgs.appendChild(t);
        msgs.scrollTop = msgs.scrollHeight;
        return t;
    }
    function infoTurn(text) {
        const t = turn("info");
        t.textContent = text;
    }
    function errorTurn(err) {
        const t = turn("err");
        const msg = err?.message || err?.error || "Assist request failed.";
        t.textContent = `[${err?.error || "ERROR"}] ${msg}`;
        if (err?.raw) {
            const raw = document.createElement("div");
            raw.className = "meta";
            raw.textContent = "raw: " + String(err.raw).slice(0, 400);
            t.appendChild(raw);
        }
        if ((err?.error === "MODEL_MISSING" || err?.error === "MODEL_INVALID") && ctx.ensureQwenVLReady) {
            const chips = document.createElement("div");
            chips.className = "vnccs-ws-chips";
            const b = document.createElement("button");
            b.className = "vnccs-ws-chip";
            b.textContent = "Download local model, then retry";
            b.addEventListener("click", async () => {
                b.disabled = true;
                try {
                    if (await ctx.ensureQwenVLReady()) runLast();
                } catch (e) { /* loader surfaces its own errors */ }
            });
            chips.appendChild(b);
            t.appendChild(chips);
        }
    }
    function chipRow(parent, items, makeChip) {
        const row = document.createElement("div");
        row.className = "vnccs-ws-chips";
        for (const item of items) row.appendChild(makeChip(item));
        parent.appendChild(row);
    }

    let lastCall = null;
    async function runLast() {
        if (lastCall) await assist(lastCall.action, lastCall.payload);
    }

    async function send() {
        if (busy) return;
        const text = inputEl.value.trim();
        if (activeMode.needsText && !text) { inputEl.focus(); return; }
        const payload = { action: activeMode.id, node_id: node.id, request_id: newRequestId() };
        let action = activeMode.id;
        if (action === "draft") {
            payload.description = text;
            payload.history = draftConvo.slice(-12);
            payload.draft = stripName(draft);
            draftConvo.push({ role: "user", text });
        }
        else if (action === "reroll_field" || action === "polish_field") {
            payload.field = fieldSel.value; payload.instruction = text; payload.draft = stripName(draft);
        } else if (action === "edit_command") { payload.instruction = text; payload.draft = stripName(draft); }
        else if (action === "names") { payload.draft = stripName(draft); payload.count = 5; }
        else { payload.draft = stripName(draft); }
        inputEl.value = "";
        lastCall = { action, payload };
        await assist(action, payload);
    }

    async function assist(action, payload) {
        if (busy) return;
        busy = true;
        sendBtn.disabled = true;
        const label = MODES.find((m) => m.id === action)?.label || action;
        const userT = turn("user");
        const desc = payload.description || payload.instruction
            || (payload.field ? `${payload.field}` : "current draft");
        userT.textContent = `${label}: ${desc}`;
        const statusT = turn("info");
        statusT.textContent = "queued…";
        let currentRid = payload.request_id;
        const stageHandler = ({ detail }) => {
            if (!detail) return;
            if (detail.kind !== "assist") return;
            if (String(detail.node_id) !== String(node.id)) return;
            if (detail.request_id && String(detail.request_id) !== String(currentRid)) return;
            if (statusT.isConnected) statusT.textContent = detail.status === "running" ? "thinking…" : detail.status;
        };
        try { api.addEventListener?.("vnccs.wizard.stage", stageHandler); } catch (e) { /* older api */ }
        const t0 = performance.now();
        try {
            const r = await api.fetchApi("/vnccs/wizard/assist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!isCurrent()) return;
            let data = null;
            try { data = await r.json(); } catch (e) { data = { error: "HTTP " + r.status }; }
            statusT.remove();
            if (!r.ok) { errorTurn(data); return; }
            const meta = ` ${((performance.now() - t0) / 1000).toFixed(1)}s`;
            renderResult(action, payload, data, meta);
        } catch (e) {
            statusT.remove();
            if (isCurrent()) errorTurn({ message: String(e) });
        } finally {
            try { api.removeEventListener?.("vnccs.wizard.stage", stageHandler); } catch (e) { /* noop */ }
            busy = false;
            sendBtn.disabled = false;
        }
    }

    function renderResult(action, payload, data, meta) {
        if (action === "draft") {
            const t = turn("model");
            const rationale = data.rationale
                ? String(data.rationale)
                : "Draft ready:";
            t.textContent = rationale;
            if (data.rationale) {
                const kv0 = document.createElement("div");
                kv0.className = "vnccs-ws-kv";
                kv0.textContent = "Proposed fields:";
                kv0.style.marginTop = "6px";
                kv0.style.opacity = ".7";
                t.appendChild(kv0);
            }
            draftConvo.push({
                role: "assistant",
                text: (data.rationale ? data.rationale + " " : "")
                    + "[current draft] " + ["sex", "age", "race", "skin_color", "body", "face", "hair", "eyes", "additional_details"]
                        .map(k => `${k}=${data[k] ?? ""}`).join("; "),
            });
            const kv = document.createElement("div");
            kv.className = "vnccs-ws-kv";
            kv.textContent = ["sex", "age", "race", "skin_color", "body", "face", "hair", "eyes", "additional_details"]
                .map((k) => `${k}: ${data[k] ?? ""}`).join("\n");
            t.appendChild(kv);
            chipRow(t, [data], (d) => {
                const b = document.createElement("button");
                b.className = "vnccs-ws-chip";
                b.textContent = "Adopt into draft sheet";
                b.addEventListener("click", () => {
                    for (const k of ["sex", "age", "race", "skin_color", "body", "face", "hair", "eyes", "additional_details"]) {
                        if (k in d) {
                            draft[k] = d[k];
                            const r = rowsByKey[k];
                            if (r?.input) r.input.value = draft[k];
                        }
                    }
                    syncFemaleOnly();
                    markDirty();
                    for (const k of ["race", "skin_color", "body", "face", "hair", "eyes", "additional_details"]) flashField(k);
                    infoTurn("Draft adopted — review it on the right, then Apply & Close.");
                });
                return b;
            });
            if (Array.isArray(data.flagged) && data.flagged.length) {
                const kvE = document.createElement("div");
                kvE.className = "vnccs-ws-kv";
                kvE.textContent = "Not in curated presets — opt in to test whether the model responds:";
                kvE.style.marginTop = "6px";
                kvE.style.opacity = ".7";
                t.appendChild(kvE);
                chipRow(t, data.flagged, (raw) => {
                    const it = typeof raw === "string" ? { field: "race", token: raw } : (raw || {});
                    const tok = String(it.token || "");
                    const fld = String(it.field || "race");
                    const wrap = document.createElement("span");
                    wrap.className = "vnccs-ws-chip vnccs-ws-exp-chip";
                    const label = document.createElement("span");
                    label.textContent = "*" + tok + (fld === "race" ? " " : " → " + fld + " ");
                    const adopt = document.createElement("button");
                    adopt.textContent = "Adopt";
                    const ignore = document.createElement("button");
                    ignore.textContent = "Ignore";
                    adopt.addEventListener("click", () => {
                        if (fld === "race") {
                            if (!experimentTags.some((x) => x.toLowerCase() === tok.toLowerCase())) experimentTags.push(tok);
                            markDirty();
                            renderExpRow();
                        } else if (fld === "skin_color" || fld === "breast_size") {
                            // User-authored field values already reach the prompt verbatim
                            // (allowlists gate LLM output only) — Adopt = type it in.
                            setDraftField(fld, tok);
                        }
                        adopt.textContent = "\u2713";
                        adopt.disabled = true;
                        ignore.disabled = true;
                    });
                    ignore.addEventListener("click", () => { wrap.style.display = "none"; });
                    wrap.append(label, adopt, ignore);
                    return wrap;
                });
            }
            addMeta(t, meta);
            return;
        }
        if (action === "reroll_field") {
            const t = turn("model");
            t.textContent = `New ideas for “${payload.field}”:`;
            if (!data.suggestions?.length) { t.textContent += " (all suggestions were filtered out — try again)"; addMeta(t, meta); return; }
            chipRow(t, data.suggestions, (s) => {
                const b = document.createElement("button");
                b.className = "vnccs-ws-chip";
                b.textContent = s;
                b.title = "Click to set the field";
                b.addEventListener("click", () => setDraftField(payload.field, s));
                return b;
            });
            addMeta(t, meta);
            return;
        }
        if (action === "polish_field") {
            const t = turn("model");
            t.textContent = `Polished “${payload.field}”:`;
            const kv = document.createElement("div");
            kv.className = "vnccs-ws-kv";
            kv.textContent = data.value || "";
            t.appendChild(kv);
            chipRow(t, [data.value], (v) => {
                const b = document.createElement("button");
                b.className = "vnccs-ws-chip";
                b.textContent = "Set value";
                b.addEventListener("click", () => setDraftField(payload.field, v));
                return b;
            });
            addMeta(t, meta);
            return;
        }
        if (action === "edit_command") {
            const t = turn("model");
            const patch = data.patch || {};
            const keys = Object.keys(patch);
            t.textContent = keys.length ? "Suggested changes:" : "No changes suggested.";
            if (data.note) {
                const note = document.createElement("div");
                note.className = "meta";
                note.textContent = data.note;
                t.appendChild(note);
            }
            if (keys.length) {
                const kv = document.createElement("div");
                kv.className = "vnccs-ws-kv";
                kv.textContent = keys.map((k) => `${k}: ${patch[k]}`).join("\n");
                t.appendChild(kv);
                chipRow(t, [null, ...keys], (k) => {
                    const b = document.createElement("button");
                    if (k === null) {
                        b.className = "vnccs-ws-chip";
                        b.textContent = `Apply all (${keys.length})`;
                        b.addEventListener("click", () => {
                            for (const kk of keys) setDraftField(kk, patch[kk]);
                        });
                    } else {
                        b.className = "vnccs-ws-chip ghost";
                        b.textContent = k;
                        b.title = patch[k];
                        b.addEventListener("click", () => setDraftField(k, patch[k]));
                    }
                    return b;
                });
            }
            addMeta(t, meta);
            return;
        }
        if (action === "names") {
            const t = turn("model");
            t.textContent = "Name ideas:";
            if (!data.suggestions?.length) { t.textContent += " (none survived filtering)"; addMeta(t, meta); return; }
            chipRow(t, data.suggestions, (n) => {
                const wrap = document.createElement("span");
                wrap.style.display = "inline-flex";
                wrap.style.gap = "4px";
                const useBtn = document.createElement("button");
                useBtn.className = "vnccs-ws-chip";
                useBtn.textContent = `Use “${n}”`;
                useBtn.addEventListener("click", () => {
                    draft.name = n;
                    markDirty();
                    renderDraftSheet();
                    const same = n.toLowerCase() === String(state.character || "").toLowerCase();
                    infoTurn(same
                        ? `Name “${n}” matches the current character — Apply just fills the fields.`
                        : `Name “${n}” set — Apply will ${existingCharacter(n) ? `switch to “${n}” and fill its fields` : `create a new character “${n}” and fill its fields`}.`);
                });
                const copyBtn = document.createElement("button");
                copyBtn.className = "vnccs-ws-chip ghost";
                copyBtn.textContent = "Copy";
                copyBtn.title = "Copy to clipboard";
                copyBtn.addEventListener("click", async () => {
                    try { await navigator.clipboard.writeText(n); infoTurn(`Copied “${n}”.`); }
                    catch (e) { infoTurn(`Name: ${n}`); }
                });
                wrap.append(useBtn, copyBtn);
                return wrap;
            });
            addMeta(t, meta);
            return;
        }
        // review
        const t = turn("model");
        const issues = data.issues || [];
        t.textContent = issues.length ? `Review — ${issues.length} issue${issues.length > 1 ? "s" : ""}:` : "Review: draft looks consistent.";
        for (const issue of issues) {
            const block = document.createElement("div");
            block.className = "vnccs-ws-kv";
            block.textContent = (issue.field ? `[${issue.field}] ` : "") + issue.note;
            t.appendChild(block);
            if (issue.suggestion && issue.field) {
                chipRow(t, [issue], (i) => {
                    const b = document.createElement("button");
                    b.className = "vnccs-ws-chip";
                    b.textContent = `Accept: ${i.suggestion.slice(0, 60)}${i.suggestion.length > 60 ? "…" : ""}`;
                    b.addEventListener("click", () => setDraftField(i.field, i.suggestion));
                    return b;
                });
            }
        }
        addMeta(t, meta);
    }

    function addMeta(turnEl, meta) {
        if (!meta) return;
        const m = document.createElement("span");
        m.className = "meta";
        m.textContent = meta;
        turnEl.appendChild(m);
    }

    sendBtn.addEventListener("click", send);

    // ---- experiment tags row -------------------------------------------------
    const expRow = document.createElement("div");
    expRow.className = "vnccs-ws-exp";
    const currentMode = () => (state.gen_settings?.generation_mode || "illustrious").toLowerCase();
    const expEnabled = () => {
        const ms = state.gen_settings?.mode_settings?.[currentMode()];
        return !!(ms && ms.include_experiment_tags);
    };
    function renderExpRow() {
        expRow.innerHTML = ""; // safe: constant markup; content built via createElement
        if (!experimentTags.length) { expRow.style.display = "none"; return; }
        expRow.style.display = "flex";
        const lbl = document.createElement("span");
        lbl.className = "vnccs-ws-exp-label";
        lbl.textContent = "Experiment tags:";
        expRow.appendChild(lbl);
        for (const tag of experimentTags.slice()) {
            const chip = document.createElement("span");
            chip.className = "vnccs-ws-chip vnccs-ws-exp-chip";
            const txt = document.createElement("span");
            txt.textContent = "*" + tag;
            const x = document.createElement("button");
            x.textContent = "\u00d7";
            x.title = "Remove";
            x.addEventListener("click", () => {
                experimentTags = experimentTags.filter((t2) => t2 !== tag);
                markDirty();
                renderExpRow();
            });
            chip.append(txt, x);
            expRow.appendChild(chip);
        }
        const toggle = document.createElement("label");
        toggle.className = "vnccs-ws-exp-toggle";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = expEnabled();
        cb.title = `Per-mode opt-in (currently ${currentMode()}): qi2 weaves these into prose; illustrious/anima send them as weighted tags`;
        cb.addEventListener("change", () => {
            if (!state.gen_settings) return;
            if (!state.gen_settings.mode_settings) state.gen_settings.mode_settings = {};
            const mode = currentMode();
            state.gen_settings.mode_settings[mode] = Object.assign(
                {}, state.gen_settings.mode_settings[mode], { include_experiment_tags: cb.checked },
            );
            try { ctx.saveState?.(false); } catch (e) { /* noop */ }
        });
        const toggleText = document.createElement("span");
        toggleText.textContent = " send to prompt (this mode)";
        toggle.append(cb, toggleText);
        expRow.appendChild(toggle);
    }

    // ---- footer -------------------------------------------------------------
    const foot = document.createElement("div");
    foot.className = "vnccs-ws-foot";
    const resetBtn = document.createElement("button");
    resetBtn.className = "vnccs-ws-btn plain";
    resetBtn.textContent = "Reset from node";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "vnccs-ws-btn plain";
    cancelBtn.textContent = "Cancel";
    const applyBtn = document.createElement("button");
    applyBtn.className = "vnccs-ws-btn primary";
    applyBtn.textContent = "Apply & Close";
    foot.append(resetBtn, cancelBtn, applyBtn);
    panel.append(expRow, foot);
    renderExpRow();

    resetBtn.addEventListener("click", () => {
        draft = seedDraft(state.character_info || {});
        experimentTags = seedExperimentTags();
        dirty = false;
        renderDraftSheet();
        renderExpRow();
        infoTurn("Draft reset from node values.");
    });
    cancelBtn.addEventListener("click", () => confirmClose());
    closeBtn.addEventListener("click", () => confirmClose());
    applyBtn.addEventListener("click", () => {
        if (!isCurrent()) { close(); return; }
        const n = (draft.name || "").trim();
        const current = String(state.character || "");
        if (n && n.toLowerCase() !== current.toLowerCase()) {
            // Name routes the apply: confirm create-or-switch, never silently
            // touch a different character than the one the node has selected.
            const canonical = canonicalCharacterName(n);
            const existing = canonical !== null;
            const t = turn("model");
            t.textContent = existing
                ? `“${canonical}” already exists. Switch to it and apply the draft fields there?`
                : `“${n}” is not a character yet. Create a new character “${n}” and apply the draft fields to it?`;
            chipRow(t, [true, false], (ok) => {
                const b = document.createElement("button");
                b.className = ok ? "vnccs-ws-chip" : "vnccs-ws-chip ghost";
                b.textContent = ok ? (existing ? `Switch to “${canonical}” & apply` : `Create “${n}” & apply`) : "Cancel";
                b.addEventListener("click", async () => {
                    if (!ok) { infoTurn("Kept the current character. Edit the name field or press Apply again."); return; }
                    try {
                        if (existing) await ctx.selectCharacterByName?.(canonical);
                        else await ctx.createCharacterByName?.(n);
                    } catch (e) {
                        errorTurn({ message: `Could not ${existing ? "switch to" : "create"} “${existing ? canonical : n}”: ${e?.message || e}` });
                        return;
                    }
                    draft.name = ""; // consumed: it would only re-trigger the prompt
                    doApplyFields();
                });
                return b;
            });
            return;
        }
        doApplyFields();
    });

    function doApplyFields() {
        // Apply is the only bridge to node state: experiment tags cross with
        // every other field, still sanitized server-side at prompt time.
        try {
            state.character_info.experiment_tags = experimentTags.slice(0, 8);
            ctx.saveState?.(false);
        } catch (e) { /* node-side errors are its own */ }
        // close first so the animated row fill on the node is visible
        close();
        try { ctx.applyCharacterWizardData(stripName(draft)); } catch (e) { /* node-side errors are its own */ }
    }

    // ---- keyboard, close, lifecycle ----------------------------------------
    function confirmClose() {
        if (dirty && !window.confirm("Discard unsaved draft changes?")) return;
        close();
    }

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        overlay.remove();
        document.removeEventListener("keydown", onKeydown, true);
        els.charSelect?.removeEventListener?.("change", onCharSwitch);
    }

    function onKeydown(event) {
        if (!panel.contains(event.target) && event.target !== panel) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            confirmClose();
            return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.target === inputEl) {
                event.preventDefault();
                event.stopPropagation();
                send();
            }
        }
    }
    panel.addEventListener("keydown", onKeydown, true);

    function onCharSwitch() { close(); }
    els.charSelect?.addEventListener?.("change", onCharSwitch);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => inputEl.focus());

    // backend badge
    (async () => {
        try {
            const r = await api.fetchApi("/vnccs/character_wizard/backend");
            if (!r.ok) throw new Error("HTTP " + r.status);
            const b = await r.json();
            if (!overlay.isConnected) return;
            badge.textContent = b.mode === "remote"
                ? `AI: ${b.model}${b.native_fallback ? "" : " (strict)"}`
                : `local: ${b.model}`;
            badge.className = "vnccs-ws-badge " + (b.mode === "remote" ? "remote" : "local");
        } catch (e) {
            badge.textContent = "backend: unknown";
        }
    })();

    infoTurn("Draft is decoupled — the node only changes on Apply & Close.");
    return { close };
}
