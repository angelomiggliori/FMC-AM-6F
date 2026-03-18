/**
 * engine/led-engine.js
 * Controle físico para Neopixels via Web Serial ou futuro bridge.
 * [Stub na versão Browser]
 */

export function atualizarLeds(estado) {
    // Exemplo: { activePatch, bankSelectMode, bankId }
    // Envia cores da bank/patch pros LEDs
    // console.log('[LED ENGINE]', estado);
}

window.addEventListener('fmc-ui-render', (e) => {
    // Repassa pra hardware se existir
    atualizarLeds(e.detail);
});
