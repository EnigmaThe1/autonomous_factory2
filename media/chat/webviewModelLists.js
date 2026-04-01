export function mergeModelLists(snapshot, pid) {
  const live = snapshot.providerLiveModelCatalog?.[pid];
  const presets = snapshot.providerModelPresets?.[pid] || [];
  const liveFull = live?.models?.length ? live.models : [];
  const livePicker = live?.modelsDisplay?.length ? live.modelsDisplay : liveFull;
  const merged = [...new Set([...livePicker, ...presets])];
  let sourceLabel = "Preset suggestions";
  if (live?.source === "live") sourceLabel = "Live (API)";
  else if (live?.source === "cache") sourceLabel = "Saved catalog (disk)";
  else if (live?.source === "environment") sourceLabel = "Environment (VS Code LM)";
  else if (live?.source === "fallback") sourceLabel = "Curated fallback";
  else if (live?.source === "unavailable") sourceLabel = liveFull.length || livePicker.length ? "Partial list" : "Unavailable";
  return {
    merged,
    sourceLabel,
    hint: live?.hint,
    at: live?.at,
    catalogTotal: liveFull.length,
    pickerShortlistLen: live?.modelsDisplay?.length ?? 0
  };
}

/**
 * Populate a themed native select with model ids (live + presets). Preserves a value not in the list as
 * a final "(custom)" option so free-form ids stay representable.
 * @param {HTMLSelectElement | null | undefined} selectEl
 * @param {string[]} modelIds
 * @param {{ preserveValue?: string, emptyLabel?: string }} [opts]
 */
export function fillModelSelect(selectEl, modelIds, opts) {
  if (!selectEl || selectEl.tagName !== "SELECT") return;
  const { preserveValue = "", emptyLabel = "—" } = opts || {};
  const cur = (preserveValue || "").trim();
  const seen = new Set();
  const ordered = [];
  for (const id of modelIds) {
    const t = (id || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);
  }
  selectEl.textContent = "";
  const optEmpty = document.createElement("option");
  optEmpty.value = "";
  optEmpty.textContent = emptyLabel;
  selectEl.appendChild(optEmpty);
  for (const id of ordered) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    selectEl.appendChild(o);
  }
  if (cur && !seen.has(cur)) {
    const o = document.createElement("option");
    o.value = cur;
    o.textContent = `${cur} (custom)`;
    selectEl.appendChild(o);
  }
  selectEl.value = cur || "";
}

/**
 * Providers tab only: fill a themed scrollable list instead of native select (webview select popups are unreliable).
 * @param {HTMLUListElement | null | undefined} ulEl
 * @param {HTMLElement | null | undefined} emptyEl shown when there are zero model ids
 * @param {string[]} modelIds merged live + presets
 */
export function fillProviderModelCatalogList(ulEl, emptyEl, modelIds) {
  if (!ulEl) return;
  const seen = new Set();
  const ordered = [];
  for (const id of modelIds) {
    const t = (id || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);
  }
  if (emptyEl) {
    emptyEl.hidden = ordered.length > 0;
  }
  ulEl.textContent = "";
  for (const id of ordered) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-catalog-item";
    btn.setAttribute("role", "option");
    btn.dataset.model = id;
    btn.textContent = id;
    li.appendChild(btn);
    ulEl.appendChild(li);
  }
}
