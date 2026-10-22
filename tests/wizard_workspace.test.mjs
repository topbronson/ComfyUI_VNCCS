// DOM-level tests for the Character Wizard assisted drafting workspace
// (web/vnccs_wizard_workspace.mjs). Deterministic: scripted fetchApi, no model.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// vnccs_common.js transitively imports ComfyUI's runtime scripts/api.js, which
// only exists inside a live server (same reason sibling tests strip imports).
// The workspace only needs injectStyles from it — styling, not behavior.
registerHooks({
    resolve(specifier, context, next) {
        if (specifier.includes("vnccs_common.js")) {
            return { url: "data:text/javascript,export function injectStyles(){}", shortCircuit: true };
        }
        return next(specifier, context);
    },
});

// ── minimal DOM shim ─────────────────────────────────────────────────────────
class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this._listeners = {};
        this._classes = new Set();
        this.style = {};
        this.attrs = {};
        this.value = "";
        this.scrollTop = 0;
        this.scrollHeight = 0;
        this._innerHTML = "";
    }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return [...this._classes].join(" "); }
    set innerHTML(v) { if (v === "") { for (const c of this.children) c.parentNode = null; this.children = []; } this._innerHTML = v; }
    get innerHTML() { return this._innerHTML; }
    get classList() {
        const set = this._classes;
        return {
            add: (...c) => c.forEach(x => set.add(x)),
            remove: (...c) => c.forEach(x => set.delete(x)),
            contains: c => set.has(c),
            toggle: (c, force) => {
                const on = force === undefined ? !set.has(c) : !!force;
                if (on) set.add(c); else set.delete(c);
                return on;
            },
        };
    }
    append(...els) { for (const el of els) { el.parentNode = this; this.children.push(el); } }
    appendChild(el) { this.append(el); return el; }
    remove() {
        if (this.parentNode) {
            const i = this.parentNode.children.indexOf(this);
            if (i >= 0) this.parentNode.children.splice(i, 1);
            this.parentNode = null;
        }
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name]; }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) {
        this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn);
    }
    contains(el) { for (let n = el; n; n = n.parentNode) if (n === this) return true; return false; }
    get isConnected() { for (let n = this; n; n = n.parentNode) if (n === fakeDocument.body) return true; return false; }
    focus() {}
}

const fakeDocument = {
    createElement: tag => new FakeElement(tag),
    head: new FakeElement("head"),
    body: (() => { const b = new FakeElement("body"); b.parentNode = null; return b; })(),
    getElementById: id => walk(fakeDocument.body).find(el => el.id === id) || null,
    removeEventListener() {},
};
Object.defineProperty(fakeDocument.body, "isConnected", { get: () => true });

globalThis.document = fakeDocument;
globalThis.window = { confirm: () => globalThis.__confirmAnswer !== false };
globalThis.requestAnimationFrame = fn => { fn(); return 1; };
try {
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { clipboard: { writeText: async t => { globalThis.__copied = t; } } },
    });
} catch { /* node may lock navigator */ }

function fire(el, type, extra = {}) {
    const ev = { type, target: el, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const fn of (el._listeners[type] || []).slice()) fn(ev);
    return ev;
}
function walk(root, out = []) {
    for (const c of root.children) { out.push(c); walk(c, out); }
    return out;
}
const findAll = (root, pred) => walk(root).filter(pred);
const findText = (root, text) => findAll(root, e => e.textContent === text)[0];
const byClass = (root, cls) => findAll(root, e => e._classes.has(cls));

// ── scripted backend ─────────────────────────────────────────────────────────
const DRAFT_AI = {
    sex: "female", age: 21, race: "foxfolk", skin_color: "pale skin",
    body: "slim build", face: "sharp eyes", hair: "silver_hair",
    eyes: "amber eyes", additional_details: "hair clips", evil_extra: "no",
    rationale: "I drew on the fox-variant shrine maiden archetype, picked foxfolk for coherent ears, and kept pale skin because you mentioned moonlight.",
    flagged: [{"field": "race", "token": "cetacean person"},
              {"field": "skin_color", "token": "iridescent scale skin"},
              {"field": "breast_size", "token": "modest bust"}],
};

