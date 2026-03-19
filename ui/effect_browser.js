/**
 * ui/effect_browser.js
 * Modal de seleção de efeitos com busca e filtro por categoria
 */

import { state }       from '../engine/state_manager.js';
import { FX_CATALOG, CATEGORIES } from '../data/effects_catalog.js';
import { notify }      from './notifications.js';

let _targetSlot = null;
let _activecat  = 'Todos';

// ── Init ──────────────────────────────────────────────────────────────────────

export function initEffectBrowser() {
  _buildCatFilters();
  _filterAndRender();

  document.getElementById('effectSearch')
    ?.addEventListener('input', () => _filterAndRender());

  // Fechar ao clicar no overlay
  document.getElementById('modalOverlay')
    ?.addEventListener('click', function(e) {
      if (e.target === this) closeBrowser();
    });
}

// ── Open / Close ──────────────────────────────────────────────────────────────

/**
 * Abre o browser de efeitos para um slot específico.
 * @param {number} slotIndex
 */
export function openBrowser(slotIndex) {
  _targetSlot = slotIndex;
  _activecat  = 'Todos';

  // Reset busca e filtros
  const searchEl = document.getElementById('effectSearch');
  if (searchEl) searchEl.value = '';
  _buildCatFilters();
  _filterAndRender();

  document.getElementById('modalOverlay')?.classList.add('open');
  searchEl?.focus();
}

export function closeBrowser() {
  document.getElementById('modalOverlay')?.classList.remove('open');
  _targetSlot = null;
}

// ── Category Filters ──────────────────────────────────────────────────────────

function _buildCatFilters() {
  const el = document.getElementById('catFilters');
  if (!el) return;

  const allCats = ['Todos', ...CATEGORIES];
  el.innerHTML  = allCats.map(cat =>
    `<button class="cat-filter-btn ${cat === _activecat ? 'active' : ''}"
       onclick="window._ui.setBrowserCat('${cat}')">${cat}</button>`
  ).join('');
}

export function setCat(cat) {
  _activecat = cat;
  _buildCatFilters();
  _filterAndRender();
}

// ── Filter & Render ───────────────────────────────────────────────────────────

function _filterAndRender() {
  const browser = document.getElementById('effectBrowser');
  if (!browser) return;

  const q = (document.getElementById('effectSearch')?.value || '').toLowerCase();

  const entries = Object.entries(FX_CATALOG).filter(([name, def]) => {
    const catOk = _activecat === 'Todos' || def.category === _activecat;
    const qOk   = !q
      || name.toLowerCase().includes(q)
      || def.category.toLowerCase().includes(q)
      || def.params.some(p => p.toLowerCase().includes(q));
    return catOk && qOk;
  });

  if (entries.length === 0) {
    browser.innerHTML = `
      <div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text3);font-family:var(--mono);font-size:12px">
        NENHUM EFEITO ENCONTRADO
      </div>`;
    return;
  }

  browser.innerHTML = entries.map(([name, def]) => {
    const cc      = _catClass(def.category);
    const tapMark = def.tap
      ? `<span style="color:var(--accent4);font-size:9px;margin-left:4px">TAP</span>` : '';
    const params  = def.params.slice(0, 5).join(' · ') || '—';

    return `
    <div class="effect-card" onclick="window._ui.pickEffect('${name.replace(/'/g, "\\'")}')">
      <div class="effect-card-name">
        <span class="fx-cat-badge ${cc}" style="font-size:8px;margin-right:5px">${def.category}</span>
        ${name}${tapMark}
      </div>
      <div class="effect-card-params">${params}</div>
    </div>`;
  }).join('');
}

// ── Pick Effect ───────────────────────────────────────────────────────────────

export function pickEffect(name) {
  if (_targetSlot === null) return;
  state.addEffect(_targetSlot, name);
  state.selectSlot(_targetSlot);
  closeBrowser();
  notify(`${name} adicionado ao slot ${_targetSlot + 1}`, 'ok');
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function _catClass(cat) {
  const map = {
    Drive:'cat-drive', Amp:'cat-amp', Modulation:'cat-modulation',
    Delay:'cat-delay', Reverb:'cat-reverb', Dynamics:'cat-dynamics',
    'Filter/Wah':'cat-filter', 'Pitch/Synth':'cat-pitch',
    'EQ/Utility':'cat-eq', Other:'cat-other',
  };
  return map[cat] || 'cat-other';
}
