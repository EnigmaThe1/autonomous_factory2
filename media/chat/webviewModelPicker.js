export function modelPickerFieldHtml({
  inputId,
  inputPlaceholder,
  buttonId,
  popoverId,
  emptyId,
  listId,
  ariaLabel,
  emptyText,
  scope,
  inputValue = ""
}) {
  return `<div class="model-picker-field" data-model-picker-scope="${escapeAttr(scope || "")}">
    <div class="model-input-with-trigger">
      <input id="${escapeAttr(inputId)}" type="text" autocomplete="off" placeholder="${escapeAttr(inputPlaceholder || "")}" value="${escapeAttr(inputValue || "")}" />
      <button type="button" id="${escapeAttr(buttonId)}" class="ghost model-catalog-trigger" data-model-picker-trigger="true" aria-expanded="false" aria-controls="${escapeAttr(popoverId)}" title="Open list of models from this provider’s catalog">Catalog ▾</button>
    </div>
    <div id="${escapeAttr(popoverId)}" class="model-catalog-popover" data-model-picker-popover="true" hidden>
      <div id="${escapeAttr(emptyId)}" class="model-catalog-empty meta" hidden>${escapeHtmlText(emptyText || "No models in catalog for this provider.")}</div>
      <ul id="${escapeAttr(listId)}" class="model-catalog-ul" data-model-picker-list="true" role="listbox" aria-label="${escapeAttr(ariaLabel || "Models from provider catalog")}"></ul>
    </div>
  </div>`;
}

export function syncProviderAwareModelPicker({
  snapshot,
  providerId,
  inputEl,
  buttonEl,
  popoverEl,
  listEl,
  emptyEl,
  mergeModelLists,
  fillProviderModelCatalogList
}) {
  if (!snapshot || !inputEl || !listEl) return { merged: [], sourceLabel: "Preset suggestions" };
  const pid = providerId || snapshot.defaultProvider;
  const mergedInfo = mergeModelLists(snapshot, pid);
  fillProviderModelCatalogList(listEl, emptyEl, mergedInfo.merged);
  if (buttonEl) {
    buttonEl.dataset.providerId = pid || "";
    buttonEl.setAttribute("aria-expanded", "false");
  }
  if (popoverEl) popoverEl.hidden = true;
  inputEl.dataset.providerId = pid || "";
  return mergedInfo;
}

export function closeModelPicker(fieldEl) {
  const popoverEl = fieldEl?.querySelector?.("[data-model-picker-popover='true']");
  const buttonEl = fieldEl?.querySelector?.("[data-model-picker-trigger='true']");
  if (popoverEl) popoverEl.hidden = true;
  if (buttonEl) buttonEl.setAttribute("aria-expanded", "false");
}

export function toggleModelPicker(fieldEl) {
  const popoverEl = fieldEl?.querySelector?.("[data-model-picker-popover='true']");
  const buttonEl = fieldEl?.querySelector?.("[data-model-picker-trigger='true']");
  if (!popoverEl || !buttonEl) return false;
  const next = !!popoverEl.hidden;
  popoverEl.hidden = !next;
  buttonEl.setAttribute("aria-expanded", String(next));
  return next;
}

function escapeAttr(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtmlText(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