function makeApi(t) {
    return {
        addEventListener() {}, removeEventListener() {},
        fetchApi: async (route, options = {}) => {
            const call = { route, options };
            t.requests.push(call);
            if (route.startsWith("/vnccs/character_wizard/backend")) {
                return { ok: true, status: 200, json: async () => ({ mode: "remote", model: "TestModel", native_fallback: true }) };
            }
            if (route.startsWith("/vnccs/get_tags")) {
                return { ok: true, status: 200, json: async () => ({ tags: { race: [{ tag: "elf" }, "foxfolk"], skin_color: [{ tag: "pale skin" }] } }) };
            }
            if (route === "/vnccs/wizard/assist" && t.failNext) {
                const f = t.failNext; t.failNext = null;
                return { ok: false, status: f.status || 429, json: async () => f.body };
            }
            const body = JSON.parse(options.body || "{}");
            const scripts = {
                draft: () => DRAFT_AI,
                reroll_field: () => ({ suggestions: ["bob cut", "twin tails"] }),
                polish_field: () => ({ value: "long hair, braided" }),
                edit_command: () => ({ patch: { hair: "red_hair", age: 40 }, note: "done" }),
                names: () => ({ suggestions: ["Aria", "Brea"] }),  // already server-sanitized
                review: () => ({ issues: [{ note: "mismatch", field: "hair", suggestion: "silver_hair" }] }),
            };
            return { ok: true, status: 200, json: async () => scripts[body.action]() };
        },
    };
}

async function mount(seed = {}, opts = {}) {
    const t = { requests: [], failNext: null };
    const info = {
        sex: "female", age: 20, race: "human", skin_color: "", body: "slim",
        face: "", hair: "green_hair", eyes: "blue_eyes", additional_details: "freckles",
        breast_size: "small_breasts", ...seed,
    };
    const applied = [];
    const ctx = {
        node: { id: 5 },
        state: { character: "QA-Vex", character_info: info, gen_settings: { generation_mode: "qi2" } },
        els: opts.els || {},
        api: makeApi(t),
        applyCharacterWizardData: data => applied.push(data),
        beginCharacterWizardRequest: () => () => true,
        saveState() {},
        ensureQwenVLReady: async () => true,
        createCharacterByName: opts.create,
        selectCharacterByName: opts.select,
    };
    const { openWizardWorkspace } = await import("../web/vnccs_wizard_workspace.mjs");
    const handle = await openWizardWorkspace(ctx);
    await new Promise(r => setTimeout(r, 0));
    const panel = byClass(fakeDocument.body, "vnccs-ws-panel")[0];
    assert.ok(panel, "workspace panel must mount");
    return {
        t, panel, applied, handle, ctx,
        panes: byClass(panel, "vnccs-ws-pane"),
        input: () => findAll(panel, e => e.tagName === "TEXTAREA" && e.maxLength === 1500)[0],
        send: () => findText(panel, "Send"),
        draftRow: label => byClass(panel, "vnccs-ws-row")
            .find(r => r.children[0]?.textContent === label),
        close: () => handle.close(),
    };
}

const settle = () => new Promise(r => setTimeout(r, 0));

test.afterEach(() => { fakeDocument.body.children.length = 0; });

// ── tests ────────────────────────────────────────────────────────────────────

