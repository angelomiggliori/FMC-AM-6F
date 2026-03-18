/**
 * engine/gui-adapter.js
 * Atualiza o DOM do theme-headrush baseado nos eventos do motor.
 * Editor de parâmetros usa fx-params.json + CMD_PARAM.
 */

import { state as fsState } from './footswitch.js';
import { patchAtual } from './patch-manager.js';
import { on as onMidiEvent, sendRaw, forceEditOn, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM } from './midi-core.js';
import { fxParamsDb } from './tap-engine.js';

const BANKS_ALL = ['A','B','C','D','E','F','G','H','I','J'];

onMidiEvent('connection', (e) => {
    const mainIndicator = document.getElementById('midiIndicator');
    const mainLabel = document.getElementById('midiPortLabel');
    const barDot = document.getElementById('midiBarDot');
    const barText = document.getElementById('midiBarTexto');
    const barBtn = document.getElementById('midiBarBtn');

    if (e.status === 'connected') {
        if (mainIndicator) mainIndicator.className = 'midi-indicator connected';
        if (mainLabel) mainLabel.textContent = e.portName || 'Conectado';
        
        if (barDot) barDot.className = 'midi-bar-dot conectado';
        if (barText) barText.innerHTML = `Conectado: <strong>${e.portName}</strong>`;
        if (barBtn) {
            barBtn.textContent = 'AGUARDANDO...';
            barBtn.className = 'midi-bar-btn loading';
        }
    } else if (e.status === 'g1on_ready') {
        if (mainIndicator) mainIndicator.className = 'midi-indicator activity';
        if (mainLabel) mainLabel.textContent = 'Zoom G1On Ready';
        
        if (barDot) barDot.className = 'midi-bar-dot g1on';
        if (barText) barText.innerHTML = `Sincronizado com <strong>Zoom G1On</strong>`;
        if (barBtn) {
            barBtn.textContent = 'ONLINE';
            barBtn.className = 'midi-bar-btn g1on';
        }
    } else if (e.status === 'error') {
        if (mainIndicator) mainIndicator.className = 'midi-indicator error';
        if (mainLabel) mainLabel.textContent = 'Erro MIDI';
        
        if (barDot) barDot.className = 'midi-bar-dot erro';
        if (barText) barText.innerHTML = `Erro: <strong>${e.message}</strong>`;
        if (barBtn) {
            barBtn.textContent = 'TENTAR NOVAMENTE';
            barBtn.className = 'midi-bar-btn';
        }
    }
});

window.addEventListener('fmc-dump-received', (e) => {
    const patch = e.detail;
    
    const patchNameEl = document.getElementById('patchName');
    const patchVolEl = document.getElementById('patchVolume');
    const patchIdEl = document.getElementById('patchId');
    
    if (patchNameEl) patchNameEl.textContent = patch.nome || 'UNKNOWN';
    if (patchVolEl) patchVolEl.textContent = patch.volume;
    
    if (patchIdEl) {
        patchIdEl.textContent = BANKS_ALL[fsState.bankIndex] + fsState.patchIndex;
    }
    
    renderChain(patch.efeitos);
});

window.addEventListener('fmc-bpm-update', (e) => {
    const el = document.getElementById('bpmVal');
    if (el) el.textContent = e.detail;
});

window.addEventListener('fmc-ui-render', () => {
    render12FSLayout();
});

function renderChain(efeitos) {
    const cont = document.getElementById('fxIndicators');
    if (!cont) return;
    cont.innerHTML = '';
    
    efeitos.forEach(fx => {
        const div = document.createElement('div');
        div.className = `fx-tag ${fx.cat} ${fx.enabled ? '' : 'off'}`;
        div.textContent = fx.nome;
        
        // Signal Chain: clique ativa debounce single/double no signal-chain.js
        div.onclick = () => window.onFxSlotInteraction('single', fx);

        cont.appendChild(div);
    });
}

function render12FSLayout() {
    const grid = document.getElementById('fsGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) {
        const col = document.createElement('div');
        col.className = 'fs-col';
        
        let labelBtn = '· · ·';
        let sub = '';
        let btnText = `FS${i+1}`;
        
        if (i < 5) {
            labelBtn = `PATCH ${i+1}`;
        } else if (i === 5) {
            labelBtn = 'BANK A-J';
            sub = fsState.bankSelectMode ? 'SELECIONE' : 'HOLD';
        } else if (i >= 6 && i <= 10) {
            labelBtn = `PATCH ${i}`;
        } else if (i === 11) {
            labelBtn = 'TAP TEMPO';
            sub = 'LAYER';
        }
        
        col.innerHTML = `
            <div class="fs-btn ${fsState.bankSelectMode && i===5 ? 'preselect-mode' : ''} ${i===11 ? 'tap-btn' : ''}" 
                 onpointerdown="window.fswDown(${i})" 
                 onpointerup="window.fswUp(${i})"
                 onpointercancel="window.fswUp(${i})">
                 ${btnText}
                 ${sub ? `<span style="font-size:7px;opacity:.6;display:block;margin-top:1px">${sub}</span>` : ''}
            </div>
            <div class="fs-label">${labelBtn}</div>
        `;
        grid.appendChild(col);
    }
}

