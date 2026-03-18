/**
 * engine/main.js
 * Ponto de entrada modular.
 */

import { connectMIDI } from './midi-core.js';
import { changePatch, loadFxDb } from './patch-manager.js';
import { fswDown, fswUp } from './footswitch.js';
import { loadFxParamsDb } from './tap-engine.js';
import { boostAtivo } from './boost.js';
import { tunerActive } from './tuner.js';
import './signal-chain.js';
import './led-engine.js';
import './settings.js';
import './gui-adapter.js';
import { LocalDB, GitHubDB } from '../data/data-manager.js';

async function bootEngine() {
    console.log('[FMC-AM 6F] Booting Modular Engine...');
    
    // Carrega dados base (em background idealmente cruzando)
    const db = await GitHubDB.read('fx-db.json') || {};
    loadFxDb(db);
    
    const paramsDb = await GitHubDB.read('fx-params.json') || {};
    loadFxParamsDb(paramsDb);

    // Initial hook to patch load if from stored state
    // ...
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootEngine);
} else {
    bootEngine();
}