test("mount: console left, draft right, six modes, footer, backend badge, seeded draft, node untouched", async () => {
    const w = await mount();
    const panes = byClass(w.panel, "vnccs-ws-pane");
    assert.ok(panes[0]._classes.has("vnccs-ws-console"), "AI console is the left pane");
    assert.ok(!panes[1]._classes.has("vnccs-ws-console"), "draft sheet is the right pane");
    assert.equal(byClass(w.panel, "vnccs-ws-mode").length, 6);
    assert.ok(findText(w.panel, "Draft") && findText(w.panel, "Fix…") && findText(w.panel, "Review"));
    assert.ok(findText(w.panel, "Reset from node") && findText(w.panel, "Cancel") && findText(w.panel, "Apply & Close"));
    assert.equal(byClass(w.panel, "vnccs-ws-badge")[0].textContent, "AI: TestModel");
    assert.equal(w.draftRow("Hair").children[1].value, "green_hair");
    // sex/age labels are innerHTML statics (not parsed by the shim): address
    // their inputs structurally as the sole children of the grid rows.
    const grid = byClass(w.panel, "vnccs-ws-grid2")[0];
    assert.equal(grid.children[0].children[0].value, "female", "sex select");
    assert.equal(grid.children[1].children[0].value, 20, "age input");
    assert.equal(w.applied.length, 0, "node must not change before Apply");
    w.close();
});

test("draft action: adopt fills sheet only on chip click; Apply pushes to node", async () => {
    const w = await mount();
    w.input().value = "a timid fox shrine maiden";
    fire(w.send(), "click");
    await settle();
    const call = w.t.requests.find(r => r.route === "/vnccs/wizard/assist");
    const body = JSON.parse(call.options.body);
    assert.equal(body.action, "draft");
    assert.equal(body.node_id, 5);
    assert.ok(body.request_id, "client must always send request_id for dedupe");
    assert.equal(w.applied.length, 0, "no node write on draft result");
    assert.equal(w.draftRow("Hair").children[1].value, "green_hair", "adopt only on click");
    fire(findText(w.panel, "Adopt into draft sheet"), "click");
    assert.equal(w.draftRow("Hair").children[1].value, "silver_hair");
    assert.equal(w.draftRow("Race / species").children[1].value, "foxfolk");
    fire(findText(w.panel, "Apply & Close"), "click");
    assert.equal(w.applied.length, 1);
    assert.equal(w.applied[0].hair, "silver_hair");
    assert.equal(w.applied[0].race, "foxfolk");
    assert.equal(w.applied[0].breast_size, "small_breasts", "10-key contract keeps local breast_size");
    assert.ok(!("evil_extra" in w.applied[0]), "non-contract keys never reach the node");
    assert.equal(w.panel.isConnected, false);
});

test("reroll chip sets field; Cancel asks to discard when dirty", async () => {
    const w = await mount();
    fire(findText(w.panel, "Reroll field"), "click");
    const fieldSel = findAll(w.panel, e => e.tagName === "SELECT")
        .find(e => e.children.some(c => c.value === "hair"));
    fieldSel.value = "hair";
    fire(w.send(), "click");
    await settle();
    const chip = findAll(w.panel, e => e.textContent === "bob cut")[0];
    assert.ok(chip, "suggestions render as chips");
    fire(chip, "click");
    assert.equal(w.draftRow("Hair").children[1].value, "bob cut");
    globalThis.__confirmAnswer = false;
    fire(findText(w.panel, "Cancel"), "click");
    assert.equal(w.panel.isConnected, true, "dirty discard needs confirmation");
    assert.equal(w.applied.length, 0);
    globalThis.__confirmAnswer = true;
    fire(findText(w.panel, "Cancel"), "click");
    assert.equal(w.panel.isConnected, false);
});

test("edit_command Apply all updates sheet; Reset restores node values", async () => {
    const w = await mount();
    fire(findText(w.panel, "Fix…"), "click");
    w.input().value = "make her 40 with red hair";
    fire(w.send(), "click");
    await settle();
    fire(findText(w.panel, "Apply all (2)"), "click");
    assert.equal(w.draftRow("Hair").children[1].value, "red_hair");
    assert.equal(w.applied.length, 0);
    fire(findText(w.panel, "Reset from node"), "click");
    assert.equal(w.draftRow("Hair").children[1].value, "green_hair");
});

