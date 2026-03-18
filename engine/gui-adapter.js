/**
 * engine/gui-adapter.js
 * Atualiza o DOM do theme-headrush baseado nos eventos do motor.
 */

import { state as fsState } from './footswitch.js';
import { patchAtual } from './patch-manager.js';
import { on as onMidiEvent } from './midi-core.js';

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
        
        // Signal Chain interaction binding
        div.onclick = () => window.onFxSlotInteraction('single', fx);
        div.ondblclick = () => window.onFxSlotInteraction('double', fx);

        cont.appendChild(div);
    });
}

function render12FSLayout() {
    const grid = document.getElementById('fsGrid');
    if (!grid) return;
    
    // Reconstroi 12 footswitches no layout fiel do V4.2
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

// Global functions for the HTML buttons
window.fecharEditor = function() {
    const overlay = document.getElementById('editorOverlay');
    if (overlay) overlay.classList.remove('show');
};

window.addEventListener('fmc-fx-edit-open', async (e) => {
    const fx = e.detail;
    const overlay = document.getElementById('editorOverlay');
    const title = document.getElementById('editorTitle');
    const body = document.getElementById('editorBody');
    
    if (!overlay || !title || !body) return;
    
    title.textContent = fx.nome;
    body.innerHTML = ''; // Start clean
    
    // Retrieve actual parameter definitions for this effect from the remote DB
    const { GitHubDB } = await import('../data/data-manager.js');
    const fxParams = await GitHubDB.read('fx-params.json') || {};
    
    const hexId = '0x' + fx.id.toString(16).toUpperCase().padStart(4, '0');
    const definition = fxParams[hexId];
    
    if (definition && definition.params) {
        definition.params.forEach((paramName, i) => {
            // Parâmetros começam no byte 6 do rawSlot e ocupam 2 bytes em formato 14-bit (Lo, Hi)
            const pLo = fx.rawSlot[6 + (i * 2)] || 0; 
            const pHi = fx.rawSlot[7 + (i * 2)] || 0;
            const rawVal = (pLo & 0x7F) | ((pHi & 0x7F) << 7);
            
            // Ajusta o slider max limit dependendo do nome do parâmetro
            let maxVal = 127;
            const pName = paramName.toLowerCase();
            if (pName === 'time') maxVal = 3999;
            else if (rawVal > 127) maxVal = 16383; // Previne que valores lidos quebrem o slider genérico
            
            const pDiv = document.createElement('div');
            pDiv.className = 'param-knob';
            
            pDiv.innerHTML = `
                <div class="param-name">${paramName}</div>
                <div class="param-val" id="pval-${i}">${rawVal}</div>
                <input type="range" class="param-slider" id="pslider-${i}" min="0" max="${maxVal}" value="${rawVal}" style="width:100%; margin-top:10px; cursor:pointer;">
            `;
            
            const slider = pDiv.querySelector('input');
            const valDisplay = pDiv.querySelector('.param-val');
            
            slider.addEventListener('input', (event) => {
                const newVal = parseInt(event.target.value, 10);
                valDisplay.textContent = newVal;
                
                // Dispara evento para o signal-chain/midi-core processar e emitir via SysEx
                window.dispatchEvent(new CustomEvent('fmc-param-changed', {
                    detail: {
                        slotIdx: fx.slotIdx,
                        paramIdx: i + 1, // Offset +1: no SysEx CMD_PARAM, param 1 é o primeiro param
                        value: newVal
                    }
                }));
            });
            
            body.appendChild(pDiv);
        });
    } else {
         body.innerHTML = `<div style="color:red; font-size:12px;">Parâmetros indisponíveis.</div>`;
    }
    
    overlay.classList.add('show');
});

function initGuiAdapter() {
    render12FSLayout();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGuiAdapter);
} else {
    initGuiAdapter();
}
