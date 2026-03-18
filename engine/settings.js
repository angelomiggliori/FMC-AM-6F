/**
 * engine/settings.js
 * Menus e preferências
 */

import { LocalDB } from '../data/data-manager.js';

export async function saveToken(token) {
    localStorage.setItem('fmc-github-token', token);
}

window.abrirConfiguracoes = function() {
    // Dispatch ui event to native theme 
    window.dispatchEvent(new CustomEvent('fmc-settings-open'));
}