test("draft chat: multi-turn history, rationale bubble, New chat reset", async () => {
    const w = await mount();
    w.input().value = "make me a character based on an Egyptian god";
    fire(w.send(), "click");
    await settle();
    let calls = w.t.requests.filter(r => r.route === "/vnccs/wizard/assist").map(r => JSON.parse(r.options.body));
    assert.equal(calls[0].action, "draft");
    assert.deepEqual(calls[0].history, [], "first turn has empty history");
    assert.equal(calls[0].draft.hair, "green_hair", "current sheet travels with the chat");
    const bubble = findAll(w.panel, e => (e.textContent || "").startsWith("I drew on the fox-variant"));
    assert.ok(bubble.length, "rationale renders as the assistant reply");

    w.input().value = "make her younger and friendlier";
    fire(w.send(), "click");
    await settle();
    calls = w.t.requests.filter(r => r.route === "/vnccs/wizard/assist").map(r => JSON.parse(r.options.body));
    assert.equal(calls.length, 2);
    const hist = calls[1].history;
    assert.deepEqual(hist.map(h => h.role), ["user", "assistant"], "back-and-forth carries roles in order");
    assert.equal(hist[0].text, "make me a character based on an Egyptian god");
    assert.ok(hist[1].text.includes("[current draft]"), "assistant turn carries the draft for continuity");
    assert.ok(hist[1].text.includes("foxfolk"));

    fire(findText(w.panel, "New chat"), "click");
    w.input().value = "start over, a desert cartographer";
    fire(w.send(), "click");
    await settle();
    calls = w.t.requests.filter(r => r.route === "/vnccs/wizard/assist").map(r => JSON.parse(r.options.body));
    assert.deepEqual(calls[2].history, [], "New chat starts the designer fresh");
});

test("experiment tags: flagged chips, Adopt to list, per-mode toggle, Apply writes experiment_tags", async () => {
    const w = await mount();
    w.input().value = "make her a cetacean person";
    fire(w.send(), "click");
    await settle();
    const label = findAll(w.panel, e => (e.textContent || "").startsWith("*cetacean person"))[0];
    assert.ok(label, "flagged token renders as an opt-in chip");
    const chip = label.parentNode;
    assert.ok(chip._classes.has("vnccs-ws-exp-chip"), "chip carries the experiment class");
    const adopt = findAll(chip, e => e.textContent === "Adopt")[0];
    assert.ok(adopt, "chip has Adopt");
    fire(adopt, "click");
    const expRow = byClass(w.panel, "vnccs-ws-exp")[0];
    assert.ok(findAll(expRow, e => e.textContent === "*cetacean person").length,
        "adopted tag shows in the experiment row with its render-time asterisk");
    // Adopting a skin token fills the draft row (allowlists gate LLM output only)
    const skinLabel = findAll(w.panel, e => (e.textContent || "").startsWith("*iridescent scale skin"))[0];
    assert.ok(skinLabel, "skin token flagged with its target field");
    assert.ok((skinLabel.textContent || "").includes("skin_color"), "chip names the field");
    fire(findAll(skinLabel.parentNode, e => e.textContent === "Adopt")[0], "click");
    assert.ok(findAll(w.panel, e => e.tagName === "INPUT" && e.value === "iridescent scale skin").length,
        "skin adopt writes into the draft sheet field");
    const cb = findAll(expRow, e => e.tagName === "INPUT" && e.type === "checkbox")[0];
    assert.ok(cb, "per-mode include checkbox exists");
    cb.checked = true;
    fire(cb, "change");
    assert.equal(w.ctx.state.gen_settings.mode_settings.qi2.include_experiment_tags, true,
        "toggle writes per-mode opt-in");
    fire(findText(w.panel, "Apply & Close"), "click");
    assert.deepEqual(w.ctx.state.character_info.experiment_tags, ["cetacean person"],
        "Apply & Close is the only bridge to node state");
    // Ignore hides just that chip
    const w2 = await mount();
    w2.input().value = "void dancer please";
    fire(w2.send(), "click");
    await settle();
    const label2 = findAll(w2.panel, e => (e.textContent || "").startsWith("*modest bust"))[0];
    assert.ok(label2, "breast_size token flagged with its target field");
    const ignore = findAll(label2.parentNode, e => e.textContent === "Ignore")[0];
    fire(ignore, "click");
    assert.equal(label2.parentNode.style.display, "none", "Ignore dismisses only that token");
});

