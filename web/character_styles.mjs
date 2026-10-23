import { mountSakuraDialogMotion } from "./sakura_interactions.mjs";

// Style selection stays in widget_data; the user library lives on the server.
export function createStylePicker({ host, catalog, getInfo, save, fetchApi, cleanup,
    getPreviewPayload, imageURL = value => value, listenPreview, showModal, allowNone = () => false, runCharacterPreview = null,
    catalogURL = () => "/vnccs/character_styles", getSecondaryInfo, allowSecondary = () => true }) {
    const make = (tag, className, text) => {
        const element = document.createElement(tag);
        element.className = className;
        if (text !== undefined) element.textContent = text;
        if (tag === "button") element.type = "button";
        return element;
    };
    const allStyles = () => catalog.groups.flatMap(group => group.styles.map(style => ({ ...style, group: group.label })));
    const custom = { id: "custom", label: "Custom style", description: "Describe your own visual style", reference: "Your prompt", image: catalog.custom_preview || "" };
    const noStyle = { id: "none", label: "None", description: "", reference: "", prompt: "" };
    const root = make("div", "vnccs-creator-field");
    root.append(make("div", "vnccs-creator-label", "Style"));
    const trigger = make("button", "vnccs-style-summary");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    const thumbnail = make("span", "vnccs-style-placeholder", "Preview");
    thumbnail.setAttribute("aria-hidden", "true");
    const details = make("span", "vnccs-style-details");
    const name = make("strong", "vnccs-style-name");
    const description = make("span", "vnccs-style-description");
    const reference = make("span", "vnccs-style-reference");
    details.append(name, description, reference);
    trigger.append(thumbnail, details);
    const secondarySlot = make("div", "vnccs-style-secondary");
    const secondaryTrigger = make("button", "vnccs-style-secondary-trigger");
    secondaryTrigger.setAttribute("aria-haspopup", "dialog");
    secondaryTrigger.setAttribute("aria-expanded", "false");
    const secondaryThumbnail = make("span", "vnccs-style-placeholder");
    secondaryThumbnail.setAttribute("aria-hidden", "true");
    const secondaryName = make("span", "vnccs-style-secondary-name");
    secondaryTrigger.append(secondaryName, secondaryThumbnail);
    const clearSecondary = make("button", "vnccs-style-secondary-clear", "×");
    clearSecondary.setAttribute("aria-label", "Remove second style");
    clearSecondary.title = "Remove second style";
    secondarySlot.append(secondaryTrigger, clearSecondary);
    const customInput = make("input", "vnccs-creator-input");
    customInput.type = "text";
    customInput.placeholder = "Describe any visual style";
    customInput.setAttribute("aria-label", "Custom style description");
    customInput.maxLength = 16000;
    customInput.hidden = true;
    customInput.oninput = () => { getInfo().custom_style = customInput.value; save(); };
    if (getSecondaryInfo) {
        const selection = make("div", "vnccs-style-selection");
        selection.append(trigger, secondarySlot);
        root.append(selection, customInput);
    } else root.append(trigger, customInput);
    let overlay = null;
    let disposed = false;
    const motion = { get _removed() { return disposed; } };
    let requestId = 0;
    let contextRevision = 0;
    let inertChildren = [];
    let batch = null;
    let deleting = false;
    let confirmation = null;
    let editingSecondary = false;
    let prefs = { favorites: [], sets: {} };
    let prefsRevision = 0;
    let setFilter = "";
    let popover = null;
    let popoverOutside = null;
    let favCollapsed = false;
    try { favCollapsed = localStorage.getItem("VNCCS_styleFavCollapsed") === "1"; } catch (error) { /* storage unavailable */ }
    const selectedInfo = () => editingSecondary ? getSecondaryInfo() : getInfo();
    let cardScale = 130;
    let progressMessage = "";
    let updateGallery = () => {};
    let refreshLibrary = () => {};
    let statusEl = null;
    const setStatus = text => { if (!disposed && statusEl) statusEl.textContent = text; };
    let generatePreviews = async () => false;
    const hasPrimaryStyle = () => !["", "none"].includes(String(getInfo()?.style || "").trim().toLowerCase());
    const paintPreview = (element, style) => {
        element.replaceChildren();
        const fallback = make("span", "", "Preview");
        element.append(fallback);
        if (style?.image?.startsWith("/vnccs/character_styles/preview?")) {
            const image = make("img", "vnccs-style-preview-image");
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            fallback.hidden = true;
            image.onerror = () => { image.remove(); fallback.hidden = false; };
            image.src = imageURL(style.image);
            element.append(image);
        }
    };
    listenPreview?.(event => {
        const detail = event.detail;
        if (!batch || disposed || String(detail.node_id) !== String(batch.payload.node_id)
            || detail.request_id !== batch.requestId) return;
        if (["queued", "running"].includes(detail.status)) {
            progressMessage = `${detail.status === "queued" ? "Queued" : "Rendering"} ${batch.index + 1}/${batch.styles.length}: ${batch.styles[batch.index].label}`;
            updateGallery();
        }
    });
    const selectedStyle = (info = getInfo()) => allStyles().find(style => style.id === info.style);
    const setValue = (value, persist = false, secondary = false) => {
        const info = secondary ? getSecondaryInfo() : getInfo();
        info.style = catalog.aliases?.[value] || value || (secondary ? "none" : catalog.default_style || "custom");
        const style = info.style === "none" ? noStyle : info.style === "custom" ? custom : selectedStyle(info);
        if (!secondary) {
            paintPreview(thumbnail, style);
            name.textContent = style?.label || info.style_label || "Unavailable style";
            description.textContent = style ? style.description || "" : info.style_description || "Saved style; restore its library to edit it";
            const styleReference = style ? style.reference || "" : info.style_reference || "";
            reference.textContent = info.style === "none" ? "No style selected" : styleReference ? `Reference: ${styleReference}` : "";
            description.hidden = !description.textContent;
            reference.hidden = !reference.textContent;
            description.title = description.textContent;
            reference.title = reference.textContent;
            customInput.value = info.custom_style || "";
            customInput.style.display = "none";
            trigger.setAttribute("aria-label", `Choose style: ${name.textContent}`);
        }
        if (getSecondaryInfo) {
            const extra = getSecondaryInfo();
            const empty = !extra.style || extra.style === "none";
            secondarySlot.hidden = !allowSecondary() || !hasPrimaryStyle();
            secondaryName.textContent = empty
                ? "Choose a second style to blend, or leave empty"
                : selectedStyle(extra)?.label || extra.style_label || "Unavailable style";
            secondaryName.setAttribute("data-empty", String(empty));
            if (empty) secondaryThumbnail.replaceChildren(make("span", "", "+"));
            else paintPreview(secondaryThumbnail, selectedStyle(extra));
            secondaryTrigger.setAttribute("aria-label", empty ? "Add second style" : `Choose second style: ${secondaryName.textContent}`);
            secondaryTrigger.title = empty ? "Add an optional second style to mix with the first" : secondaryName.textContent;
            clearSecondary.hidden = empty;
        }
        if (persist) {
            info.style_prompt = style?.prompt || "";
            info.style_label = style?.label || "";
            info.style_description = style?.description || "";
            info.style_reference = style?.reference || "";
            save();
        }
    };
    clearSecondary.onclick = () => setValue("none", true, true);
    const close = (restoreFocus = true) => {
        requestId++;
        if (batch) {
            batch.cancelled = true;
            progressMessage = "Stopping after the current image is saved...";
        }
        updateGallery = () => {};
        refreshLibrary = () => {};
        closePopover();
        confirmation?.remove();
        confirmation = null;
        overlay?.remove();
        overlay = null;
        statusEl = null;
        for (const [element, previous] of inertChildren) element.inert = previous;
        inertChildren = [];
        trigger.setAttribute("aria-expanded", "false");
        secondaryTrigger.setAttribute("aria-expanded", "false");
        if (restoreFocus && !disposed) (editingSecondary ? secondaryTrigger : trigger).focus({ preventScroll: true });
    };
    cleanup(() => {
        disposed = true; close(false);
        for (const animation of [...(motion._motionAnimations || [])]) animation.cancel();
    });
    const postPrefs = async body => {
        const response = await fetchApi("/vnccs/style_prefs", {
            method: "POST", headers: { "Content-Type": "application/json", "X-VNCCS-CSRF": "1" }, body: JSON.stringify(body),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (!result || !Array.isArray(result.favorites) || !result.sets) throw new Error("Invalid style preferences response");
        prefs = { favorites: result.favorites, sets: result.sets };
        prefsRevision++;
    };
    const closePopover = () => {
        popover?.remove();
        popover = null;
        if (popoverOutside) { document.removeEventListener("pointerdown", popoverOutside, true); popoverOutside = null; }
    };
    const openPopover = (anchor, buildItems) => {
        closePopover();
        if (!overlay || disposed) return;
        const box = make("div", "vnccs-style-popover");
        const fill = () => {
            box.replaceChildren();
            const items = typeof buildItems === "function" ? buildItems() : buildItems;
            for (const item of items) {
                if (item.divider) { box.append(make("hr", "vnccs-style-popover-divider")); continue; }
                const button = make("button", item.danger ? "vnccs-style-popover-danger" : "", item.label);
                if (item.title) button.title = item.title;
                button.onclick = async () => {
                    button.disabled = true;
                    try { await item.onClick(); }
                    catch (error) { setStatus(`Style sets: ${error.message}`); }
                    finally { if (button.isConnected) button.disabled = false; }
                };
                box.append(button);
            }
        };
        box._vnccsFill = fill;
        fill();
        overlay.append(box);
        const rect = anchor.getBoundingClientRect();
        const size = box.getBoundingClientRect();
        box.style.top = `${Math.min(window.innerHeight - size.height - 8, rect.bottom + 6)}px`;
        box.style.left = `${Math.max(8, Math.min(window.innerWidth - size.width - 8, rect.left))}px`;
        popover = box;
        popoverOutside = event => { if (popover && !popover.contains(event.target) && (anchor.isConnected ? !anchor.contains(event.target) : true)) closePopover(); };
        document.addEventListener("pointerdown", popoverOutside, true);
    };
    const refreshPopover = () => { try { popover?._vnccsFill?.(); } catch (error) { closePopover(); } };
    const askText = ({ title, submitText, initial = "", onSubmit }) => {
        if (!showModal || confirmation?.isConnected) return;
        const input = make("input", "vnccs-creator-input");
        input.value = initial;
        input.maxLength = 60;
        const errorText = make("p", "vnccs-style-status");
        const body = make("div", "");
        body.append(input, errorText);
        const dialog = showModal(overlay, title, () => body, [
            { text: "Cancel" },
            { text: submitText, action: async () => {
                try { await onSubmit(input.value); return false; }
                catch (error) { errorText.textContent = error.message; return true; }
            } },
        ]);
        confirmation = dialog.overlay;
        input.focus();
        input.select();
    };
    const refreshPrefs = async () => {
        const currentOverlay = overlay;
        const revision = prefsRevision;
        const response = await fetchApi("/vnccs/style_prefs");
        const result = await response.json().catch(() => null);
        if (disposed || !overlay || overlay !== currentOverlay || !response.ok) return;
        if (revision !== prefsRevision) return;  // a mutation landed mid-flight; its state is fresher
        if (result && Array.isArray(result.favorites) && result.sets) prefs = { favorites: result.favorites, sets: result.sets };
    };
    const toggleFavorite = async styleId => {
        if (batch || deleting) return;
        await postPrefs({ action: "toggle_favorite", style_id: styleId });
        refreshLibrary();
        setStatus(prefs.favorites.includes(styleId) ? "Added to favorites" : "Removed from favorites");
    };
    const runStyleSet = async name => {
        if (batch) { batch.cancelled = true; progressMessage = "Stopping after the current style is saved..."; updateGallery(); return; }
        const members = prefs.sets[name];
        if (!Array.isArray(members) || !members.length) { setStatus(`Set “${name}” has no styles yet — add some from a card’s Sets button.`); return; }
        const styles = allStyles().filter(style => members.includes(style.id) && style.id !== "none" && style.id !== "custom");
        if (!styles.length) { setStatus(`Set “${name}” holds no styles from this model catalog.`); return; }
        if (typeof runCharacterPreview !== "function") { setStatus("Character preview is not available from this picker."); return; }
        const current = { cancelled: false, engine: "char" };
        batch = current;
        progressMessage = "";
        updateGallery();
        let failures = 0;
        for (const [index, style] of styles.entries()) {
            if (current.cancelled || disposed || !overlay) break;
            progressMessage = `Creator preview ${index + 1}/${styles.length}: ${style.label}`;
            updateGallery();
            try {
                await runCharacterPreview(style.id);
                if (!current.cancelled) progressMessage = `Saved creator preview ${index + 1}/${styles.length}: ${style.label}`;
            } catch (error) {
                failures++;
                progressMessage = `Creator preview ${index + 1}/${styles.length} failed (${style.label}: ${error?.message || error}). Completed previews are kept.`;
            }
            updateGallery();
        }
        progressMessage = current.cancelled
            ? "Stopped. Creator previews rendered so far are saved."
            : failures ? `Finished with ${failures} of ${styles.length} previews failed.` : `All ${styles.length} creator previews saved to the character.`;
        batch = null;
        if (!disposed) updateGallery();
    };
    const promptNewSet = () => askText({
        title: "New style set", submitText: "Create",
        onSubmit: async value => { await postPrefs({ action: "create_set", name: value.trim() }); refreshLibrary(); refreshPopover(); },
    });
    const openSetsMenu = anchor => openPopover(anchor, buildSetsMenuItems);
    const buildSetsMenuItems = () => {
        const names = Object.keys(prefs.sets);
        const items = [];
        if (!names.length) items.push({ label: "No sets yet — create one below", onClick: async () => {}, title: "" });
        for (const name of names) {
            const count = (prefs.sets[name] || []).length;
            items.push({
                label: `${setFilter === name ? "◉" : "○"} ${name} (${count})`,
                title: "Filter the library to this set (click again to clear)",
                onClick: async () => { setFilter = setFilter === name ? "" : name; refreshLibrary(); refreshPopover(); },
            });
            items.push({ label: `Rename ${name}…`, onClick: () => askText({
                title: `Rename set “${name}”`, submitText: "Rename", initial: name,
                onSubmit: async value => {
                    const next = value.trim();
                    if (!next || next === name) return;
                    await postPrefs({ action: "rename_set", name, new_name: next });
                    if (setFilter === name) setFilter = next;
                    refreshLibrary(); refreshPopover();
                },
            }) });
            items.push({ label: `Delete ${name}`, danger: true, onClick: () => askText({
                title: `Delete set “${name}”?`, submitText: "Delete",
                onSubmit: async () => {
                    await postPrefs({ action: "delete_set", name });
                    if (setFilter === name) setFilter = "";
                    refreshLibrary(); refreshPopover();
                },
            }) });
        }
        items.push({ divider: true });
        items.push({ label: "+ New set…", onClick: () => promptNewSet() });
        return items;
    };
    const openTileSetsMenu = (anchor, style) => openPopover(anchor, () => buildTileSetsMenuItems(style));
    const buildTileSetsMenuItems = style => {
        const items = [];
        const entries = Object.entries(prefs.sets).map(([name, members]) => ({
            label: `${members.includes(style.id) ? "✓" : "○"} ${name} (${members.length})`,
            title: "Add or remove this style from the set",
            onClick: async () => { await postPrefs({ action: "toggle_member", name, style_id: style.id }); refreshLibrary(); refreshPopover(); },
        }));
        if (entries.length) items.push(...entries, { divider: true });
        else items.push({ label: "No sets yet", onClick: async () => {} });
        items.push({ label: "+ New set…", onClick: () => promptNewSet() });
        return items;
    };
    const open = async (secondary = false) => {
        if (overlay || disposed || (secondary && (!getSecondaryInfo || !allowSecondary() || !hasPrimaryStyle()))) return;
        editingSecondary = secondary;
        setFilter = "";
        if (!batch) progressMessage = "";
        overlay = make("section", "vnccs-style-gallery");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Style library");
        overlay.onkeydown = event => {
            if (popover && event.key === "Escape") { event.stopPropagation(); event.preventDefault(); closePopover(); return; }
            if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(); }
            if (event.key === "Tab") {
                const controls = [...overlay.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")].filter(el => !el.closest("[hidden]"));
                const first = controls[0], last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        };
        const header = make("div", "vnccs-style-toolbar");
        header.append(make("strong", "vnccs-style-heading", "Style library"));
        const search = make("input", "vnccs-creator-input");
        search.placeholder = "Search styles...";
        search.setAttribute("aria-label", "Search styles");
        const filter = make("select", "vnccs-creator-select");
        filter.setAttribute("aria-label", "Style category");
        const setsBtn = make("button", "vnccs-creator-btn", "Sets ▾");
        setsBtn.title = "Style sets: create sets, add styles from each card's Sets button, then filter, rename, delete, or queue a preview run for a set.";
        setsBtn.onclick = () => { if (batch || deleting || !editor.hidden) return; openSetsMenu(setsBtn); };
        setsBtn.hidden = editingSecondary;
        const batchBtn = make("button", "vnccs-creator-btn", "Batch Set Previews");
        batchBtn.title = "Queue preview renders for every style in the set currently selected in the Sets menu, using the current Creator settings. While a run is active this button stops it after the current image.";
        batchBtn.onclick = () => {
            if (batch || deleting || !editor.hidden) { if (batch) runStyleSet(setFilter); return; }
            if (!setFilter) { setStatus("Pick a set in the Sets menu first, then batch its previews with the current Creator settings."); return; }
            runStyleSet(setFilter);
        };
        batchBtn.hidden = editingSecondary;
        const add = make("button", "vnccs-creator-btn", "New style");
        const generateAll = make("button", "vnccs-creator-btn", "Generate all previews");
        generateAll.title = "Render every library style sequentially using current Creator settings and resolution scale. Stop finishes the current image.";
        generateAll.hidden = true;
        const dismiss = make("button", "vnccs-creator-btn", "Close");
        dismiss.title = "Close the library and stop after the current preview";
        dismiss.onclick = () => close();
        header.append(search, filter, setsBtn, batchBtn, add, generateAll, dismiss);
        const sizeControls = make("label", "vnccs-style-size-controls", "Card size");
        const sizeSlider = make("input", "vnccs-style-size-slider");
        sizeSlider.type = "range";
        sizeSlider.min = "80";
        sizeSlider.max = "250";
        sizeSlider.step = "10";
        sizeSlider.value = String(cardScale);
        sizeSlider.setAttribute("aria-label", "Style card size");
        const sizeValue = make("output", "vnccs-style-size-value");
        sizeControls.append(sizeSlider, sizeValue);
        const location = make("div", "vnccs-style-preview-location");
        location.textContent = catalog.preview_directory ? `Preview folder: ${catalog.preview_directory}` : "";
        const status = make("div", "vnccs-style-status", "Loading styles...");
        status.setAttribute("role", "status");
        statusEl = status;
        const content = make("div", "vnccs-style-content");
        const favHead = make("div", "vnccs-style-fav-head");
        const favToggle = make("button", "vnccs-style-fav-toggle");
        favToggle.onclick = () => {
            favCollapsed = !favCollapsed;
            try { localStorage.setItem("VNCCS_styleFavCollapsed", favCollapsed ? "1" : "0"); } catch (error) { /* storage unavailable */ }
            render();
        };
        favHead.append(favToggle);
        const favGrid = make("div", "vnccs-style-grid vnccs-style-fav-grid");
        favHead.hidden = favGrid.hidden = true;
        const grid = make("div", "vnccs-style-grid");
        const updateCardSize = () => {
            const value = Number(sizeSlider.value);
            cardScale = Number.isFinite(value) ? Math.max(80, Math.min(250, value)) : 130;
            grid.style.setProperty("--vnccs-style-card-size", `${140 * cardScale / 100}px`);
            favGrid.style.setProperty("--vnccs-style-card-size", `${140 * cardScale / 100}px`);
            sizeValue.textContent = `${cardScale}%`;
            sizeSlider.setAttribute("aria-valuetext", `${cardScale}%`);
        };
        sizeSlider.oninput = updateCardSize;
        updateCardSize();
        const editor = make("form", "vnccs-style-editor");
        editor.hidden = true;
        content.append(favHead, favGrid, grid, editor);
        overlay.append(header, sizeControls, location, status, content);
        inertChildren = [...host.children].map(element => [element, element.inert]);
        for (const [element] of inertChildren) element.inert = true;
        host.append(overlay);
        mountSakuraDialogMotion(motion, overlay, overlay);
        (editingSecondary ? secondaryTrigger : trigger).setAttribute("aria-expanded", "true");
        search.focus({ preventScroll: true });
        let loadingCatalog = true;
        const previewSlots = new Map();
        updateGallery = (styleId) => {
            add.disabled = !editor.hidden || !!batch || deleting;
            generateAll.textContent = batch ? (batch.cancelled ? "Stopping..." : "Stop after current") : "Generate all previews";
            generateAll.disabled = loadingCatalog || deleting || !editor.hidden || !!batch?.cancelled;
            batchBtn.textContent = batch ? (batch.cancelled ? "Stopping..." : "Stop batch") : "Batch Set Previews";
            batchBtn.disabled = loadingCatalog || deleting || !editor.hidden || !setFilter || !!batch?.cancelled;
            if (batch) closePopover();
            for (const tileHost of [grid, favGrid]) {
                for (const edit of tileHost.querySelectorAll(".vnccs-style-edit")) edit.disabled = !!batch || deleting;
                for (const button of tileHost.querySelectorAll(".vnccs-style-delete")) button.disabled = loadingCatalog || !!batch || deleting;
                for (const button of tileHost.querySelectorAll(".vnccs-style-fav, .vnccs-style-sets-open")) button.disabled = !!batch || deleting;
            }
            if (styleId) {
                const style = allStyles().find(item => item.id === styleId) || (styleId === "custom" ? custom : null);
                for (const slot of previewSlots.get(styleId) || []) paintPreview(slot, style);
                if (getInfo().style === styleId) paintPreview(thumbnail, style);
                if (getSecondaryInfo?.().style === styleId) paintPreview(secondaryThumbnail, style);
            }
            if (progressMessage) status.textContent = progressMessage;
        };
        const render = () => {
            grid.replaceChildren();
            favGrid.replaceChildren();
            previewSlots.clear();
            if (!batch) progressMessage = "";
            const query = search.value.trim().toLowerCase();
            let base = [...(editingSecondary || allowNone() ? [noStyle] : []), custom, ...allStyles()];
            if (setFilter && prefs.sets[setFilter]) {
                const members = new Set(prefs.sets[setFilter]);
                base = base.filter(style => members.has(style.id));
            }
            const styles = base.filter(style =>
                (!filter.value || style.group === filter.value) &&
                [style.label, style.description, style.reference].join(" ").toLowerCase().includes(query));
            status.textContent = setFilter
                ? `Set “${setFilter}”: ${styles.length} styles`
                : (styles.length ? `${styles.length} styles` : "No matching styles");
            const favSet = new Set(prefs.favorites);
            const buildTile = (style, inFavorites) => {
                const tile = make("div", "vnccs-style-tile");
                const card = make("button", "vnccs-style-card");
                card.setAttribute("aria-pressed", String(style.id === selectedInfo().style));
                card.title = [style.description, style.reference].filter(Boolean).join("\n");
                const placeholder = make("span", "vnccs-style-placeholder", "Preview");
                placeholder.setAttribute("aria-hidden", "true");
                paintPreview(placeholder, style);
                const slots = previewSlots.get(style.id) || [];
                slots.push(placeholder);
                previewSlots.set(style.id, slots);
                card.append(placeholder, make("span", "vnccs-style-card-label", style.label));
                card.onclick = () => {
                    if (style.id === "custom") {
                        showEditor({ label: "Custom style", prompt: selectedInfo().custom_style || "", reference: "Your prompt" });
                    } else { setValue(style.id, true, editingSecondary); close(); }
                };
                tile.append(card);
                if (style.id !== "none") {
                    const starred = favSet.has(style.id);
                    const fav = make("button", starred ? "vnccs-style-fav vnccs-style-fav--on" : "vnccs-style-fav", starred ? "★" : "☆");
                    fav.title = starred ? "Remove from favorites" : "Add to favorites";
                    fav.setAttribute("aria-label", `${starred ? "Unfavorite" : "Favorite"} ${style.label}`);
                    fav.disabled = !!batch || deleting;
                    fav.onclick = async event => {
                        event.stopPropagation();
                        if (fav.disabled) return;
                        fav.disabled = true;
                        try { await toggleFavorite(style.id); }
                        catch (error) { setStatus(`Favorites: ${error.message}`); fav.disabled = !!batch || deleting; }
                    };
                    tile.append(fav);
                    if (style.id !== "custom" && !editingSecondary) {
                        const setsOpen = make("button", "vnccs-style-sets-open", "⛁");
                        setsOpen.title = "Add this style to a set";
                        setsOpen.setAttribute("aria-label", `Sets for ${style.label}`);
                        setsOpen.disabled = !!batch || deleting;
                        setsOpen.onclick = event => { event.stopPropagation(); if (batch || deleting) return; openTileSetsMenu(setsOpen, style); };
                        tile.append(setsOpen);
                    }
                }
                if (style.user) {
                    const edit = make("button", "vnccs-style-edit", "Edit");
                    edit.setAttribute("aria-label", `Edit ${style.label}`);
                    edit.onclick = () => showEditor(style);
                    tile.append(edit);
                    if (showModal) {
                        const remove = make("button", "vnccs-style-delete", "×");
                        remove.title = "Delete style";
                        remove.setAttribute("aria-label", `Delete ${style.label}`);
                        remove.onclick = event => {
                            event?.stopPropagation();
                            if (loadingCatalog || batch || deleting || confirmation?.isConnected) return;
                            const currentOverlay = overlay;
                            const message = make("p", "", `Delete “${style.label}”? Its saved style and preview will be permanently removed.`);
                            const errorText = make("p", "vnccs-style-status");
                            const body = make("div", "");
                            body.append(message, errorText);
                            const dialog = showModal(overlay, "Delete style", () => body, [
                                { text: "Cancel" },
                                { text: "Delete", class: "danger", action: async () => {
                                    if (deleting || disposed || overlay !== currentOverlay) return false;
                                    deleting = true;
                                    updateGallery();
                                    const selection = JSON.stringify(getInfo());
                                    const selectionRevision = contextRevision;
                                    try {
                                        const response = await fetchApi(`/vnccs/character_styles/delete?style=${encodeURIComponent(style.id)}`, {
                                            method: "POST", headers: { "X-VNCCS-CSRF": "1" },
                                        });
                                        const result = await response.json();
                                        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
                                        if (result.deleted !== true || result.style_id !== style.id) throw new Error("Invalid style deletion response");
                                        if (disposed) return false;
                                        for (const group of catalog.groups) group.styles = group.styles.filter(item => item.id !== style.id);
                                        catalog.groups = catalog.groups.filter(group => group.label !== "My styles" || group.styles.length);
                                        if (contextRevision === selectionRevision && JSON.stringify(getInfo()) === selection) {
                                            if (getInfo().style === style.id) setValue(catalog.default_style, true);
                                            if (getSecondaryInfo?.().style === style.id) setValue("none", true, true);
                                        }
                                        refreshLibrary();
                                        setStatus(`Deleted: ${style.label}`);
                                        if (overlay === currentOverlay) search.focus();
                                        return false;
                                    } catch (error) {
                                        errorText.textContent = `Cannot delete style: ${error.message}`;
                                        return true;
                                    } finally {
                                        deleting = false;
                                        if (!disposed) updateGallery();
                                    }
                                } },
                            ]);
                            confirmation = dialog.overlay;
                        };
                        tile.append(remove);
                    }
                }
                return tile;
            };
            const favorites = styles.filter(style => favSet.has(style.id) && style.id !== "none");
            favHead.hidden = !favorites.length;
            favGrid.hidden = !favorites.length || favCollapsed;
            favToggle.textContent = `${favCollapsed ? "▸" : "▾"} ★ Favorites (${favorites.length})`;
            for (const style of favorites) favGrid.append(buildTile(style, true));
            for (const style of styles) grid.append(buildTile(style, false));
            updateGallery();
        };
        const updateFilters = () => {
            const previous = filter.value;
            filter.replaceChildren();
            for (const label of ["", ...catalog.groups.map(group => group.label)]) {
                const option = make("option", "", label || "All styles");
                option.value = label;
                filter.append(option);
            }
            filter.value = previous;
        };
        const showEditor = (style = {}) => {
            if (batch || deleting) return;
            progressMessage = "";
            requestId++;
            loadingCatalog = false;
            editor.replaceChildren();
            editor.hidden = false;
            grid.hidden = true;
            favHead.hidden = favGrid.hidden = true;  // live favorite cards would silently discard the draft
            search.disabled = filter.disabled = add.disabled = true;
            status.textContent = style.id ? "Edit your style" : "Create your style";
            updateGallery();
            let draft = { ...style };
            const preview = make("div", "vnccs-style-placeholder");
            paintPreview(preview, draft);
            editor.append(preview);
            const fields = {};
            for (const [key, label, limit] of [["label", "Name", 100], ["description", "Short description", 240], ["reference", "Reference", 500], ["prompt", "Style prompt", 16000]]) {
                const wrapper = make("label", "vnccs-creator-field", label);
                const input = make(key === "prompt" ? "textarea" : "input", key === "prompt" ? "vnccs-creator-textarea" : "vnccs-creator-input");
                input.value = style[key] || "";
                input.maxLength = limit;
                input.required = key === "label" || key === "prompt";
                if (key === "prompt") input.rows = 8;
                wrapper.append(input);
                editor.append(wrapper);
                fields[key] = input;
            }
            const actions = make("div", "vnccs-style-toolbar");
            const submit = make("button", "vnccs-creator-btn", "Save style");
            submit.type = "submit";
            const cancel = make("button", "vnccs-creator-btn", "Back to library");
            const generate = make("button", "vnccs-creator-btn", "Generate preview");
            generate.title = "Save this style and render only its portrait preview with seed 0 and current Creator settings.";
            generate.hidden = !getPreviewPayload;
            cancel.onclick = () => {
                editor.hidden = true; grid.hidden = false;
                search.disabled = filter.disabled = add.disabled = false;
                render(); search.focus();
            };
            actions.append(submit, generate, cancel);
            editor.append(actions);
            fields.label.focus();
            const storeDraft = async () => {
                const token = ++requestId;
                const payload = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
                if (draft.id) payload.id = draft.id;
                if (draft.revision) payload.revision = draft.revision;
                const response = await fetchApi("/vnccs/character_styles", {
                    method: "POST", headers: { "Content-Type": "application/json", "X-VNCCS-CSRF": "1" }, body: JSON.stringify(payload),
                });
                const result = await response.json();
                if (token !== requestId || disposed) return null;
                if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
                let group = catalog.groups.find(item => item.label === "My styles");
                if (!group) { group = { label: "My styles", styles: [] }; catalog.groups.push(group); }
                group.styles = group.styles.filter(item => item.id !== result.style.id);
                draft = result.style;
                group.styles.push(draft);
                setValue(draft.id, true, editingSecondary);
                paintPreview(preview, draft);
                return draft;
            };
            const commit = async renderPreview => {
                if (submit.disabled || (editor.reportValidity && !editor.reportValidity())) return;
                submit.disabled = generate.disabled = cancel.disabled = true;
                for (const field of Object.values(fields)) field.disabled = true;
                const currentOverlay = overlay;
                try {
                    const stored = await storeDraft();
                    if (!stored) return;
                    if (renderPreview) {
                        const payload = JSON.parse(JSON.stringify(getPreviewPayload()));
                        payload.gen_settings = { ...payload.gen_settings, seed: 0, seed_mode: "fixed", mode_settings: {} };
                        await generatePreviews([stored], payload);
                        if (!disposed && overlay === currentOverlay) paintPreview(preview, draft);
                    } else close();
                } catch (error) {
                    if (!disposed && overlay === currentOverlay) status.textContent = `Cannot save style: ${error.message}`;
                } finally {
                    submit.disabled = generate.disabled = cancel.disabled = false;
                    for (const field of Object.values(fields)) field.disabled = false;
                }
            };
            editor.onsubmit = event => { event.preventDefault(); return commit(false); };
            generate.onclick = () => commit(true);
        };
        search.oninput = filter.onchange = render;
        add.onclick = () => showEditor();
        generateAll.onclick = () => generatePreviews();
        generatePreviews = async (requestedStyles, requestedPayload) => {
            if (batch) {
                batch.cancelled = true;
                progressMessage = "Stopping after the current image is saved...";
                updateGallery();
                return;
            }
            if (loadingCatalog || deleting || (!editor.hidden && !requestedStyles) || disposed || !overlay) return false;
            let current;
            try {
                const payload = JSON.parse(JSON.stringify(requestedPayload || getPreviewPayload()));
                const styles = requestedStyles || [...allStyles()];
                if (!requestedStyles && payload.character_info.custom_style?.trim()) styles.push({ ...custom });
                current = { payload, styles, index: 0, cancelled: false, requestId: "", key: `${Date.now()}-${++requestId}` };
                batch = current;
                for (const [index, style] of styles.entries()) {
                    if (current.cancelled || disposed) break;
                    current.index = index;
                    current.requestId = `${current.key}-${index}`;
                    progressMessage = `Rendering ${index + 1}/${styles.length}: ${style.label}`;
                    updateGallery();
                    const response = await fetchApi("/vnccs/character_styles/preview", {
                        method: "POST", headers: { "Content-Type": "application/json", "X-VNCCS-CSRF": "1" },
                        body: JSON.stringify({ ...payload, style_id: style.id, request_id: current.requestId }),
                    });
                    if (!response.ok) throw new Error(await response.text());
                    const result = await response.json();
                    if (result.saved !== true) throw new Error("Server did not confirm saving the WebP file to disk");
                    if (result.style_id !== style.id || !result.image?.startsWith("/vnccs/character_styles/preview?"))
                        throw new Error("Invalid style preview response");
                    for (const group of catalog.groups) {
                        const item = group.styles.find(item => item.id === style.id);
                        if (item) item.image = result.image;
                    }
                    if (style.id === "custom") custom.image = result.image;
                    progressMessage = `Saved ${index + 1}/${styles.length}: ${style.label} (${result.width} × ${result.height}, WebP)`;
                    updateGallery(style.id);
                }
                progressMessage = current.cancelled ? "Stopped. Completed previews are saved." : `Saved all ${styles.length} style previews.`;
                return true;
            } catch (error) {
                progressMessage = `Preview generation stopped: ${error.message}. Completed previews are saved.`;
                return false;
            } finally {
                batch = null;
                if (!disposed) updateGallery();
            }
        };
        refreshLibrary = () => { requestId++; loadingCatalog = false; updateFilters(); render(); };
        updateFilters();
        render();
        refreshPrefs().then(() => { if (!disposed && overlay) render(); }).catch(() => {});
        const token = ++requestId;
        try {
            const response = await fetchApi(catalogURL());
            const result = await response.json();
            if (token !== requestId || disposed) return;
            if (!response.ok || !Array.isArray(result.groups)) throw new Error(result.error || `HTTP ${response.status}`);
            catalog = result;
            location.textContent = result.preview_directory ? `Preview folder: ${result.preview_directory}` : "";
            custom.image = result.custom_preview || "";
            loadingCatalog = false;
            updateFilters(); render(); setValue(getInfo().style);
        } catch (error) {
            if (token === requestId && !disposed) {
                loadingCatalog = false;
                updateGallery();
                status.textContent = `Cannot refresh styles: ${error.message}. Showing cached library.`;
            }
        }
    };
    trigger.onclick = () => open();
    secondaryTrigger.onclick = () => open(true);
    setValue(getInfo().style);
    const setCatalog = nextCatalog => {
        if (!nextCatalog || !Array.isArray(nextCatalog.groups) || catalog === nextCatalog) return;
        contextRevision++;
        close(false);
        catalog = nextCatalog;
        custom.image = catalog.custom_preview || "";
    };
    return { root, setValue, setCatalog, close: (restoreFocus = true) => { contextRevision++; close(restoreFocus); },
        customInput, generatePreviews: (...args) => generatePreviews(...args) };
}