// ── Fechar Overlay ──
window.fecharEditor = function() {
    const overlay = document.getElementById('editorOverlay');
    if (overlay) overlay.classList.remove('show');
};

// ── Enviar parâmetro via CMD_PARAM ──
function enviarParamEdit(slotIdx, paramIdx, valor) {
    const lo = valor & 0x7F;
    const hi = (valor >> 7) & 0x7F;
    sendRaw([
        0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
        slotIdx, paramIdx, lo, hi, 0xF7
    ], true);
}

/**
 * Busca definição de parâmetros do efeito no fxParamsDb.
 * Tenta lookup por nome (case-insensitive) em todos os entries.
 */
function buscarDefinicaoParams(fx) {
    const nomeLower = (fx.nome || '').toLowerCase();
    for (const [key, def] of Object.entries(fxParamsDb)) {
        if (def.name && def.name.toLowerCase() === nomeLower) {
            return def;
        }
    }
    // Fallback: buscar por categoria e montar params genéricos
    const GENERIC = {
        delay:    [{name:'Time',idx:0,max:4095},{name:'Feedback',idx:1,max:127},{name:'Mix',idx:2,max:150}],
        mod:      [{name:'Rate',idx:0,max:127},{name:'Depth',idx:1,max:15},{name:'Level',idx:2,max:150}],
        reverb:   [{name:'Decay',idx:0,max:127},{name:'Mix',idx:1,max:127},{name:'Level',idx:2,max:150}],
        drive:    [{name:'Gain',idx:0,max:150},{name:'Tone',idx:1,max:15},{name:'Level',idx:2,max:150}],
        amp:      [{name:'Gain',idx:0,max:150},{name:'Tone',idx:1,max:15},{name:'Level',idx:2,max:150}],
        dynamics: [{name:'Sense',idx:0,max:31},{name:'Attack',idx:1,max:15},{name:'Level',idx:2,max:150}],
        filter:   [{name:'Freq',idx:0,max:127},{name:'Reso',idx:1,max:15},{name:'Level',idx:2,max:150}],
    };
    if (GENERIC[fx.cat]) {
        return { name: fx.nome, cat: fx.cat, params: GENERIC[fx.cat] };
    }
    return null;
}

// ── Editor de Parâmetros — abre no duplo-clique de um slot FX ──
window.addEventListener('fmc-fx-edit-open', async (e) => {
    const fx = e.detail;
    const overlay = document.getElementById('editorOverlay');
    const title = document.getElementById('editorTitle');
    const body = document.getElementById('editorBody');
    
    if (!overlay || !title || !body) return;
    
    title.textContent = `${fx.nome} ${fx.enabled ? '🟢' : '🔴'} [Slot ${fx.slot}]`;
    body.innerHTML = '';
    
    // Garante modo editor ativo na G1On
    await forceEditOn();
    
    // Busca params pelo nome do efeito
    const def = buscarDefinicaoParams(fx);
    
    if (!def || !def.params || def.params.length === 0) {
        body.innerHTML = `<div style="color:#ff6b6b;text-align:center;padding:20px;">
            Parâmetros de "${fx.nome}" não encontrados no banco de dados.
        </div>`;
        overlay.classList.add('show');
        return;
    }
    
    def.params.forEach((param) => {
        const pDiv = document.createElement('div');
        pDiv.className = 'param-knob';
        pDiv.style.cssText = 'margin:12px 0;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);';
        
        const maxVal = param.max || 127;
        const startVal = 0; // Leitura real do dump é complexa; começa em 0, slider atualiza em tempo real
        
        pDiv.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span class="param-name" style="font-size:12px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">${param.name}</span>
                <span class="param-val" style="font-size:14px;font-weight:bold;color:#fff;min-width:40px;text-align:right;">—</span>
            </div>
            <input type="range" class="param-slider" 
                   min="0" max="${maxVal}" value="${startVal}" 
                   style="width:100%;cursor:pointer;accent-color:#00d4ff;">
            <div style="display:flex;justify-content:space-between;font-size:9px;color:#555;margin-top:2px;">
                <span>0</span><span>${maxVal}</span>
            </div>
        `;
        
        const slider = pDiv.querySelector('input');
        const valDisplay = pDiv.querySelector('.param-val');
        
        slider.addEventListener('input', () => {
            const newVal = parseInt(slider.value, 10);
            valDisplay.textContent = newVal;
            enviarParamEdit(fx.slotIdx, param.idx, newVal);
        });
        
        body.appendChild(pDiv);
    });
    
    overlay.classList.add('show');
});

// ── Listener para fmc-param-changed (de signal-chain ou outros módulos) ──
window.addEventListener('fmc-param-changed', (e) => {
    const { slotIdx, paramIdx, value } = e.detail;
    enviarParamEdit(slotIdx, paramIdx, value);
});

function initGuiAdapter() {
    render12FSLayout();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGuiAdapter);
} else {
    initGuiAdapter();
}