test("names and review render sanitized chips; accept applies suggestion", async () => {
    const w = await mount();
    fire(findText(w.panel, "Names"), "click");
    fire(w.send(), "click");
    await settle();
    const names = findAll(w.panel, e => e._classes.has("vnccs-ws-chip")).map(e => e.textContent);
    assert.deepEqual(names.filter(n => /Aria|Brea/.test(n || "")).sort(),
        ["Use \u201cAria\u201d", "Use \u201cBrea\u201d"], "suggestions render Use chips");
    fire(findAll(w.panel, e => e.textContent === "Copy")[0], "click");
    await settle();
    assert.equal(globalThis.__copied, "Aria", "copy chip still copies via clipboard");
    fire(findText(w.panel, "Review"), "click");
    fire(w.send(), "click");
    await settle();
    const accept = findAll(w.panel, e => (e.textContent || "").startsWith("Accept:"))[0];
    assert.ok(accept, "review suggestion chip");
    fire(accept, "click");
    assert.equal(w.draftRow("Hair").children[1].value, "silver_hair");
});

test("429 in-flight renders error turn without breaking the console", async () => {
    const w = await mount();
    w.t.failNext = { status: 429, body: { error: "IN_FLIGHT", message: "already queued" } };
    fire(findText(w.panel, "Names"), "click");
    fire(w.send(), "click");
    await settle();
    assert.ok(findAll(w.panel, e => (e.textContent || "").includes("IN_FLIGHT")).length, "429 surfaced");
    fire(w.send(), "click"); // console still usable
    await settle();
    assert.ok(w.send(), "send button still present");
});

test("Escape routes through dirty-confirm and never closes silently", async () => {
    const w = await mount();
    w.draftRow("Eyes").children[1].value = "violet eyes";
    fire(w.draftRow("Eyes").children[1], "input");
    globalThis.__confirmAnswer = false;
    fire(w.panel, "keydown", { key: "Escape", target: w.input() });
    assert.equal(w.panel.isConnected, true);
    globalThis.__confirmAnswer = true;
    fire(w.panel, "keydown", { key: "Escape", target: w.input() });
    assert.equal(w.panel.isConnected, false);
});

test("Enter in console sends; Shift+Enter does not", async () => {
    const w = await mount();
    fire(findText(w.panel, "Names"), "click");
    const before = w.t.requests.filter(r => r.route === "/vnccs/wizard/assist").length;
    // the module installs one capture keydown listener on the panel itself
    fire(w.panel, "keydown", { key: "Enter", target: w.input(), shiftKey: false });
    await settle();
    assert.equal(w.t.requests.filter(r => r.route === "/vnccs/wizard/assist").length, before + 1);
    fire(w.panel, "keydown", { key: "Enter", target: w.input(), shiftKey: true });
    await settle();
    assert.equal(w.t.requests.filter(r => r.route === "/vnccs/wizard/assist").length, before + 1);
});

// ── name routing: Names -> name field -> create/switch on Apply ─────────────

