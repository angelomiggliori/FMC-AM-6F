/**
 * data/default_patches.js
 * Patches de fábrica padrão para inicialização do editor.
 * Usado quando não há dados salvos no LittleFS/localStorage.
 *
 * Cada patch:
 *   slot    : posição no banco (0–99)
 *   name    : nome do patch (máx 10 chars)
 *   effects : array de até 5 efeitos, cada um:
 *               { name, on, params[] }
 *             params[] = array de valores 0–127 (um por parâmetro do efeito)
 */

export const DEFAULT_PATCHES = [
  {
    slot: 0,
    name: 'CLEAN BOOST',
    effects: [
      { name: 'GrayComp',  on: true,  params: [80, 100] },
      { name: 'Booster',   on: true,  params: [30, 60, 90] },
      { name: 'Chorus',    on: false, params: [50, 40, 64, 80] },
      { name: 'Hall',      on: true,  params: [60, 64, 30, 80, 0] },
      { name: 'Delay',     on: false, params: [50, 40, 60, 0] },
    ],
  },
  {
    slot: 1,
    name: 'CRUNCH',
    effects: [
      { name: 'Comp',      on: true,  params: [70, 64, 90, 50, 64] },
      { name: 'OverDrive', on: true,  params: [65, 70, 90] },
      { name: 'Phaser',    on: false, params: [50, 64, 80, 0, 64] },
      { name: 'Room',      on: true,  params: [45, 64, 20, 75, 0] },
      { name: 'Delay',     on: true,  params: [60, 40, 55, 0] },
    ],
  },
  {
    slot: 2,
    name: 'LEAD DIST',
    effects: [
      { name: 'Comp',      on: true,  params: [90, 64, 90, 40, 64] },
      { name: 'Dist 1',    on: true,  params: [90, 55, 85] },
      { name: 'Chorus',    on: true,  params: [40, 55, 64, 75] },
      { name: 'Hall',      on: true,  params: [55, 60, 25, 80, 0] },
      { name: 'Delay',     on: true,  params: [65, 45, 50, 0] },
    ],
  },
  {
    slot: 3,
    name: 'METAL ZONE',
    effects: [
      { name: 'Comp',      on: false, params: [64, 64, 64, 64, 64] },
      { name: 'MetalWRLD', on: true,  params: [100, 50, 85] },
      { name: 'Flanger',   on: false, params: [50, 45, 40, 30, 80] },
      { name: 'Hall',      on: true,  params: [40, 55, 15, 70, 0] },
      { name: 'Delay',     on: false, params: [55, 40, 45, 0] },
    ],
  },
  {
    slot: 4,
    name: 'CLEAN JAZZ',
    effects: [
      { name: 'GrayComp',  on: true,  params: [60, 90] },
      { name: 'Booster',   on: false, params: [20, 55, 80] },
      { name: 'Chorus',    on: true,  params: [35, 38, 60, 85] },
      { name: 'Spring',    on: true,  params: [50, 64, 15, 80, 0] },
      { name: 'TapeEcho',  on: false, params: [55, 40, 50, 0] },
    ],
  },
  {
    slot: 5,
    name: 'SHOEGAZE',
    effects: [
      { name: 'Comp',      on: true,  params: [80, 64, 80, 60, 64] },
      { name: 'OverDrive', on: true,  params: [55, 60, 85] },
      { name: 'Chorus',    on: true,  params: [80, 50, 64, 90] },
      { name: 'ShimmerRv', on: true,  params: [30, 100, 40, 60, 0] },
      { name: 'Delay',     on: true,  params: [70, 50, 65, 0] },
    ],
  },
  {
    slot: 6,
    name: 'FUNK WAH',
    effects: [
      { name: 'AutoWah',   on: true,  params: [85, 70, 80] },
      { name: 'Comp',      on: true,  params: [75, 64, 85, 40, 64] },
      { name: 'Chorus',    on: false, params: [40, 45, 64, 80] },
      { name: 'Room',      on: true,  params: [35, 64, 10, 75, 0] },
      { name: 'Delay',     on: false, params: [50, 40, 50, 0] },
    ],
  },
  {
    slot: 7,
    name: 'AMBIENT PAD',
    effects: [
      { name: 'SlowATTCK', on: true,  params: [80, 64, 90] },
      { name: 'Detune',    on: true,  params: [20, 30, 64, 80] },
      { name: 'Chorus',    on: true,  params: [70, 40, 64, 90] },
      { name: 'ShimmerRv', on: true,  params: [50, 110, 50, 70, 0] },
      { name: 'Delay',     on: true,  params: [80, 60, 70, 127] },
    ],
  },
];

/**
 * Gera um patch vazio com nome genérico para um dado slot.
 * @param {number} slot
 * @returns {Object} patch object
 */
export function createEmptyPatch(slot) {
  return {
    slot,
    name: 'INIT' + String(slot).padStart(2, '0'),
    effects: [null, null, null, null, null],
    dirty: false,
  };
}

/**
 * Gera array completo de 100 patches (8 defaults + 92 vazios).
 * @returns {Object[]}
 */
export function buildInitialPatchBank() {
  const bank = [];
  for (let i = 0; i < 100; i++) {
    if (i < DEFAULT_PATCHES.length) {
      bank.push({ ...DEFAULT_PATCHES[i], dirty: false });
    } else {
      bank.push(createEmptyPatch(i));
    }
  }
  return bank;
}
