import { ROUTING_ROLES } from "./webviewConstants.js";
import { routingPanelSig } from "./webviewSignatures.js";
import { modelPickerFieldHtml, syncProviderAwareModelPicker } from "./webviewModelPicker.js";

/**
 * Creates routing panel renderer functions that share closure deps
 * from the main panel bundle.
 */
export function createRoutingRenderer(deps, withSig) {
  const { state, escapeHtml, post, mergeModelLists, fillProviderModelCatalogList } = deps;

  function routingDraftFromMission(m) {
    if (!m) return null;
    return {
      missionId: m.id,
      activeProviderId: m.activeProviderId || '',
      activeModel: m.activeModel || '',
      preset: m.routing?.preset || 'default'
    };
  }

  function syncRoutingDraftFromSnapshot(snapshot) {
    const m = snapshot.focusedMission;
    if (!m) {
      state.routingDraft = null;
      return;
    }
    const idChanged = state.routingDraft?.missionId !== m.id;
    if (idChanged) {
      state.routingDraft = routingDraftFromMission(m);
      state.dirty.routingPanel = false;
      return;
    }
    if (!state.dirty.routingPanel) {
      state.routingDraft = routingDraftFromMission(m);
    }
  }

  function fillRoutingModelPicker(snapshot, providerId, inputEl, emptyLabel, ids) {
    if (!inputEl) return;
    inputEl.placeholder = emptyLabel;
    syncProviderAwareModelPicker({
      snapshot,
      providerId,
      inputEl,
      buttonEl: document.getElementById(ids.buttonId),
      popoverEl: document.getElementById(ids.popoverId),
      listEl: document.getElementById(ids.listId),
      emptyEl: document.getElementById(ids.emptyId),
      mergeModelLists,
      fillProviderModelCatalogList
    });
  }

  function resetRoutingModelForProviderChange(inputEl) {
    if (!inputEl) return;
    inputEl.value = '';
  }

  function renderRouting(snapshot, opts = {}) {
    syncRoutingDraftFromSnapshot(snapshot);
    const mount = document.getElementById('routingPanelMount');
    if (!mount) return;
    if (state.dirty.routingPanel && mount.querySelector('#btnSaveMissionRouting')) {
      return;
    }
    const sig = routingPanelSig(snapshot);
    if (!withSig("lastRoutingSig", sig, opts.force)) return;
    const m = snapshot.focusedMission;
    if (!m) {
      mount.innerHTML = '<div class="empty">Focus a mission in the Missions tab to edit per-agent provider/model routing.</div>';
      return;
    }
    const providers = snapshot.providers || [];
    const provOpts = providers.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    const inheritOpt = '<option value="">— Mission default —</option>';
    const roleRows = ROUTING_ROLES.map((role, i) => {
      const p = (m.routing?.providerPerRole?.[role] || '').trim();
      const mod = (m.routing?.modelPerRole?.[role] || '').trim();
      return `<div class="routing-role-block" data-routing-role="${role}">
        <div class="routing-role-title"><strong>${escapeHtml(role)}</strong> <span class="meta">blank = inherit mission default</span></div>
        <div class="routing-role-grid">
          <label class="field-inline"><span>Provider</span><select id="routingProv-${i}">${inheritOpt}${provOpts}</select></label>
          <label class="field-inline"><span>Model</span>${modelPickerFieldHtml({
            inputId: `routingMod-${i}`,
            inputPlaceholder: 'Inherit if empty',
            buttonId: `btnRoutingModelCatalog-${i}`,
            popoverId: `routingModelCatalogPopover-${i}`,
            emptyId: `routingModelCatalogEmpty-${i}`,
            listId: `routingModelCatalogUl-${i}`,
            ariaLabel: `${role} models from provider catalog`,
            emptyText: 'No models in catalog for this provider.',
            scope: 'routingPanel',
            inputValue: mod
          })}</label>
        </div>
      </div>`;
    }).join('');
    const presetOpts = ['default', 'research_heavy', 'local_first', 'review_strict', 'custom']
      .map(p => `<option value="${p}">${escapeHtml(p.replace(/_/g, ' '))}</option>`).join('');
    const d = state.routingDraft;
    const presetVal = d?.preset || m.routing?.preset || 'default';
    mount.innerHTML = `
      <div class="routing-defaults-block">
        <div class="section-title small">Mission-wide default</div>
        <div class="routing-role-grid">
          <label class="field-inline"><span>Provider</span><select id="routingMissionDefProvider">${provOpts}</select></label>
          <label class="field-inline"><span>Model</span>${modelPickerFieldHtml({
            inputId: 'routingMissionDefModel',
            inputPlaceholder: 'Resolved per provider if empty',
            buttonId: 'btnRoutingMissionDefModelCatalog',
            popoverId: 'routingMissionDefModelCatalogPopover',
            emptyId: 'routingMissionDefModelCatalogEmpty',
            listId: 'routingMissionDefModelCatalogUl',
            ariaLabel: 'Mission default models from provider catalog',
            emptyText: 'No models in catalog for this provider.',
            scope: 'routingPanel',
            inputValue: d?.activeModel || m.activeModel || ''
          })}</label>
        </div>
      </div>
      <div class="section-title small" style="margin-top:12px;">Routing preset (applies template to role rows)</div>
      <label class="field-inline"><span>Preset</span><select id="routingPresetSelect">${presetOpts}</select></label>
      <div class="meta" style="margin:6px 0 10px;">Choosing a preset fills role overrides below (not custom). Custom keeps your row edits until you change preset.</div>
      ${roleRows}
      <div class="row wrap compact" style="margin-top:14px;">
        <button type="button" id="btnSaveMissionRouting" class="primary-inline">Save routing</button>
        <button type="button" id="btnRevertMissionRouting" class="ghost">Revert</button>
        <span id="routingDirtyBadge" class="dirty-badge" ${state.dirty.routingPanel ? '' : 'hidden'}>Unsaved</span>
      </div>`;

    const defProv = document.getElementById('routingMissionDefProvider');
    const defMod = document.getElementById('routingMissionDefModel');
    const presetSel = document.getElementById('routingPresetSelect');
    if (defProv) defProv.value = m.activeProviderId || snapshot.defaultProvider;
    if (defMod) defMod.value = d?.activeModel || m.activeModel || '';
    if (presetSel) presetSel.value = presetVal;
    fillRoutingModelPicker(snapshot, defProv?.value || snapshot.defaultProvider, defMod, 'Resolved per provider if empty', {
      buttonId: 'btnRoutingMissionDefModelCatalog',
      popoverId: 'routingMissionDefModelCatalogPopover',
      emptyId: 'routingMissionDefModelCatalogEmpty',
      listId: 'routingMissionDefModelCatalogUl'
    });

    ROUTING_ROLES.forEach((role, i) => {
      const p = (m.routing?.providerPerRole?.[role] || '').trim();
      const mod = (m.routing?.modelPerRole?.[role] || '').trim();
      const ps = document.getElementById(`routingProv-${i}`);
      const mi = document.getElementById(`routingMod-${i}`);
      if (ps) ps.value = p;
      if (mi) mi.value = mod;
      fillRoutingModelPicker(snapshot, p || defProv?.value || snapshot.defaultProvider, mi, 'Inherit if empty', {
        buttonId: `btnRoutingModelCatalog-${i}`,
        popoverId: `routingModelCatalogPopover-${i}`,
        emptyId: `routingModelCatalogEmpty-${i}`,
        listId: `routingModelCatalogUl-${i}`
      });
    });

    const markDirty = () => {
      state.dirty.routingPanel = true;
      const b = document.getElementById('routingDirtyBadge');
      if (b) b.hidden = false;
    };

    const wireRoleRow = (i) => {
      const ps = document.getElementById(`routingProv-${i}`);
      const mi = document.getElementById(`routingMod-${i}`);
      ps?.addEventListener('change', () => {
        resetRoutingModelForProviderChange(mi);
        fillRoutingModelPicker(snapshot, ps.value || defProv?.value || snapshot.defaultProvider, mi, 'Inherit if empty', {
          buttonId: `btnRoutingModelCatalog-${i}`,
          popoverId: `routingModelCatalogPopover-${i}`,
          emptyId: `routingModelCatalogEmpty-${i}`,
          listId: `routingModelCatalogUl-${i}`
        });
        markDirty();
      });
      mi?.addEventListener('change', markDirty);
    };
    ROUTING_ROLES.forEach((_, i) => wireRoleRow(i));

    defProv?.addEventListener('change', () => {
      resetRoutingModelForProviderChange(defMod);
      fillRoutingModelPicker(snapshot, defProv.value, defMod, 'Resolved per provider if empty', {
        buttonId: 'btnRoutingMissionDefModelCatalog',
        popoverId: 'routingMissionDefModelCatalogPopover',
        emptyId: 'routingMissionDefModelCatalogEmpty',
        listId: 'routingMissionDefModelCatalogUl'
      });
      ROUTING_ROLES.forEach((_, i) => {
        const ps = document.getElementById(`routingProv-${i}`);
        const mi = document.getElementById(`routingMod-${i}`);
        fillRoutingModelPicker(snapshot, ps?.value || defProv.value, mi, 'Inherit if empty', {
          buttonId: `btnRoutingModelCatalog-${i}`,
          popoverId: `routingModelCatalogPopover-${i}`,
          emptyId: `routingModelCatalogEmpty-${i}`,
          listId: `routingModelCatalogUl-${i}`
        });
      });
      markDirty();
    });
    defMod?.addEventListener('change', markDirty);

    presetSel?.addEventListener('change', () => {
      const pr = presetSel.value;
      if (pr === 'custom') {
        state.routingDraft = state.routingDraft || routingDraftFromMission(m);
        state.routingDraft.preset = 'custom';
        markDirty();
        return;
      }
      const tmpl = snapshot.routingPresetTemplates?.[pr];
      if (tmpl) {
        ROUTING_ROLES.forEach((role, i) => {
          const ps = document.getElementById(`routingProv-${i}`);
          const mi = document.getElementById(`routingMod-${i}`);
          const pv = tmpl.providerPerRole[role] || '';
          const mv = tmpl.modelPerRole[role] || '';
          if (ps) ps.value = pv;
          if (mi) mi.value = mv;
          fillRoutingModelPicker(snapshot, pv || defProv?.value || snapshot.defaultProvider, mi, 'Inherit if empty', {
            buttonId: `btnRoutingModelCatalog-${i}`,
            popoverId: `routingModelCatalogPopover-${i}`,
            emptyId: `routingModelCatalogEmpty-${i}`,
            listId: `routingModelCatalogUl-${i}`
          });
        });
      }
      state.routingDraft = state.routingDraft || routingDraftFromMission(m);
      state.routingDraft.preset = pr;
      markDirty();
    });

    document.getElementById('btnRevertMissionRouting')?.addEventListener('click', () => {
      state.dirty.routingPanel = false;
      state.routingDraft = routingDraftFromMission(snapshot.focusedMission);
      renderRouting(snapshot);
    });

    document.getElementById('btnSaveMissionRouting')?.addEventListener('click', () => {
      const roles = ROUTING_ROLES.map((role, i) => ({
        role,
        providerId: document.getElementById(`routingProv-${i}`)?.value || '',
        model: document.getElementById(`routingMod-${i}`)?.value || ''
      }));
      post('saveMissionRouting', {
        missionId: m.id,
        activeProviderId: document.getElementById('routingMissionDefProvider')?.value || snapshot.defaultProvider,
        activeModel: document.getElementById('routingMissionDefModel')?.value || '',
        preset: document.getElementById('routingPresetSelect')?.value || 'default',
        roles
      });
    });
  }

  function renderHunkTabs(approval) {
    const hunks = approval?.hunks || [];
    if (!hunks.length) return '<div class="empty">No structured hunks available. Use Open Diff for the native VS Code diff view.</div>';
    const tabs = hunks.map((h, i) => `<button class="hunk-chip ${i === state.selectedHunkIndex ? 'active' : ''}" data-action="selectHunk" data-hunk-index="${i}">${escapeHtml(h.header || `Hunk ${i+1}`)}</button>`).join('');
    const hunk = hunks[Math.min(state.selectedHunkIndex, hunks.length - 1)] || hunks[0];
    return `
      <div class="section-title small">Hunks</div>
      <div class="hunk-tabs">${tabs}</div>
      <pre class="hunk-diff">${(hunk?.beforeLines || []).map(l => `<span class="diff-del">- ${escapeHtml(l)}</span>`).join('\n')}\n${(hunk?.afterLines || []).map(l => `<span class="diff-add">+ ${escapeHtml(l)}</span>`).join('\n')}</pre>`;
  }

  return { routingDraftFromMission, syncRoutingDraftFromSnapshot, renderRouting, renderHunkTabs };
}