test("names: Use fills the name row and preview-hints a new character", async () => {
    const w = await mount();
    const nameRow = w.draftRow("Character name");
    assert.ok(nameRow, "draft sheet has a Character name row");
    assert.equal(nameRow.children[1].value, "", "name starts empty = keep current character");
    fire(findText(w.panel, "Names"), "click");
    fire(w.send(), "click");
    await settle();
    const use = findAll(w.panel, e => e.textContent === 'Use \u201cAria\u201d')[0];
    assert.ok(use, "name suggestions offer a Use button");
    fire(use, "click");
    assert.equal(w.draftRow("Character name").children[1].value, "Aria");
    const hint = findAll(w.panel, e => (e.textContent || "").includes('will be created'))[0];
    assert.ok(hint, "hint states a new character will be created on Apply");
    assert.equal(w.applied.length, 0, "still no node mutation before Apply");
    w.close();
});

test("apply with new name: confirm, create via ctx, then fill fields (name never leaks)", async () => {
    const created = [];
    const w = await mount({}, { create: async (n) => { created.push(n); w.ctx.state.character = n; } });
    w.draftRow("Character name").children[1].value = "Luminoth";
    fire(w.draftRow("Character name").children[1], "input");
    fire(findText(w.panel, "Apply & Close"), "click");
    await settle();
    assert.equal(w.applied.length, 0, "must not apply without confirmation");
    const confirm = findText(w.panel, 'Create \u201cLuminoth\u201d & apply');
    assert.ok(confirm, "create-and-apply confirmation chip offered");
    fire(confirm, "click");
    await settle();
    assert.deepEqual(created, ["Luminoth"], "creation routed through ctx.createCharacterByName");
    assert.equal(w.applied.length, 1, "fields applied after creation");
    assert.ok(!("name" in w.applied[0]), "name must never reach applyCharacterWizardData");
    assert.equal(w.applied[0].hair, "green_hair");
});

test("apply with existing other name: switch via ctx, not create", async () => {
    const selected = [], created = [];
    const els = { charSelect: { options: [{ value: "QA-Vex" }, { value: "Diora" }] } };
    const w = await mount({}, {
        els,
        create: async (n) => { created.push(n); },
        select: async (n) => { selected.push(n); w.ctx.state.character = n; },
    });
    w.draftRow("Character name").children[1].value = "diora"; // case-insensitive match
    fire(w.draftRow("Character name").children[1], "input");
    fire(findText(w.panel, "Apply & Close"), "click");
    await settle();
    const confirm = findText(w.panel, 'Switch to \u201cDiora\u201d & apply');
    assert.ok(confirm, "switch-and-apply chip offered with the canonical spelling");
    fire(confirm, "click");
    await settle();
    assert.deepEqual(selected, ["Diora"], "switch uses the dropdown-canonical spelling, not the typed one");
    assert.equal(created.length, 0, "must not create when the character exists");
    assert.equal(w.applied.length, 1);
});

test("apply with empty or same-case name: no confirmation, node only", async () => {
    const w = await mount();
    fire(findText(w.panel, "Apply & Close"), "click");
    await settle();
    assert.equal(w.applied.length, 1, "empty name applies straight through");
    assert.ok(!("name" in w.applied[0]));

    const w2 = await mount();
    w2.draftRow("Character name").children[1].value = "qa-vex"; // same as current, case-folded
    fire(w2.draftRow("Character name").children[1], "input");
    fire(findText(w2.panel, "Apply & Close"), "click");
    await settle();
    assert.equal(w2.applied.length, 1, "same-name apply is not a create flow");
});

test("names payload never carries the draft name to the assist API", async () => {
    const w = await mount();
    fire(findText(w.panel, "Names"), "click");
    fire(w.send(), "click");
    await settle();
    const call = w.t.requests.filter(r => r.route === "/vnccs/wizard/assist").at(-1);
    const sentDraft = JSON.parse(call.options.body).draft;
    assert.ok(call && !("name" in sentDraft), "assist draft payload must be name-free");
    w.close();
});

