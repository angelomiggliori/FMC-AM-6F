// FMC-AM 6F · Motor v5.0 — fmc-engine.js — build: v5.0-b20260317-prime
// Este arquivo é o motor completo. Os temas carregam via <script src='fmc-engine.js'>
// NÃO edite os temas para lógica MIDI — edite apenas este arquivo.
//
// DUAL-MODE FS:
//   Tema define THEME_FS antes de carregar o engine:
//     const THEME_FS = 6;   → modo 6 FS (layout 3×2, comportamento original)
//     const THEME_FS = 12;  → modo 12 FS (layout 6×2, HeadRush Prime)
//   Se THEME_FS não for definido, usa 6 FS por padrão.
//
//   Modo 6 FS: FS1-5 = patches, FS6 = tap/bank
//   Modo 12 FS: FS1-10 = patches 0-9, FS11 = bank(press)/tuner(hold), FS12 = tap
//
// SEED: dados reais do full dump da G1On fw 1.21 (100 patches)
// ══════════════════════════════════════════════════════════════════
// Model ID: 0x63 (confirmado via Identity Response fw 1.21)
// BPM encoding: lsb=bpm&0x7F, msb=(bpm>>7)&0x7F (sem offset)
// Nome patch: 7-bit SysEx packing, offset 112, 21 bytes
// ══════════════════════════════════════════════════════════════════

'use strict';

// ── Dual-mode FS detection ─────────────────────────────────────
// Tema define const THEME_FS = 6 | 12 antes de <script src="fmc-engine.js">
// Default: 6 FS (compatibilidade total com temas existentes)
const FS_MODE  = (typeof THEME_FS === 'number' && THEME_FS === 12) ? 12 : 6;
const FS_COUNT = FS_MODE; // alias legível
// Índices dos FS especiais — variam conforme o modo
// Layout 12 FS:
//   [FS1][FS2][FS3][FS4][FS5][BANK]    idx 0-4=patches 0-4,  idx 5=BANK press/nada hold
//   [FS7][FS8][FS9][FS10][FS11][TAP]   idx 6-10=patches 5-9, idx 11=TAP press/TUNER hold
const FS_IDX_TAP  = FS_MODE === 12 ? 11 : 5;   // FS12 (idx 11) TAP press / TUNER hold
const FS_IDX_BANK = FS_MODE === 12 ?  5 : 5;   // FS6  (idx  5) BANK press / nada hold
const FS_IDX_TUNER= FS_MODE === 12 ? 11 : 2;   // hold no TAP (modo 12) / hold no FS3 (modo 6)

// ── Constantes operacionais ────────────────────────────────────
const DEBOUNCE_MS   = 30;
const HOLD_MS       = 900;
const TAP_AVG_N     = 4;
const TAP_TIMEOUT   = 2000;
const BPM_MIN       = 40;
const BPM_MAX       = 250;
const SYSEX_IDLE_MS = 50;    // dispara 50ms após último toque — resposta imediata
const SYSEX_DELAY   = 80;   // 80ms entre mensagens SysEx (mais seguro)
const PC_TO_DUMP_MS = 500;  // respiração após PC
const MEM_CHECK_MS  = 5000;
const MIDI_CH       = 0;

// ── Constantes Zoom G1On (confirmadas) ─────────────────────────
const ZOOM_MFR    = 0x52;
const ZOOM_DEV    = 0x00;
const ZOOM_MODEL  = 0x63;  // ← confirmado via Identity Response (fw 1.21)
const CMD_EDIT_ON  = 0x50;
const CMD_EDIT_OFF = 0x51;
const CMD_DUMP_REQ = 0x29;
const CMD_DUMP_RES = 0x28;
const CMD_PARAM    = 0x31;

// ── Banks e cores ───────────────────────────────────────────────
const BANKS_ALL = ['A','B','C','D','E','F','G','H','I','J'];
const BANK_COLOR = {
  A:'#00ff66',B:'#ffaa00',C:'#ff0000',D:'#00ffff',E:'#ffffff',
  F:'#00ff66',G:'#ffaa00',H:'#ff0000',I:'#00ffff',J:'#ffffff',
};
const PATCH_NAMES = {
  A:['CLEAN BOOST','TUBE DRIVE','OCTO VERB','SHIMMER PAD','TAPE ECHO','HEAVY GATE','DUAL CHORUS','POLY DETUNE','PITCH SHIFT','DIRT BOX'],
  B:['BLUES JR','TWEED 4X10','AC SPANK','VOX CLEAN','BRIT CRUNCH','PLEXI ROAR','MESA TIGHT','SOLDANO HI','FRIEDMAN BE','BOGNER ECST'],
  C:['SMALL ROOM','LARGE HALL','PLATE VERB','SPRING TANK','SHIMMER 1','SHIMMER 2','CAVE ECHO','MOD DELAY','TAPE SLAP','PING PONG'],
  D:['WAH CRYBABY','OCTAVE FUZ','RING MOD','TREMOLO','VIBRATO','PHASER 4ST','FLANGER JET','CHORUS 2V','ROTARY','UNIVIBE'],
  E:['LOOPER 1','LOOPER 2','PHRASE 1','PHRASE 2','MIDI CLK','SYNC BEAT','POLY LOOP','HALF SPEED','REVERSE','REBUILD'],
};
for(const b of ['F','G','H','I','J'])
  PATCH_NAMES[b] = PATCH_NAMES[BANKS_ALL[BANKS_ALL.indexOf(b)-5]].map(n=>n+' II');

// ── Banco de efeitos (fonte: tabela Angelo + ZoomGuitarLab) ─────
// IDs confirmados pelos dumps reais da G1On fw 1.21
// ID = (raw[0]<<7)|raw[1]  ← 2 bytes
// ══════════════════════════════════════════════════════════════════
// ZOOM_FX_DB — IDs de 3 bytes: id3 = (raw[0]<<14)|(raw[1]<<7)|raw[2]
// Confirmados por engenharia reversa dos dumps reais fw 1.21 + ZDL
// Zero conflitos nos 45 efeitos mapeados
// ══════════════════════════════════════════════════════════════════
const ZOOM_FX_DB = {
  // ══════════════════════════════════════════════════════════════════
  // Fonte primária: dump3 (100 patches nome=efeito, fw 1.21)
  // Fonte secundária: dump profundo E0-E9 + dump J0
  // id2 = (raw[0]<<7)|raw[1]  |  raw[2] = byte MSBs params
  // IDs com ⚠ são compartilhados → discriminados por raw[2] no SHARED
  // ══════════════════════════════════════════════════════════════════
  // ── Dynamics / Filter ────────────────────────────────────────────
  0x0101:({n:'Comp',      c:'dynamics', t:null}),
  0x0105:({n:'SlowAtck',  c:'dynamics', t:null}),
  0x0109:({n:'160Comp',   c:'dynamics', t:null}),
  0x0200:({n:'Exciter',   c:'filter',   t:null}),
  0x0201:({n:'Cry',       c:'filter',   t:null}),
  0x0202:({n:'ParaEQ',    c:'filter',   t:null}),
  0x0203:({n:'GraphicEQ', c:'filter',   t:null}),
  0x0004:({n:'ZNR',       c:'dynamics', t:null}),
  0x0008:({n:'GraphicEQ', c:'filter',   t:null}),
  0x0208:({n:'RndmFltr',  c:'filter',   t:null}),
  0x020E:({n:'MFilter',   c:'filter',   t:null}),
  0x020F:({n:'StepFltr',  c:'filter',   t:null}),
  0x2101:({n:'OptComp',   c:'dynamics', t:null}),
  0x2102:({n:'ZNR',       c:'dynamics', t:null}),
  0x2204:({n:'AutoWah',   c:'filter',   t:null}),
  // ── Drive ────────────────────────────────────────────────────────
  0x030A:({n:'Squeak',    c:'drive',    t:null}),
  0x030F:({n:'Drive',     c:'drive',    t:null}),
  0x0311:({n:'Fuzz',      c:'drive',    t:null}),
  0x0314:({n:'Amp',       c:'amp',      t:null}),
  // ── Amp Sims ─────────────────────────────────────────────────────
  0x0406:({n:'FDCombo',   c:'amp',      t:null}),
  0x0407:({n:'Matchless', c:'amp',      t:null}),
  0x040C:({n:'VXJimi',    c:'amp',      t:null}),
  0x040D:({n:'HWStar',    c:'amp',      t:null}),
  0x040E:({n:'MS1959',   c:'amp',      t:null}),
  0x040F:({n:'ALIEN',     c:'amp',      t:null}),
  0x0410:({n:'REVO1',     c:'amp',      t:null}),
  0x0411:({n:'Tangerine', c:'amp',      t:null}),
  0x0412:({n:'MSCrunch',  c:'amp',      t:null}),
  0x0413:({n:'ToneCycle', c:'amp',      t:null}),
  0x0414:({n:'MSDrive',   c:'amp',      t:null}),
  0x0415:({n:'BGNDrive',  c:'amp',      t:null}),
  0x2407:({n:'DeluxeR',   c:'amp',      t:null}),
  0x240B:({n:'DZDrive',   c:'amp',      t:null}),
  0x240C:({n:'CARDrive',  c:'amp',      t:null}),
  0x240D:({n:'TWRock',    c:'amp',      t:null}),
  0x240E:({n:'USBlues',  c:'amp',      t:null}),
  0x240F:({n:'BlackBrth', c:'amp',      t:null}),
  // ── Pitch ────────────────────────────────────────────────────────
  0x0601:({n:'HPS',       c:'pitch',    t:null}),
  0x0600:({n:'MonoPitch', c:'pitch',    t:null}),
  0x2604:({n:'PitchSHFT', c:'pitch',   t:null}),
  0x2608:({n:'Detune',    c:'pitch',    t:null}),
  // ── Modulation / Rate ────────────────────────────────────────────
  0x060B:({n:'DuoPhase',  c:'mod',      t:'Rate'}),
  0x060C:({n:'SuperCho',  c:'mod',      t:'Rate'}),
  0x070C:({n:'RtCloset',  c:'special',  t:null}),
  0x0711:({n:'Z-Organ',   c:'special',  t:null}),
  0x2201:({n:'fCycle',    c:'mod',      t:'Rate'}),
  0x2602:({n:'Phaser',    c:'mod',      t:'Rate'}),
  0x260B:({n:'VinFLNGR',   c:'mod',      t:'Rate'}),
  0x2700:({n:'Bomber',    c:'special',  t:null}),
  0x2701:({n:'BitCrush',  c:'special',  t:null}),
  // IDs compartilhados mod (raw[2] discrimina via SHARED no parser)
  0x060A:({n:'Chorus',    c:'mod',      t:'Rate'}),
  0x0614:({n:'Tremolo',   c:'mod',      t:'Rate'}),
  0x2606:({n:'RingMod',   c:'mod',      t:'Rate'}),
  // ── Delay / Time ─────────────────────────────────────────────────
  0x0807:({n:'StompDly',  c:'delay',    t:'Time'}),
  0x0829:({n:'StereoDly', c:'delay',    t:'Time'}),
  0x0052:({n:'TapeEcho',  c:'delay',    t:'Time'}),
  0x0877:({n:'ReverseDL', c:'delay',    t:'Time'}),
  0x1880:({n:'TapeEcho',  c:'delay',    t:'Time'}),
  0x1C00:({n:'Delay',     c:'delay',    t:'Time'}),
  0x280B:({n:'Delay',     c:'delay',    t:'Time'}),
  0x2816:({n:'PitchDly',  c:'delay',    t:'Time'}),
  0x2860:({n:'CarbonDly', c:'delay',    t:'Time'}),
  0x286D:({n:'MultiTapD', c:'delay',    t:'Time'}),
  0x287C:({n:'FilterDly', c:'delay',    t:'Time'}),
  // ── Reverb ───────────────────────────────────────────────────────
  0x0902:({n:'Plate',     c:'reverb',   t:null}),
  0x0909:({n:'ModReverb', c:'reverb',   t:'Rate'}),
  0x090A:({n:'ParticleR', c:'reverb',   t:null}),
  0x0914:({n:'HDHall',    c:'reverb',   t:null}),
  0x2908:({n:'Spring63',  c:'reverb',   t:null}),

  // ── IDs descobertos no dump7 (presets de fábrica) — mapeados por família ──
  // Família 0x01xx / 0x21xx → dynamics
  0x0100:({n:'Dyn00',  c:'dynamics', t:null}),
  0x0102:({n:'Dyn02',  c:'dynamics', t:null}),
  0x0103:({n:'Dyn03',  c:'dynamics', t:null}),
  0x0106:({n:'Dyn06',  c:'dynamics', t:null}),
  0x0107:({n:'Dyn07',  c:'dynamics', t:null}),
  0x0108:({n:'Dyn08',  c:'dynamics', t:null}),
  0x010A:({n:'Dyn0A',  c:'dynamics', t:null}),
  0x010B:({n:'Dyn0B',  c:'dynamics', t:null}),
  0x010D:({n:'Dyn0D',  c:'dynamics', t:null}),
  0x2100:({n:'Dyn00b', c:'dynamics', t:null}),
  0x2105:({n:'Dyn05b', c:'dynamics', t:null}),
  0x2106:({n:'Dyn06b', c:'dynamics', t:null}),
  0x2108:({n:'Dyn08b', c:'dynamics', t:null}),
  0x2109:({n:'Dyn09b', c:'dynamics', t:null}),
  0x210A:({n:'Dyn0Ab', c:'dynamics', t:null}),
  0x210C:({n:'Dyn0Cb', c:'dynamics', t:null}),
  // Família 0x02xx / 0x22xx → filter
  0x0204:({n:'Flt04',  c:'filter',   t:null}),
  0x2200:({n:'Flt00b', c:'filter',   t:null}),
  0x2202:({n:'Flt02b', c:'filter',   t:null}),
  0x2203:({n:'Flt03b', c:'filter',   t:null}),
  0x2206:({n:'Flt06b', c:'filter',   t:null}),
  // Família 0x03xx / 0x23xx → drive
  0x0300:({n:'Drv00',  c:'drive',    t:null}),
  0x0301:({n:'Drv01',  c:'drive',    t:null}),
  0x0302:({n:'Drv02',  c:'drive',    t:null}),
  0x0303:({n:'Drv03',  c:'drive',    t:null}),
  0x0304:({n:'Drv04',  c:'drive',    t:null}),
  0x0305:({n:'Drv05',  c:'drive',    t:null}),
  0x0306:({n:'Drv06',  c:'drive',    t:null}),
  0x0309:({n:'Drv09',  c:'drive',    t:null}),
  0x030C:({n:'Drv0C',  c:'drive',    t:null}),
  0x0317:({n:'Drv17',  c:'drive',    t:null}),
  0x2301:({n:'Drv01b', c:'drive',    t:null}),
  0x2303:({n:'Drv03b', c:'drive',    t:null}),
  0x2309:({n:'Drv09b', c:'drive',    t:null}),
  0x230F:({n:'Drv0Fb', c:'drive',    t:null}),
  0x2310:({n:'Drv10b', c:'drive',    t:null}),
  0x2314:({n:'Drv14b', c:'drive',    t:null}),
  0x2317:({n:'Drv17b', c:'drive',    t:null}),
  0x2318:({n:'Drv18b', c:'drive',    t:null}),
  // Família 0x04xx / 0x24xx → amp
  0x0400:({n:'Amp00',  c:'amp',      t:null}),
  0x0404:({n:'Amp04',  c:'amp',      t:null}),
  0x0405:({n:'Amp05',  c:'amp',      t:null}),
  0x0408:({n:'Amp08',  c:'amp',      t:null}),
  0x0409:({n:'Amp09',  c:'amp',      t:null}),
  0x040A:({n:'Amp0A',  c:'amp',      t:null}),
  0x040B:({n:'Amp0B',  c:'amp',      t:null}),
  0x2404:({n:'Amp04b', c:'amp',      t:null}),
  0x2405:({n:'Amp05b', c:'amp',      t:null}),
  0x2406:({n:'Amp06b', c:'amp',      t:null}),
  0x2409:({n:'Amp09b', c:'amp',      t:null}),
  0x240A:({n:'Amp0Ab', c:'amp',      t:null}),
  0x2411:({n:'Amp11b', c:'amp',      t:null}),
  0x2412:({n:'Amp12b', c:'amp',      t:null}),
  0x2413:({n:'Amp13b', c:'amp',      t:null}),
  0x2416:({n:'Amp16b', c:'amp',      t:null}),
  // Família 0x06xx / 0x26xx → mod (tap:Rate)
  0x0602:({n:'Phaser2', c:'mod',     t:'Rate'}),  // Phaser (A6 PhasrFk)
  0x0604:({n:'Mod04',  c:'mod',      t:'Rate'}),
  0x0606:({n:'Mod06',  c:'mod',      t:'Rate'}),
  0x0608:({n:'Mod08',  c:'mod',      t:'Rate'}),
  0x0609:({n:'Mod09',  c:'mod',      t:'Rate'}),
  0x060D:({n:'Mod0D',  c:'mod',      t:'Rate'}),
  0x060F:({n:'Mod0F',  c:'mod',      t:'Rate'}),
  0x0611:({n:'Mod11',  c:'mod',      t:'Rate'}),
  0x0613:({n:'Mod13',  c:'mod',      t:'Rate'}),
  0x2601:({n:'Mod01b', c:'mod',      t:'Rate'}),
  0x2603:({n:'Mod03b', c:'mod',      t:'Rate'}),
  0x2607:({n:'Mod07b', c:'mod',      t:'Rate'}),
  0x260A:({n:'Mod0Ab', c:'mod',      t:'Rate'}),
  0x260D:({n:'Mod0Db', c:'mod',      t:'Rate'}),
  0x2613:({n:'Mod13b', c:'mod',      t:'Rate'}),
  // Família 0x07xx / 0x27xx → special
  0x070F:({n:'Spc0F',  c:'special',  t:null}),
  0x270B:({n:'Spc0Bb', c:'special',  t:null}),
  0x270C:({n:'Spc0Cb', c:'special',  t:null}),
  // Família 0x08xx / 0x28xx → delay (tap:Time)
  0x080B:({n:'Dly0B',  c:'delay',    t:'Time'}),
  0x080C:({n:'Dly0C',  c:'delay',    t:'Time'}),
  0x080D:({n:'Dly0D',  c:'delay',    t:'Time'}),
  0x0860:({n:'Dly60',  c:'delay',    t:'Time'}),
  0x0865:({n:'LongDly', c:'delay',   t:'Time'}),  // delay 4000ms (MUSEUM)
  0x0869:({n:'Dly69',  c:'delay',    t:'Time'}),
  0x0873:({n:'Dly73',  c:'delay',    t:'Time'}),
  0x2802:({n:'Dly02b', c:'delay',    t:'Time'}),
  0x2808:({n:'Dly08b', c:'delay',    t:'Time'}),
  0x280A:({n:'Dly0Ab', c:'delay',    t:'Time'}),
  0x280C:({n:'Dly0Cb', c:'delay',    t:'Time'}),
  0x2813:({n:'Dly13b', c:'delay',    t:'Time'}),
  0x282E:({n:'Dly2Eb', c:'delay',    t:'Time'}),
  0x283B:({n:'Dly3Bb', c:'delay',    t:'Time'}),
  0x2852:({n:'Dly52b', c:'delay',    t:'Time'}),
  0x2855:({n:'Dly55b', c:'delay',    t:'Time'}),
  0x285A:({n:'Dly5Ab', c:'delay',    t:'Time'}),
  0x285D:({n:'Dly5Db', c:'delay',    t:'Time'}),
  0x2868:({n:'Dly68b', c:'delay',    t:'Time'}),
  0x2869:({n:'Dly69b', c:'delay',    t:'Time'}),
  0x286A:({n:'Dly6Ab', c:'delay',    t:'Time'}),
  0x2873:({n:'Dly73b', c:'delay',    t:'Time'}),
  0x2874:({n:'Dly74b', c:'delay',    t:'Time'}),
  // Família 0x09xx / 0x29xx → reverb
  0x0900:({n:'Rvb00',  c:'reverb',   t:null}),
  0x0901:({n:'Rvb01',  c:'reverb',   t:null}),
  0x0905:({n:'Rvb05',  c:'reverb',   t:null}),
  0x0907:({n:'Rvb07',  c:'reverb',   t:null}),
  0x0908:({n:'Rvb08',  c:'reverb',   t:null}),
  0x090B:({n:'Rvb0B',  c:'reverb',   t:null}),
  0x090D:({n:'Rvb0D',  c:'reverb',   t:null}),
  0x090F:({n:'Rvb0F',  c:'reverb',   t:null}),
  0x0911:({n:'Rvb11',  c:'reverb',   t:null}),
  0x2900:({n:'Rvb00b', c:'reverb',   t:null}),
  0x2901:({n:'Plate',   c:'reverb',   t:null}),
  0x2903:({n:'Rvb03b', c:'reverb',   t:null}),
  0x2906:({n:'Rvb06b', c:'reverb',   t:null}),
  0x2907:({n:'Hall',    c:'reverb',   t:null}),
  0x2909:({n:'Rvb09b', c:'reverb',   t:null}),
  0x290A:({n:'Rvb0Ab', c:'reverb',   t:null}),
  0x290B:({n:'Rvb0Bb', c:'reverb',   t:null}),
  0x290C:({n:'Rvb0Cb', c:'reverb',   t:null}),
  0x290E:({n:'Rvb0Eb', c:'reverb',   t:null}),
  0x290F:({n:'Rvb0Fb', c:'reverb',   t:null}),
  // IDs compartilhados reverb (raw[2] discrimina via SHARED)
  0x0903:({n:'Arena',     c:'reverb',   t:null}),
  0x2902:({n:'Hall',      c:'reverb',   t:null}),
  0x2904:({n:'Air',       c:'reverb',   t:null}),
  // ── IDs identificados por engenharia reversa dump + ToneLib (2026-03-17) ──────
  // Família 0x00xx — módulos internos G1On (sem hi-byte de família padrão)
  0x0007:({n:'CabSim',    c:'amp',      t:null}),   // Cabinet Simulator — sempre junto com AmpSim, r2=0x28 fixo
  0x0010:({n:'GraphicEQ', c:'filter',   t:null}),   // GraphicEQ variante — params idênticos ao 0x0008, invisível no ToneLib
  0x0018:({n:'StereoCho', c:'mod',      t:'Rate'}), // StereoCho — ToneLib A5: "StereoCho effect", B1: "shimmering chorus"
  0x0019:({n:'CoronaTri', c:'mod',      t:'Rate'}), // CoronaTri — ToneLib H3: "CoronaTri gives 12-string sound"
  0x0020:({n:'LongDelay', c:'delay',    t:'Time'}), // Long Delay — ToneLib G9: "long delay sound for guitar solos"
  0x0028:({n:'GraphicEQ', c:'filter',   t:null}),   // GraphicEQ pós-amp — r2=0x20 fixo, params consistentes
  0x0030:({n:'AcoSim',    c:'special',  t:null}),   // Acoustic Simulator — ToneLib B3: "uses the Aco.Sim effect"
  0x000C:({n:'InternalFX',c:'special',  t:null}),   // Módulo interno G1On — 1 ocorrência (C2 TRIPY), invisível no ToneLib
  0x080E:({n:'Dly0E',     c:'delay',    t:'Time'}), // Delay variante — família 0x08xx confirmada, J9 Power Lead
  0x2004:({n:'Bypass',    c:'special',  t:null}),   // Bypass block — ToneLib H0: mostra literalmente "Bypass"
  0x2006:({n:'Detune12',  c:'pitch',    t:null}),   // Detune 12-string — ToneLib C9: "12-string guitar sound"
  0x200B:({n:'AmpSim',    c:'amp',      t:null}),   // AmpSim variante — família 0x20xx, só no ToneLib (fw anterior?)
};

const PATCH_CACHE_SEED = {
  'A0':{nome:'MSEUMd I',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:259,nome:'Dyn03',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,2,3,8,128,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:771,nome:'Drv03',cat:'drive',tap:null,enabled:false,rawSlot:[65,0,0,6,3,32,1,228,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:48,nome:'AcoSim',cat:'special',tap:null,enabled:false,rawSlot:[32,0,0,0,48,8,0,0,64,1,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'A1':{nome:'uermee',volume:100,temTime:false,temRate:false,efeitos:[{slot:3,id:10503,nome:'Hall',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,0,82,7,40,0,100,0,70,16,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'A2':{nome:'Blue Ld',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[17,0,0,66,0,56,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:9227,nome:'DZDrive',cat:'amp',tap:null,enabled:false,rawSlot:[33,0,0,72,11,16,1,228,0,69,38,200,8,2,0,128,6,0],slotIdx:1},{slot:3,id:2307,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,0,18,3,64,0,46,32,134,44,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'A3':{nome:'(AUTOWA',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8707,nome:'Flt03b',cat:'filter',tap:null,enabled:true,rawSlot:[33,0,0,196,3,56,128,66,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1044,nome:'MSDrive',cat:'amp',tap:null,enabled:false,rawSlot:[33,1,0,8,148,56,1,70,64,36,104,228,6,26,0,0,0,0],slotIdx:1},{slot:3,id:2305,nome:'Rvb01',cat:'reverb',tap:null,enabled:false,rawSlot:[33,128,0,18,1,64,0,20,0,3,170,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'A4':{nome:'Down Hv',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'NoiseGate',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,0,0,66,2,32,131,0,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1040,nome:'REVO1',cat:'amp',tap:null,enabled:false,rawSlot:[33,2,0,8,16,112,0,208,64,70,102,230,6,42,0,0,0,0],slotIdx:1}],ts:0},
  'A5':{nome:'hrusad',volume:100,temTime:false,temRate:true,efeitos:[{slot:1,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[113,128,0,0,8,112,0,70,64,1,128,12,0,0,0,0,128,0],slotIdx:0},{slot:2,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[11,0,0,0,8,32,3,3,32,0,0,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:10511,nome:'Rvb0Fb',cat:'reverb',tap:null,enabled:false,rawSlot:[1,1,0,82,143,48,1,58,0,12,128,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:24,nome:'StereoCho',cat:'mod',tap:'Rate',enabled:false,rawSlot:[120,0,0,0,24,136,1,16,0,0,0,0,0,0,0,0,0,0],slotIdx:3}],ts:0},
  'A6':{nome:'hasrFk',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:257,nome:'Comp',cat:'dynamics',tap:null,enabled:true,rawSlot:[17,0,0,130,1,40,0,62,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:3,id:9226,nome:'Amp0Ab',cat:'amp',tap:null,enabled:false,rawSlot:[17,128,0,72,10,112,0,229,0,6,7,4,6,1,0,0,2,128],slotIdx:2},{slot:4,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,2,184,0,23,64,39,108,11,128,12,128,0,0,0],slotIdx:3}],ts:0},
  'A7':{nome:'Jazzy ea',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:true,rawSlot:[17,0,0,194,0,64,0,100,32,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:777,nome:'Drv09',cat:'drive',tap:null,enabled:false,rawSlot:[65,0,0,6,9,48,2,100,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[1,129,0,18,130,80,0,80,0,12,128,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'A8':{nome:'pAcoust',volume:75,temTime:false,temRate:false,efeitos:[{slot:1,id:516,nome:'Flt04',cat:'filter',tap:null,enabled:true,rawSlot:[33,0,0,132,4,120,0,12,64,193,97,130,12,0,0,0,128,0],slotIdx:0},{slot:2,id:8976,nome:'Drv10b',cat:'drive',tap:null,enabled:false,rawSlot:[1,2,0,70,16,88,2,100,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:2324,nome:'HDHall',cat:'reverb',tap:null,enabled:false,rawSlot:[17,0,0,18,20,104,1,62,0,229,38,0,0,0,128,0,0,0],slotIdx:2},{slot:4,id:258,nome:'Dyn02',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,0,0,2,2,32,3,128,0,0,0,0,0,0,0,0,0,0],slotIdx:3}],ts:0},
  'A9':{nome:'Supern',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:9229,nome:'TWRock',cat:'amp',tap:null,enabled:false,rawSlot:[33,129,0,72,13,112,0,95,64,70,102,70,6,18,0,0,0,0],slotIdx:0},{slot:2,id:2319,nome:'Rvb0F',cat:'reverb',tap:null,enabled:false,rawSlot:[33,131,0,18,143,80,2,130,0,12,32,0,0,0,0,0,0,0],slotIdx:1}],ts:0},
  'B0':{nome:'CLEAN',volume:84,temTime:false,temRate:false,efeitos:[{slot:1,id:9221,nome:'Amp05b',cat:'amp',tap:null,enabled:true,rawSlot:[97,0,0,200,5,24,130,100,96,38,72,70,6,36,0,0,0,0],slotIdx:0},{slot:2,id:2309,nome:'Rvb05',cat:'reverb',tap:null,enabled:true,rawSlot:[65,128,0,146,5,48,0,82,64,97,45,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:266,nome:'Dyn0A',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,128,0,2,10,32,1,6,32,224,9,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'B1':{nome:'CRONA',volume:100,temTime:false,temRate:true,efeitos:[{slot:1,id:24,nome:'StereoCho',cat:'mod',tap:'Rate',enabled:false,rawSlot:[73,128,0,0,24,112,128,70,64,1,128,12,0,0,0,0,0,0],slotIdx:0},{slot:2,id:9220,nome:'Amp04b',cat:'amp',tap:null,enabled:true,rawSlot:[17,0,0,200,132,112,1,250,0,6,100,197,7,1,0,0,128,0],slotIdx:1},{slot:3,id:40,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[103,0,0,0,40,32,3,3,32,0,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'B2':{nome:'STRATT',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:266,nome:'Dyn0A',cat:'dynamics',tap:null,enabled:true,rawSlot:[107,128,0,130,10,112,0,6,0,0,12,128,0,0,0,0,0,0],slotIdx:0},{slot:2,id:2311,nome:'Rvb07',cat:'reverb',tap:null,enabled:true,rawSlot:[65,1,0,146,7,112,0,15,96,194,32,3,12,0,0,128,128,0],slotIdx:1}],ts:0},
  'B3':{nome:'ean p',volume:70,temTime:false,temRate:true,efeitos:[{slot:1,id:788,nome:'Amp',cat:'amp',tap:null,enabled:false,rawSlot:[1,130,0,6,20,16,129,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:24,nome:'StereoCho',cat:'mod',tap:'Rate',enabled:false,rawSlot:[20,1,0,0,24,0,0,12,0,0,0,3,0,0,0,0,128,0],slotIdx:1},{slot:3,id:48,nome:'AcoSim',cat:'special',tap:null,enabled:false,rawSlot:[94,0,0,0,48,8,0,0,64,1,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'B4':{nome:'Just Fk',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:257,nome:'Comp',cat:'dynamics',tap:null,enabled:true,rawSlot:[17,0,0,130,1,40,0,62,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1034,nome:'Amp0A',cat:'amp',tap:null,enabled:false,rawSlot:[17,0,0,8,10,112,0,255,0,134,7,132,6,1,0,128,2,0],slotIdx:1},{slot:3,id:10500,nome:'TiledRoom',cat:'reverb',tap:null,enabled:false,rawSlot:[1,1,0,82,132,72,0,35,0,12,128,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'B5':{nome:'CrstaVi',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:16,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[13,128,0,0,16,112,128,70,64,1,128,12,0,0,0,0,0,0],slotIdx:0},{slot:2,id:10503,nome:'Hall',cat:'reverb',tap:null,enabled:true,rawSlot:[33,0,0,210,7,40,0,96,0,6,12,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:10504,nome:'Spring63',cat:'reverb',tap:null,enabled:false,rawSlot:[1,129,0,82,136,24,1,58,64,16,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[97,1,128,0,8,80,0,32,0,1,0,0,0,0,0,0,0,0],slotIdx:3}],ts:0},
  'B6':{nome:'ic Ch',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[17,0,0,66,0,80,0,2,32,0,0,0,0,128,0,0,0,0],slotIdx:0},{slot:2,id:16,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[120,0,0,0,16,112,0,198,64,1,0,12,0,0,0,0,128,0],slotIdx:1},{slot:3,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,2,40,129,25,128,42,108,43,0,12,0,0,0,0],slotIdx:2}],ts:0},
  'B7':{nome:'Rev Drm',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:1033,nome:'Amp09',cat:'amp',tap:null,enabled:false,rawSlot:[17,128,0,8,9,112,0,111,0,166,197,132,6,1,0,0,2,0],slotIdx:0},{slot:2,id:2321,nome:'Rvb11',cat:'reverb',tap:null,enabled:true,rawSlot:[65,129,0,146,145,104,0,194,64,66,32,3,15,0,0,0,128,0],slotIdx:1}],ts:0},
  'B8':{nome:'TapeSl',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[22,128,0,0,8,112,128,70,64,1,128,12,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1030,nome:'FDCombo',cat:'amp',tap:null,enabled:true,rawSlot:[17,0,0,136,6,112,0,228,0,38,5,133,6,1,0,128,128,0],slotIdx:1}],ts:0},
  'B9':{nome:'unky uc',volume:100,temTime:false,temRate:true,efeitos:[{slot:1,id:516,nome:'Flt04',cat:'filter',tap:null,enabled:false,rawSlot:[33,0,0,4,4,80,128,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:24,nome:'StereoCho',cat:'mod',tap:'Rate',enabled:false,rawSlot:[97,0,0,0,24,16,1,178,64,6,0,12,0,0,0,0,128,0],slotIdx:1},{slot:3,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[17,0,0,66,0,48,0,12,0,0,0,128,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'C0':{nome:'B Ra',volume:65,temTime:false,temRate:false,efeitos:[{slot:1,id:261,nome:'SlowAtck',cat:'filter',tap:null,enabled:true,rawSlot:[107,0,0,130,5,64,1,18,0,0,12,128,0,0,0,0,0,0],slotIdx:0},{slot:2,id:9736,nome:'Detune',cat:'pitch',tap:null,enabled:true,rawSlot:[1,1,0,204,8,24,1,49,0,129,12,0,0,0,0,0,0,0],slotIdx:1},{slot:4,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[83,0,0,0,8,240,0,70,64,1,0,12,0,0,128,0,0,0],slotIdx:3},{slot:5,id:2304,nome:'Rvb00',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,0,0,129,164,128,8,102,43,128,12,0,0,0,0],slotIdx:4}],ts:0},
  'C1':{nome:'AKE',volume:85,temTime:false,temRate:false,efeitos:[{slot:1,id:1028,nome:'Amp04',cat:'amp',tap:null,enabled:true,rawSlot:[65,0,0,136,4,56,2,98,32,37,72,68,134,28,0,0,0,0],slotIdx:0},{slot:2,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:true,rawSlot:[18,128,0,128,7,40,0,24,0,160,0,0,12,0,0,128,0,0],slotIdx:1},{slot:3,id:265,nome:'160Comp',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,128,0,2,9,24,1,6,0,128,12,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:10506,nome:'Rvb0Ab',cat:'reverb',tap:null,enabled:false,rawSlot:[65,1,128,82,10,88,0,28,64,66,65,3,44,128,0,0,0,0],slotIdx:3}],ts:0},
  'C2':{nome:'PY',volume:60,temTime:false,temRate:true,efeitos:[{slot:1,id:9223,nome:'DeluxeR',cat:'amp',tap:null,enabled:true,rawSlot:[33,0,0,200,7,0,1,22,0,101,71,70,6,130,0,0,0,0],slotIdx:0},{slot:2,id:24,nome:'StereoCho',cat:'mod',tap:'Rate',enabled:false,rawSlot:[18,129,0,0,24,112,2,0,0,32,0,1,12,0,0,128,128,0],slotIdx:1},{slot:3,id:24,nome:'StereoCho',cat:'mod',tap:'Rate',enabled:false,rawSlot:[121,0,0,0,24,32,3,44,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:12,nome:'InternalFX',cat:'special',tap:null,enabled:false,rawSlot:[116,1,0,0,12,0,0,140,0,0,0,12,0,0,128,0,0,128],slotIdx:3},{slot:5,id:10497,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,82,1,8,129,24,32,39,108,139,128,15,0,0,0,0],slotIdx:4}],ts:0},
  'C3':{nome:'ACO',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:true,rawSlot:[33,0,0,194,2,0,128,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:788,nome:'Amp',cat:'amp',tap:null,enabled:false,rawSlot:[1,2,0,6,20,40,1,244,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:8460,nome:'Dyn0Cb',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,0,0,66,12,40,1,6,0,160,6,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:2317,nome:'Rvb0D',cat:'reverb',tap:null,enabled:false,rawSlot:[17,0,0,18,13,8,1,62,96,65,8,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'C4':{nome:'StRahh',volume:100,temTime:false,temRate:true,efeitos:[{slot:1,id:8983,nome:'Drv17b',cat:'drive',tap:null,enabled:true,rawSlot:[97,1,0,198,23,16,2,22,0,0,0,0,0,128,0,0,0,0],slotIdx:0},{slot:2,id:8454,nome:'Dyn06b',cat:'dynamics',tap:null,enabled:true,rawSlot:[107,0,0,194,6,112,0,140,32,0,12,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:2315,nome:'Rvb0B',cat:'reverb',tap:null,enabled:false,rawSlot:[17,0,0,18,11,80,0,20,0,228,167,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:9731,nome:'Mod03b',cat:'mod',tap:'Rate',enabled:false,rawSlot:[1,1,128,76,3,136,0,175,96,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'C5':{nome:'Natura',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1030,nome:'FDCombo',cat:'amp',tap:null,enabled:false,rawSlot:[17,128,0,8,6,112,0,86,0,166,133,133,6,1,0,0,0,0],slotIdx:0},{slot:2,id:10498,nome:'Hall',cat:'reverb',tap:null,enabled:false,rawSlot:[33,128,0,82,2,40,0,46,0,70,16,0,0,0,0,0,0,0],slotIdx:1}],ts:0},
  'C6':{nome:'SPAGHETI',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[5,128,0,0,8,112,0,70,64,1,128,12,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1029,nome:'Amp05',cat:'amp',tap:null,enabled:true,rawSlot:[17,0,0,136,5,16,1,248,96,39,5,134,6,1,0,128,0,128],slotIdx:1},{slot:3,id:10502,nome:'Rvb06b',cat:'reverb',tap:null,enabled:false,rawSlot:[1,1,0,82,134,24,1,58,0,12,128,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'C7':{nome:'Gardenok',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:8961,nome:'Drv01b',cat:'drive',tap:null,enabled:true,rawSlot:[0,128,0,198,1,16,129,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1028,nome:'Amp04',cat:'amp',tap:null,enabled:false,rawSlot:[97,0,0,8,4,56,1,228,96,168,37,167,11,14,0,128,0,0],slotIdx:1},{slot:3,id:2304,nome:'Rvb00',cat:'reverb',tap:null,enabled:false,rawSlot:[17,0,0,18,0,48,1,38,0,196,8,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'C8':{nome:'ClanJz',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:269,nome:'Dyn0D',cat:'dynamics',tap:null,enabled:true,rawSlot:[107,128,0,130,13,112,0,2,0,32,11,128,0,0,0,0,0,0],slotIdx:0},{slot:2,id:516,nome:'Flt04',cat:'filter',tap:null,enabled:false,rawSlot:[33,0,0,4,132,0,0,137,32,33,66,0,11,0,0,0,128,128],slotIdx:1},{slot:3,id:1029,nome:'Amp05',cat:'amp',tap:null,enabled:false,rawSlot:[1,1,0,8,133,112,0,99,128,99,105,74,6,24,0,0,8,128],slotIdx:2},{slot:4,id:16,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[40,1,0,0,16,240,0,70,64,1,0,12,0,0,128,0,0,0],slotIdx:3}],ts:0},
  'C9':{nome:'ELLOW12',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:9222,nome:'Amp06b',cat:'amp',tap:null,enabled:true,rawSlot:[97,128,0,200,6,112,128,100,64,197,165,165,134,14,0,0,0,0],slotIdx:0},{slot:2,id:8198,nome:'Detune12',cat:'pitch',tap:null,enabled:false,rawSlot:[72,128,0,64,6,24,0,12,0,0,0,1,12,0,0,128,128,128],slotIdx:1},{slot:3,id:265,nome:'160Comp',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,128,0,2,9,112,0,6,0,128,12,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:2319,nome:'Rvb0F',cat:'reverb',tap:null,enabled:false,rawSlot:[65,1,0,18,15,152,0,30,32,65,32,3,12,128,128,128,0,0],slotIdx:3}],ts:0},
  'D0':{nome:'BritCoo',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:9228,nome:'CARDrive',cat:'amp',tap:null,enabled:true,rawSlot:[1,0,0,200,12,48,129,100,64,132,232,163,6,8,0,0,0,0],slotIdx:0},{slot:2,id:785,nome:'Fuzz',cat:'drive',tap:null,enabled:false,rawSlot:[17,128,0,6,17,24,1,100,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:513,nome:'SeqFilter',cat:'filter',tap:null,enabled:false,rawSlot:[65,128,0,4,1,8,0,138,64,35,32,1,12,0,0,0,0,0],slotIdx:2},{slot:4,id:8456,nome:'Dyn08b',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,0,0,66,8,240,0,9,0,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'D1':{nome:'O',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,66,2,8,128,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1038,nome:'MS1959',cat:'amp',tap:null,enabled:false,rawSlot:[1,1,0,8,14,112,0,227,96,71,38,197,7,24,0,0,128,0],slotIdx:1},{slot:3,id:40,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[11,0,0,0,168,32,3,3,32,0,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'D2':{nome:'Talk Fk',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8704,nome:'Flt00b',cat:'filter',tap:null,enabled:true,rawSlot:[97,0,0,196,0,80,128,16,0,12,12,128,128,0,0,0,0,0],slotIdx:0},{slot:2,id:770,nome:'Drv02',cat:'drive',tap:null,enabled:false,rawSlot:[65,0,0,6,2,0,2,228,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:10497,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,128,0,82,1,80,0,25,32,131,140,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'D3':{nome:'S STA',volume:76,temTime:false,temRate:false,efeitos:[{slot:1,id:9230,nome:'USBlues',cat:'amp',tap:null,enabled:true,rawSlot:[65,129,0,200,14,48,129,98,32,35,73,68,134,30,0,0,0,0],slotIdx:0},{slot:2,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:true,rawSlot:[20,128,0,128,7,40,0,24,32,160,0,0,12,0,0,128,0,128],slotIdx:1},{slot:3,id:8457,nome:'Dyn09b',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,128,0,66,9,112,0,6,0,128,12,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'D4':{nome:'0s Rhhm',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false,rawSlot:[33,0,0,6,15,88,2,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:16,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[121,1,0,0,16,16,1,178,64,6,0,1,12,0,0,128,128,0],slotIdx:1},{slot:3,id:10505,nome:'Rvb09b',cat:'reverb',tap:null,enabled:false,rawSlot:[97,128,0,82,137,48,0,50,0,128,140,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'D5':{nome:'EC.PO',volume:83,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,66,2,8,128,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:3,id:9231,nome:'BlackBrth',cat:'amp',tap:null,enabled:false,rawSlot:[33,129,0,72,15,32,1,223,64,135,197,5,7,18,0,0,0,128],slotIdx:2}],ts:0},
  'D6':{nome:'AT RHHM',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:9235,nome:'Amp13b',cat:'amp',tap:null,enabled:true,rawSlot:[65,128,0,200,19,120,128,100,64,70,232,66,134,20,0,0,0,0],slotIdx:0},{slot:2,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:true,rawSlot:[16,128,0,128,7,40,0,24,0,160,0,0,12,0,0,128,0,128],slotIdx:1},{slot:3,id:8457,nome:'Dyn09b',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,128,0,66,9,112,0,3,0,128,12,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'D7':{nome:'KRAVIT',volume:67,temTime:false,temRate:false,efeitos:[{slot:2,id:774,nome:'Drv06',cat:'drive',tap:null,enabled:false,rawSlot:[97,0,0,6,6,48,1,100,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:9234,nome:'Amp12b',cat:'amp',tap:null,enabled:false,rawSlot:[65,129,0,72,146,64,1,226,160,105,36,70,6,28,0,0,0,128],slotIdx:2}],ts:0},
  'D8':{nome:'Tap Deay',volume:64,temTime:true,temRate:false,efeitos:[{slot:1,id:1041,nome:'Tangerine',cat:'amp',tap:null,enabled:true,rawSlot:[1,129,0,136,17,112,128,99,0,70,166,69,134,24,0,0,0,0],slotIdx:0},{slot:2,id:10345,nome:'Dly69b',cat:'delay',tap:'Time',enabled:false,rawSlot:[17,128,0,80,105,3,0,85,192,1,0,44,0,0,0,0,128,0],slotIdx:1}],ts:0},
  'D9':{nome:'GIRL',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'NoiseGate',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,0,0,66,2,32,131,0,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false,rawSlot:[97,0,0,6,15,16,1,228,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:10497,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[65,128,0,82,1,64,0,25,0,128,140,0,0,0,128,0,0,0],slotIdx:2},{slot:4,id:1029,nome:'Amp05',cat:'amp',tap:null,enabled:false,rawSlot:[1,0,128,8,5,48,1,100,96,198,38,38,6,136,0,0,0,0],slotIdx:3},{slot:5,id:256,nome:'Dyn00',cat:'dynamics',tap:null,enabled:false,rawSlot:[17,0,0,2,0,8,0,120,0,0,0,0,128,0,0,0,0,0],slotIdx:4}],ts:0},
  'E0':{nome:'SURF',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false,rawSlot:[17,128,0,6,15,16,1,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:2311,nome:'Rvb07',cat:'reverb',tap:null,enabled:false,rawSlot:[1,1,0,18,135,0,1,58,0,12,0,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:1032,nome:'Amp08',cat:'amp',tap:null,enabled:false,rawSlot:[33,128,0,8,8,16,1,228,32,102,197,38,5,2,0,0,0,128],slotIdx:2}],ts:0},
  'E1':{nome:'CASSI',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:770,nome:'Drv02',cat:'drive',tap:null,enabled:true,rawSlot:[33,128,0,134,2,56,1,90,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1028,nome:'Amp04',cat:'amp',tap:null,enabled:false,rawSlot:[97,1,0,8,132,112,0,234,64,197,6,135,6,22,0,128,0,0],slotIdx:1},{slot:3,id:48,nome:'AcoSim',cat:'special',tap:null,enabled:false,rawSlot:[60,0,0,0,48,8,0,0,64,1,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'E2':{nome:'.SESSN',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false,rawSlot:[33,128,0,6,15,88,1,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:48,nome:'AcoSim',cat:'special',tap:null,enabled:false,rawSlot:[48,1,0,0,48,0,0,12,0,0,0,0,12,0,0,128,0,0],slotIdx:1},{slot:3,id:1038,nome:'MS1959',cat:'amp',tap:null,enabled:false,rawSlot:[33,1,0,8,142,96,1,228,128,231,198,101,4,26,0,0,0,128],slotIdx:2}],ts:0},
  'E3':{nome:'ORKE',volume:62,temTime:true,temRate:false,efeitos:[{slot:1,id:774,nome:'Drv06',cat:'drive',tap:null,enabled:false,rawSlot:[65,128,0,6,6,16,129,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true,rawSlot:[31,0,0,128,8,24,0,0,0,0,12,0,12,0,0,128,0,0],slotIdx:1},{slot:3,id:10336,nome:'CarbonDly',cat:'delay',tap:'Time',enabled:false,rawSlot:[97,129,0,80,224,40,1,10,160,224,3,3,0,0,0,0,0,0],slotIdx:2},{slot:4,id:10498,nome:'Room',cat:'reverb',tap:null,enabled:false,rawSlot:[65,0,128,82,2,64,0,60,0,0,12,0,0,0,0,128,0,0],slotIdx:3},{slot:5,id:1031,nome:'Matchless',cat:'amp',tap:null,enabled:false,rawSlot:[1,0,128,8,7,136,129,228,96,39,38,36,134,8,0,128,0,0],slotIdx:4}],ts:0},
  'E4':{nome:'IMPLEON',volume:87,temTime:false,temRate:false,efeitos:[{slot:1,id:1036,nome:'VXJimi',cat:'amp',tap:null,enabled:true,rawSlot:[65,128,0,136,12,16,129,95,64,6,69,133,7,12,0,0,0,0],slotIdx:0},{slot:3,id:8980,nome:'Drv14b',cat:'drive',tap:null,enabled:false,rawSlot:[32,128,0,70,20,16,1,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'E5':{nome:'FunkRoar',volume:100,temTime:false,temRate:false,efeitos:[{slot:2,id:8708,nome:'AutoWah',cat:'filter',tap:null,enabled:false,rawSlot:[33,0,0,68,4,16,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:9220,nome:'Amp04b',cat:'amp',tap:null,enabled:false,rawSlot:[97,0,0,72,132,48,2,233,224,102,200,37,6,14,0,0,0,128],slotIdx:2},{slot:4,id:8707,nome:'Flt03b',cat:'filter',tap:null,enabled:false,rawSlot:[33,0,0,68,3,88,0,136,64,98,2,1,12,128,128,0,0,128],slotIdx:3},{slot:5,id:9995,nome:'Spc0Bb',cat:'special',tap:null,enabled:false,rawSlot:[65,0,128,78,11,0,0,100,192,3,0,0,128,0,0,0,0,0],slotIdx:4}],ts:0},
  'E6':{nome:'HITE',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:774,nome:'Drv06',cat:'drive',tap:null,enabled:true,rawSlot:[33,128,0,134,6,64,1,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[87,0,0,0,8,0,0,12,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:10504,nome:'Spring63',cat:'reverb',tap:null,enabled:false,rawSlot:[1,129,0,82,136,104,0,58,0,12,128,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:1030,nome:'FDCombo',cat:'amp',tap:null,enabled:false,rawSlot:[17,0,0,8,6,240,0,86,0,166,5,5,6,129,128,128,0,0],slotIdx:3}],ts:0},
  'E7':{nome:'ORG CRC',volume:90,temTime:false,temRate:false,efeitos:[{slot:1,id:1037,nome:'HWStar',cat:'amp',tap:null,enabled:true,rawSlot:[1,1,0,136,13,56,129,99,64,72,134,198,134,24,0,0,0,0],slotIdx:0},{slot:2,id:8961,nome:'Drv01b',cat:'drive',tap:null,enabled:false,rawSlot:[65,128,0,70,1,56,1,228,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:513,nome:'SeqFilter',cat:'filter',tap:null,enabled:false,rawSlot:[65,128,0,4,1,8,0,138,64,35,64,1,12,0,0,0,0,0],slotIdx:2},{slot:4,id:265,nome:'160Comp',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,0,0,2,9,240,0,7,0,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'E8':{nome:'VALENTE',volume:60,temTime:false,temRate:false,efeitos:[{slot:1,id:267,nome:'Dyn0B',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,128,0,2,11,104,0,10,0,0,12,128,0,0,0,0,0,0],slotIdx:0},{slot:2,id:773,nome:'Drv05',cat:'drive',tap:null,enabled:false,rawSlot:[32,0,0,6,5,56,1,207,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:1030,nome:'FDCombo',cat:'amp',tap:null,enabled:false,rawSlot:[97,0,0,8,134,32,1,100,64,135,165,101,9,14,0,0,0,128],slotIdx:2}],ts:0},
  'E9':{nome:'FILTER',volume:100,temTime:true,temRate:false,efeitos:[{slot:1,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[100,128,0,0,8,112,0,70,64,1,128,12,0,0,0,0,0,0],slotIdx:0},{slot:2,id:9220,nome:'Amp04b',cat:'amp',tap:null,enabled:false,rawSlot:[65,0,0,72,4,72,1,218,64,199,102,133,6,4,0,128,128,128],slotIdx:1},{slot:3,id:2061,nome:'Dly0D',cat:'delay',tap:'Time',enabled:false,rawSlot:[225,0,0,16,141,16,1,204,96,161,138,1,44,0,0,0,0,0],slotIdx:2}],ts:0},
  'F0':{nome:'MEAL IF',volume:110,temTime:false,temRate:false,efeitos:[{slot:1,id:773,nome:'Drv05',cat:'drive',tap:null,enabled:true,rawSlot:[65,0,0,134,5,72,1,110,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:9231,nome:'BlackBrth',cat:'amp',tap:null,enabled:false,rawSlot:[1,2,0,72,15,40,0,228,64,100,35,231,5,42,0,0,0,0],slotIdx:1},{slot:3,id:262,nome:'Dyn06',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,0,0,2,134,32,3,0,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:false,rawSlot:[14,0,0,0,7,40,0,128,0,32,0,3,12,128,0,128,0,0],slotIdx:3}],ts:0},
  'F1':{nome:'Wilhel',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8976,nome:'Drv10b',cat:'drive',tap:null,enabled:false,rawSlot:[65,128,0,70,16,104,2,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1032,nome:'Amp08',cat:'amp',tap:null,enabled:false,rawSlot:[1,1,0,8,136,112,0,202,64,231,104,198,6,16,0,0,128,0],slotIdx:1},{slot:3,id:10498,nome:'Hall',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,0,82,2,40,0,46,0,134,12,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'F2':{nome:'MFFBI',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1039,nome:'ALIEN',cat:'amp',tap:null,enabled:true,rawSlot:[97,1,0,136,15,64,1,106,64,3,168,196,6,22,0,0,0,0],slotIdx:0},{slot:2,id:8963,nome:'Drv03b',cat:'drive',tap:null,enabled:false,rawSlot:[1,129,0,70,3,88,0,228,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:false,rawSlot:[18,129,0,0,7,40,0,152,32,160,0,0,12,0,0,0,0,0],slotIdx:2},{slot:4,id:263,nome:'Dyn07',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,0,0,2,7,240,0,134,0,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'F3':{nome:'Dr.Roc',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:9228,nome:'CARDrive',cat:'amp',tap:null,enabled:true,rawSlot:[97,2,0,200,12,8,1,93,64,72,198,132,137,38,0,0,2,0],slotIdx:0},{slot:2,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[17,128,0,66,0,48,0,100,32,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:8707,nome:'Flt03b',cat:'filter',tap:null,enabled:false,rawSlot:[33,128,0,68,3,104,0,137,128,226,1,1,12,0,128,0,0,0],slotIdx:2},{slot:4,id:257,nome:'Comp',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,2,1,0,0,238,0,0,0,0,0,0,0,0,0,0],slotIdx:3}],ts:0},
  'F4':{nome:'iracl',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:9238,nome:'Amp16b',cat:'amp',tap:null,enabled:true,rawSlot:[1,130,0,200,22,120,1,100,0,198,6,39,6,32,0,0,128,0],slotIdx:0},{slot:3,id:10498,nome:'Room',cat:'reverb',tap:null,enabled:false,rawSlot:[65,0,0,82,2,64,0,79,0,128,140,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'F5':{nome:'MDERNHVY',volume:96,temTime:false,temRate:false,efeitos:[{slot:1,id:9234,nome:'Amp12b',cat:'amp',tap:null,enabled:false,rawSlot:[33,2,0,72,18,56,1,91,64,72,67,198,6,34,0,0,128,0],slotIdx:0},{slot:2,id:8453,nome:'Dyn05b',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,128,0,66,5,32,3,0,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:false,rawSlot:[20,129,0,0,7,40,0,152,32,160,0,0,12,0,0,0,0,0],slotIdx:2},{slot:4,id:8457,nome:'Dyn09b',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,0,0,66,9,240,0,4,0,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'F6':{nome:'ilmouih',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:778,nome:'Squeak',cat:'drive',tap:null,enabled:true,rawSlot:[1,129,0,134,10,56,0,110,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[5,1,0,0,8,0,3,3,32,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,2,112,129,30,192,39,108,11,0,12,0,0,0,0],slotIdx:2}],ts:0},
  'F7':{nome:'FOOFIGT',volume:73,temTime:false,temRate:false,efeitos:[{slot:2,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,66,2,8,0,100,0,0,0,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:1031,nome:'Matchless',cat:'amp',tap:null,enabled:false,rawSlot:[65,130,0,8,7,120,1,211,96,135,6,7,4,36,0,0,0,128],slotIdx:2}],ts:0},
  'F8':{nome:'JIMI',volume:70,temTime:true,temRate:false,efeitos:[{slot:1,id:8969,nome:'Drv09b',cat:'drive',tap:null,enabled:false,rawSlot:[97,0,0,70,9,32,131,84,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:9736,nome:'Detune',cat:'pitch',tap:null,enabled:false,rawSlot:[1,0,0,76,8,96,1,176,0,35,0,12,0,0,0,0,128,0],slotIdx:1},{slot:3,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:false,rawSlot:[161,128,0,80,11,80,1,23,32,128,140,0,0,0,128,0,0,0],slotIdx:2},{slot:4,id:9234,nome:'Amp12b',cat:'amp',tap:null,enabled:false,rawSlot:[97,1,128,72,18,8,2,181,64,233,107,71,3,158,128,0,0,0],slotIdx:3}],ts:0},
  'F9':{nome:'SpeedMa',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,66,2,8,128,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:8708,nome:'AutoWah',cat:'filter',tap:null,enabled:false,rawSlot:[65,0,0,68,132,16,0,17,96,193,64,0,12,0,0,128,128,0],slotIdx:1},{slot:3,id:9233,nome:'Amp11b',cat:'amp',tap:null,enabled:false,rawSlot:[1,2,0,72,145,112,1,194,224,71,100,69,6,40,0,0,0,128],slotIdx:2},{slot:4,id:8707,nome:'Flt03b',cat:'filter',tap:null,enabled:false,rawSlot:[33,0,128,68,3,80,0,10,32,1,1,1,12,128,128,128,0,0],slotIdx:3}],ts:0},
  'G0':{nome:'Green I',volume:40,temTime:false,temRate:true,efeitos:[{slot:1,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:false,rawSlot:[17,0,0,66,2,48,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:769,nome:'Drv01',cat:'drive',tap:null,enabled:false,rawSlot:[33,0,0,6,1,56,0,228,0,0,0,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:1040,nome:'REVO1',cat:'amp',tap:null,enabled:false,rawSlot:[1,129,0,8,144,88,1,99,128,70,166,69,6,24,0,0,0,128],slotIdx:2},{slot:4,id:1556,nome:'Tremolo',cat:'mod',tap:'Rate',enabled:false,rawSlot:[65,1,128,12,20,232,0,72,96,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'G1':{nome:'LA Met',volume:90,temTime:true,temRate:false,efeitos:[{slot:1,id:768,nome:'Drv00',cat:'drive',tap:null,enabled:false,rawSlot:[33,128,0,6,0,16,1,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:772,nome:'Drv04',cat:'drive',tap:null,enabled:false,rawSlot:[65,0,0,6,4,16,1,228,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:1029,nome:'Amp05',cat:'amp',tap:null,enabled:false,rawSlot:[65,1,0,8,133,72,1,226,192,69,166,70,6,28,0,0,0,128],slotIdx:2},{slot:4,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:false,rawSlot:[16,0,0,80,11,120,128,163,64,1,0,12,0,0,128,0,0,0],slotIdx:3}],ts:0},
  'G2':{nome:'Shred ick',volume:62,temTime:true,temRate:false,efeitos:[{slot:1,id:8975,nome:'Drv0Fb',cat:'drive',tap:null,enabled:false,rawSlot:[33,0,0,70,15,56,2,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1039,nome:'ALIEN',cat:'amp',tap:null,enabled:false,rawSlot:[1,1,0,8,143,16,1,227,0,134,39,133,7,24,0,0,128,128],slotIdx:1},{slot:3,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:false,rawSlot:[145,128,0,80,11,56,0,42,192,1,0,12,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'G3':{nome:'Dist Hl',volume:65,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'NoiseGate',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,0,0,66,2,32,131,0,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1036,nome:'VXJimi',cat:'amp',tap:null,enabled:true,rawSlot:[33,2,0,136,12,0,0,100,64,198,98,230,7,42,0,0,0,0],slotIdx:1},{slot:3,id:8706,nome:'Flt02b',cat:'filter',tap:null,enabled:false,rawSlot:[33,128,0,68,2,88,0,138,0,194,1,2,12,0,0,0,0,0],slotIdx:2}],ts:0},
  'G4':{nome:'MASSIVL',volume:90,temTime:false,temRate:false,efeitos:[{slot:1,id:1029,nome:'Amp05',cat:'amp',tap:null,enabled:false,rawSlot:[65,2,0,8,5,0,1,97,64,65,232,101,4,36,0,0,0,0],slotIdx:0},{slot:2,id:514,nome:'ParaEQ',cat:'filter',tap:null,enabled:false,rawSlot:[65,128,0,4,2,8,0,7,64,35,0,1,12,0,0,128,0,128],slotIdx:1},{slot:3,id:264,nome:'Dyn08',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,128,0,2,8,112,0,5,0,192,18,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:2307,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,128,18,3,248,0,153,96,37,74,41,128,12,0,128,0,0],slotIdx:3}],ts:0},
  'G5':{nome:'MUFFLR',volume:100,temTime:true,temRate:false,efeitos:[{slot:1,id:780,nome:'Drv0C',cat:'drive',tap:null,enabled:true,rawSlot:[1,129,0,134,12,80,1,103,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1031,nome:'Matchless',cat:'amp',tap:null,enabled:false,rawSlot:[65,1,0,8,135,24,1,111,96,198,102,133,6,20,0,128,0,0],slotIdx:1},{slot:3,id:2144,nome:'Dly60',cat:'delay',tap:'Time',enabled:false,rawSlot:[97,129,0,16,224,120,1,58,160,224,3,35,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'G6':{nome:'Tappinero',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:768,nome:'Drv00',cat:'drive',tap:null,enabled:false,rawSlot:[33,0,0,6,0,64,1,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1035,nome:'Amp0B',cat:'amp',tap:null,enabled:false,rawSlot:[1,2,0,8,11,8,2,215,64,38,6,135,5,40,0,128,128,0],slotIdx:1},{slot:3,id:514,nome:'ParaEQ',cat:'filter',tap:null,enabled:false,rawSlot:[65,0,0,4,2,8,0,136,224,33,128,1,12,0,0,0,0,0],slotIdx:2},{slot:4,id:10497,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[32,0,0,82,1,40,0,35,0,6,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'G7':{nome:'CT GT',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1042,nome:'MSCrunch',cat:'amp',tap:null,enabled:false,rawSlot:[33,2,0,8,18,8,1,91,0,200,197,68,5,34,0,0,0,0],slotIdx:0},{slot:2,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:true,rawSlot:[16,128,0,128,7,40,0,24,32,160,0,0,12,0,0,128,0,0],slotIdx:1},{slot:3,id:8458,nome:'Dyn0Ab',cat:'dynamics',tap:null,enabled:false,rawSlot:[107,0,0,66,10,24,1,3,0,128,12,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:10497,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,0,82,1,56,0,25,32,36,41,0,0,0,0,0,0,0],slotIdx:3}],ts:0},
  'G8':{nome:'Legatoero',volume:55,temTime:false,temRate:false,efeitos:[{slot:1,id:265,nome:'160Comp',cat:'dynamics',tap:null,enabled:true,rawSlot:[106,128,0,130,9,112,0,6,0,0,12,128,0,0,0,0,0,0],slotIdx:0},{slot:2,id:777,nome:'Drv09',cat:'drive',tap:null,enabled:false,rawSlot:[33,0,0,6,9,96,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:9228,nome:'CARDrive',cat:'amp',tap:null,enabled:false,rawSlot:[1,2,0,72,140,80,1,215,64,38,102,5,5,40,0,0,0,128],slotIdx:2},{slot:4,id:514,nome:'ParaEQ',cat:'filter',tap:null,enabled:false,rawSlot:[65,0,128,4,2,8,0,8,96,33,0,1,12,128,128,0,0,0],slotIdx:3},{slot:5,id:10497,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[32,0,0,82,1,40,0,163,0,6,12,0,128,0,0,0,0,0],slotIdx:4}],ts:0},
  'G9':{nome:'GSoloim',volume:50,temTime:true,temRate:false,efeitos:[{slot:1,id:8975,nome:'Drv0Fb',cat:'drive',tap:null,enabled:false,rawSlot:[33,0,0,70,15,56,2,100,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1039,nome:'ALIEN',cat:'amp',tap:null,enabled:false,rawSlot:[1,1,0,8,143,16,1,227,0,134,39,133,7,24,0,0,128,0],slotIdx:1},{slot:3,id:32,nome:'LongDelay',cat:'delay',tap:'Time',enabled:false,rawSlot:[23,1,0,0,160,48,133,132,128,129,129,1,12,12,0,0,0,0],slotIdx:2}],ts:0},
  'H0':{nome:'eanSpic',volume:100,temTime:false,temRate:false,efeitos:[{slot:2,id:8196,nome:'Bypass',cat:'special',tap:null,enabled:false,rawSlot:[1,0,0,64,4,104,2,17,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:4,id:1804,nome:'RtCloset',cat:'special',tap:null,enabled:true,rawSlot:[65,0,128,142,12,0,0,138,0,2,0,0,0,0,0,0,0,0],slotIdx:3}],ts:0},
  'H1':{nome:'BassSi',volume:65,temTime:false,temRate:true,efeitos:[{slot:1,id:1536,nome:'MonoPitch',cat:'pitch',tap:null,enabled:false,rawSlot:[97,2,0,12,0,16,0,100,0,3,12,128,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1540,nome:'Mod04',cat:'mod',tap:'Rate',enabled:false,rawSlot:[1,4,0,12,132,24,1,128,96,163,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:257,nome:'Comp',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,2,129,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:9233,nome:'Amp11b',cat:'amp',tap:null,enabled:false,rawSlot:[17,0,128,72,17,192,2,176,0,200,73,5,6,130,0,0,6,0],slotIdx:3}],ts:0},
  'H2':{nome:'rm',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:1041,nome:'Tangerine',cat:'amp',tap:null,enabled:true,rawSlot:[33,2,0,136,17,120,1,91,0,101,133,196,134,34,0,0,128,0],slotIdx:0},{slot:3,id:7,nome:'CabSim',cat:'amp',tap:null,enabled:false,rawSlot:[18,129,0,0,7,40,128,152,32,160,0,0,12,12,0,0,0,0],slotIdx:2},{slot:4,id:2312,nome:'Rvb08',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,8,104,0,16,64,39,108,43,192,12,128,0,0,0],slotIdx:3}],ts:0},
  'H3':{nome:'POGSH',volume:120,temTime:true,temRate:true,efeitos:[{slot:1,id:9732,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:true,rawSlot:[65,2,0,204,4,56,0,40,32,67,6,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1029,nome:'Amp05',cat:'amp',tap:null,enabled:false,rawSlot:[33,0,0,8,5,152,1,140,64,198,38,197,6,2,0,0,128,0],slotIdx:1},{slot:3,id:10508,nome:'Rvb0Cb',cat:'reverb',tap:null,enabled:false,rawSlot:[97,0,0,82,140,64,0,60,32,128,172,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:false,rawSlot:[17,0,0,80,11,72,128,178,64,1,0,47,0,0,0,0,0,0],slotIdx:3},{slot:5,id:25,nome:'CoronaTri',cat:'mod',tap:'Rate',enabled:false,rawSlot:[73,0,128,0,25,64,1,0,0,32,0,0,128,0,0,0,0,0],slotIdx:4}],ts:0},
  'H4':{nome:'PrtyVla',volume:110,temTime:false,temRate:false,efeitos:[{slot:1,id:2324,nome:'HDHall',cat:'reverb',tap:null,enabled:false,rawSlot:[17,0,0,18,20,16,2,100,0,68,8,128,0,0,0,0,128,0],slotIdx:0},{slot:2,id:263,nome:'Dyn07',cat:'dynamics',tap:null,enabled:false,rawSlot:[1,0,0,2,7,80,0,100,0,128,0,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:16,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[53,0,0,0,144,16,1,218,64,128,140,1,12,0,0,0,0,0],slotIdx:2}],ts:0},
  'H5':{nome:'avern',volume:61,temTime:false,temRate:false,efeitos:[{slot:1,id:10507,nome:'Rvb0Bb',cat:'reverb',tap:null,enabled:true,rawSlot:[33,3,0,210,11,72,2,1,96,36,32,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:48,nome:'AcoSim',cat:'special',tap:null,enabled:false,rawSlot:[69,0,0,0,48,32,3,44,0,0,0,0,12,0,0,128,0,0],slotIdx:1},{slot:3,id:9996,nome:'Spc0Cb',cat:'special',tap:null,enabled:false,rawSlot:[65,0,0,78,140,0,0,110,32,10,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:9736,nome:'Detune',cat:'pitch',tap:null,enabled:false,rawSlot:[1,1,0,76,8,48,0,164,0,1,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'H6':{nome:'PROGRE',volume:115,temTime:false,temRate:false,efeitos:[{slot:2,id:262,nome:'Dyn06',cat:'dynamics',tap:null,enabled:false,rawSlot:[1,0,0,2,6,56,0,120,0,0,0,0,0,0,0,0,0,128],slotIdx:1},{slot:3,id:10510,nome:'Rvb0Eb',cat:'reverb',tap:null,enabled:false,rawSlot:[65,1,0,82,14,24,0,196,160,194,32,3,17,0,0,0,0,0],slotIdx:2}],ts:0},
  'H7':{nome:'AP ON',volume:70,temTime:false,temRate:false,efeitos:[{slot:1,id:513,nome:'SeqFilter',cat:'filter',tap:null,enabled:true,rawSlot:[97,1,0,132,1,48,0,51,64,65,129,12,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1034,nome:'Amp0A',cat:'amp',tap:null,enabled:false,rawSlot:[97,1,0,8,10,120,1,106,0,71,102,133,6,22,0,128,128,0],slotIdx:1},{slot:3,id:40,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[111,0,0,0,40,0,1,3,32,0,0,0,0,0,128,0,0,0],slotIdx:2},{slot:4,id:2317,nome:'Rvb0D',cat:'reverb',tap:null,enabled:false,rawSlot:[97,0,128,18,13,64,0,188,32,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'H8':{nome:'PartSpe',volume:100,temTime:true,temRate:false,efeitos:[{slot:1,id:2153,nome:'Dly69',cat:'delay',tap:'Time',enabled:true,rawSlot:[17,128,128,144,105,115,0,70,64,1,128,12,0,0,0,0,0,0],slotIdx:0},{slot:2,id:2314,nome:'ParticleR',cat:'reverb',tap:null,enabled:false,rawSlot:[33,3,0,18,138,32,3,0,0,7,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:791,nome:'Drv17',cat:'drive',tap:null,enabled:false,rawSlot:[97,129,0,6,23,104,0,111,0,0,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'H9':{nome:'SacMos',volume:80,temTime:false,temRate:true,efeitos:[{slot:1,id:8449,nome:'OptComp',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,0,0,66,1,32,131,0,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:780,nome:'Drv0C',cat:'drive',tap:null,enabled:false,rawSlot:[1,1,0,6,12,88,2,100,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:25,nome:'CoronaTri',cat:'mod',tap:'Rate',enabled:false,rawSlot:[73,0,0,0,153,32,3,0,0,1,128,0,0,0,128,0,0,0],slotIdx:2},{slot:4,id:513,nome:'SeqFilter',cat:'filter',tap:null,enabled:false,rawSlot:[97,0,0,4,1,40,0,145,0,6,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'I0':{nome:'hComp Cea',volume:100,temTime:false,temRate:true,efeitos:[{slot:1,id:258,nome:'Dyn02',cat:'dynamics',tap:null,enabled:false,rawSlot:[17,0,0,2,2,48,0,100,32,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:9747,nome:'Mod13b',cat:'mod',tap:'Rate',enabled:false,rawSlot:[33,1,0,76,147,16,1,189,0,8,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:1030,nome:'FDCombo',cat:'amp',tap:null,enabled:false,rawSlot:[17,0,0,8,6,8,1,214,128,166,5,5,6,1,0,0,0,128],slotIdx:2}],ts:0},
  'I1':{nome:'@DX CRUC',volume:100,temTime:true,temRate:false,efeitos:[{slot:1,id:9234,nome:'Amp12b',cat:'amp',tap:null,enabled:false,rawSlot:[33,0,0,72,18,40,1,60,0,37,7,6,133,2,0,0,0,0],slotIdx:0},{slot:2,id:10345,nome:'Dly69b',cat:'delay',tap:'Time',enabled:false,rawSlot:[16,128,0,80,105,99,0,168,128,0,0,44,0,0,0,0,128,128],slotIdx:1},{slot:3,id:10498,nome:'Hall',cat:'reverb',tap:null,enabled:false,rawSlot:[1,1,0,82,130,72,0,20,64,13,128,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'I2':{nome:'@TEXAS ON',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:769,nome:'Drv01',cat:'drive',tap:null,enabled:true,rawSlot:[64,128,0,134,1,0,2,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:9230,nome:'USBlues',cat:'amp',tap:null,enabled:false,rawSlot:[65,0,0,72,142,112,0,203,64,70,70,133,6,4,0,128,128,128],slotIdx:1},{slot:3,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[1,1,0,18,130,80,0,30,0,12,128,0,0,0,128,0,0,0],slotIdx:2},{slot:4,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[97,0,128,18,2,48,0,49,32,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'I3':{nome:'NASHVILE',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:256,nome:'Dyn00',cat:'dynamics',tap:null,enabled:true,rawSlot:[17,0,0,130,0,48,0,100,32,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1034,nome:'Amp0A',cat:'amp',tap:null,enabled:false,rawSlot:[97,0,0,8,138,112,1,116,32,4,70,229,2,6,0,0,0,128],slotIdx:1},{slot:3,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[1,129,0,18,130,40,0,24,0,12,128,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'I4':{nome:'MERSEYET',volume:100,temTime:false,temRate:true,efeitos:[{slot:1,id:1029,nome:'Amp05',cat:'amp',tap:null,enabled:false,rawSlot:[1,0,0,8,5,64,129,118,96,228,70,166,4,8,0,0,128,0],slotIdx:0},{slot:2,id:1548,nome:'SuperCho',cat:'mod',tap:'Rate',enabled:false,rawSlot:[33,129,0,12,12,16,1,178,64,134,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:10497,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[1,129,0,82,129,112,0,41,0,12,128,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'I5':{nome:'WHITEBUE',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:788,nome:'Amp',cat:'amp',tap:null,enabled:false,rawSlot:[16,128,0,6,20,16,1,2,0,0,0,0,0,128,0,0,128,0],slotIdx:0},{slot:2,id:9235,nome:'Amp13b',cat:'amp',tap:null,enabled:true,rawSlot:[33,1,0,200,147,112,0,215,32,69,69,198,5,26,0,0,0,0],slotIdx:1},{slot:3,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,66,128,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:10496,nome:'Rvb00b',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,82,0,96,0,143,64,39,108,11,128,12,128,0,0,0],slotIdx:3}],ts:0},
  'I6':{nome:'BRGHT',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8984,nome:'Drv18b',cat:'drive',tap:null,enabled:false,rawSlot:[17,128,0,70,24,96,0,124,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:9233,nome:'Amp11b',cat:'amp',tap:null,enabled:true,rawSlot:[33,0,0,200,17,40,1,97,64,164,104,197,5,10,0,128,0,0],slotIdx:1},{slot:3,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,66,128,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'I7':{nome:'xCACOMO',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8983,nome:'Drv17b',cat:'drive',tap:null,enabled:false,rawSlot:[16,128,0,70,23,16,1,127,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1044,nome:'MSDrive',cat:'amp',tap:null,enabled:false,rawSlot:[65,0,0,8,20,112,0,208,96,198,101,167,7,12,0,128,0,0],slotIdx:1},{slot:3,id:257,nome:'Comp',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,2,129,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false,rawSlot:[61,0,0,0,8,0,3,3,32,0,0,0,0,0,0,0,0,0],slotIdx:3},{slot:5,id:10498,nome:'Hall',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,0,82,2,40,0,159,32,1,12,0,128,0,0,0,0,0],slotIdx:4}],ts:0},
  'I8':{nome:'BTQ COO',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:9230,nome:'USBlues',cat:'amp',tap:null,enabled:true,rawSlot:[1,1,0,200,14,72,1,67,96,68,70,38,135,16,0,0,128,0],slotIdx:0},{slot:2,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,66,0,0,0,100,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:2324,nome:'HDHall',cat:'reverb',tap:null,enabled:false,rawSlot:[17,0,0,18,20,104,1,20,0,4,5,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'I9':{nome:'ROCK T',volume:100,temTime:true,temRate:false,efeitos:[{slot:1,id:9225,nome:'Amp09b',cat:'amp',tap:null,enabled:true,rawSlot:[33,1,0,200,9,40,2,72,96,165,38,199,135,18,0,0,128,0],slotIdx:0},{slot:2,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,66,0,0,0,100,0,128,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:false,rawSlot:[161,128,0,80,11,32,0,12,32,128,172,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'J0':{nome:'FuzzOrge',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:772,nome:'Drv04',cat:'drive',tap:null,enabled:false,rawSlot:[1,1,0,6,4,8,2,40,0,0,0,0,0,0,0,0,128,0],slotIdx:0},{slot:2,id:1041,nome:'Tangerine',cat:'amp',tap:null,enabled:false,rawSlot:[1,1,0,8,145,112,1,197,32,197,102,197,6,24,0,128,128,0],slotIdx:1},{slot:3,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,66,128,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:10498,nome:'Room',cat:'reverb',tap:null,enabled:false,rawSlot:[65,0,128,82,2,64,0,60,0,0,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'J1':{nome:'OCTAVEMS',volume:100,temTime:false,temRate:false,efeitos:[{slot:2,id:1041,nome:'Tangerine',cat:'amp',tap:null,enabled:false,rawSlot:[97,1,0,8,17,112,0,218,64,198,70,198,6,30,0,0,0,0],slotIdx:1},{slot:3,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,66,128,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:2307,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false,rawSlot:[65,0,0,18,3,48,0,37,32,1,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'J2':{nome:'REVERSH',volume:100,temTime:false,temRate:false,efeitos:[{slot:2,id:1031,nome:'Matchless',cat:'amp',tap:null,enabled:false,rawSlot:[97,1,0,8,135,32,0,243,64,228,38,200,4,22,0,128,0,128],slotIdx:1},{slot:3,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,2,32,129,29,192,39,12,7,0,12,0,0,0,0],slotIdx:2}],ts:0},
  'J3':{nome:'Guitor',volume:110,temTime:false,temRate:false,efeitos:[{slot:1,id:1024,nome:'Amp00',cat:'amp',tap:null,enabled:false,rawSlot:[97,0,0,8,0,48,130,100,32,72,134,7,10,14,0,0,128,0],slotIdx:0},{slot:2,id:1807,nome:'Spc0F',cat:'special',tap:null,enabled:false,rawSlot:[65,128,0,14,15,8,0,100,64,1,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:10498,nome:'Room',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,0,82,2,64,0,51,0,230,48,0,0,0,0,0,0,0],slotIdx:2}],ts:0},
  'J4':{nome:'PHASE Y',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1537,nome:'HPS',cat:'pitch',tap:null,enabled:false,rawSlot:[97,0,0,12,1,8,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1045,nome:'BGNDrive',cat:'amp',tap:null,enabled:true,rawSlot:[65,1,0,136,21,80,1,185,32,104,102,164,6,20,0,0,128,0],slotIdx:1},{slot:3,id:8448,nome:'Dyn00b',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,66,128,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,2,72,0,40,64,39,108,11,128,12,128,0,0,0],slotIdx:3}],ts:0},
  'J5':{nome:'MS FLAG',volume:100,temTime:false,temRate:false,efeitos:[{slot:2,id:9235,nome:'Amp13b',cat:'amp',tap:null,enabled:false,rawSlot:[1,2,0,72,19,112,0,211,0,197,6,166,6,32,0,128,128,0],slotIdx:1},{slot:3,id:8449,nome:'OptComp',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,66,129,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:2},{slot:4,id:10498,nome:'Hall',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,128,82,2,8,0,18,32,1,12,0,0,0,0,128,0,0],slotIdx:3}],ts:0},
  'J6':{nome:'DZ HEAY',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:9226,nome:'Amp0Ab',cat:'amp',tap:null,enabled:true,rawSlot:[97,130,0,200,10,112,0,90,96,6,102,38,6,38,0,0,128,0],slotIdx:0},{slot:2,id:257,nome:'Comp',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,128,0,2,1,0,0,100,0,0,0,0,0,0,0,0,0,0],slotIdx:1},{slot:3,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false,rawSlot:[33,1,0,18,2,96,128,17,192,39,108,11,0,12,0,0,0,0],slotIdx:2}],ts:0},
  'J7':{nome:'LA LEA',volume:90,temTime:true,temRate:false,efeitos:[{slot:1,id:8980,nome:'Drv14b',cat:'drive',tap:null,enabled:true,rawSlot:[17,128,0,198,20,80,0,103,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:9234,nome:'Amp12b',cat:'amp',tap:null,enabled:true,rawSlot:[33,2,0,200,18,120,0,100,32,69,6,197,7,38,0,128,0,0],slotIdx:1},{slot:3,id:8710,nome:'Flt06b',cat:'filter',tap:null,enabled:false,rawSlot:[65,0,0,68,6,16,0,144,128,130,128,0,12,0,0,0,0,0],slotIdx:2},{slot:4,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:false,rawSlot:[17,0,128,80,11,40,129,168,32,0,0,44,0,0,128,0,0,0],slotIdx:3},{slot:5,id:10500,nome:'TiledRoom',cat:'reverb',tap:null,enabled:false,rawSlot:[33,0,0,82,4,80,0,166,224,1,12,0,128,0,0,0,0,0],slotIdx:4}],ts:0},
  'J8':{nome:'7strBo',volume:63,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:false,rawSlot:[33,0,0,66,2,8,128,100,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:514,nome:'ParaEQ',cat:'filter',tap:null,enabled:false,rawSlot:[65,0,0,4,130,0,0,8,64,33,32,0,12,0,0,128,128,0],slotIdx:1},{slot:3,id:1035,nome:'Amp0B',cat:'amp',tap:null,enabled:false,rawSlot:[65,2,0,8,11,120,1,225,0,72,230,38,8,36,0,0,0,128],slotIdx:2}],ts:0},
  'J9':{nome:'Power ea',volume:56,temTime:true,temRate:false,efeitos:[{slot:1,id:258,nome:'Dyn02',cat:'dynamics',tap:null,enabled:false,rawSlot:[65,0,0,2,2,32,131,0,0,0,0,0,0,0,0,0,0,0],slotIdx:0},{slot:2,id:1030,nome:'FDCombo',cat:'amp',tap:null,enabled:true,rawSlot:[17,0,0,136,6,112,0,214,0,38,5,5,6,0,0,128,128,0],slotIdx:1},{slot:3,id:10499,nome:'Rvb03b',cat:'reverb',tap:null,enabled:false,rawSlot:[65,128,0,82,3,64,0,60,0,128,12,0,0,0,128,0,0,0],slotIdx:2},{slot:4,id:2062,nome:'Dly0E',cat:'delay',tap:'Time',enabled:false,rawSlot:[1,1,0,16,14,128,1,231,1,0,0,32,0,128,0,0,0,0],slotIdx:3}],ts:0},
};

// ══════════════════════════════════════════════════════════════════
// §5 — Sistema de memória em 4 camadas
// ══════════════════════════════════════════════════════════════════
function criarEstadoPadrao(){ return {bank:'A',patch:0,bpm:120,bankGroup:0}; }
let cam0 = criarEstadoPadrao();
function salvarCamada(n,d){try{localStorage.setItem(`fmc_cam${n}`,JSON.stringify(d));contarEscrita();}catch(e){}}
function lerCamada(n){try{const s=localStorage.getItem(`fmc_cam${n}`);return s?JSON.parse(s):null;}catch(e){return null;}}
function gravarEstado(){const s={bank:cam0.bank,patch:cam0.patch,bpm:cam0.bpm,bankGroup:cam0.bankGroup};salvarCamada(1,s);salvarCamada(2,s);salvarCamada(3,s);}
function carregarEstado(){
  for(let n=1;n<=3;n++){const d=lerCamada(n);if(d&&d.bank&&BANKS_ALL.includes(d.bank)){cam0={...criarEstadoPadrao(),...d};return;}}
  cam0=criarEstadoPadrao();
}
setInterval(()=>{
  const c=lerCamada(1);if(!c){gravarEstado();return;}
  if(c.bank!==cam0.bank||c.patch!==cam0.patch||c.bpm!==cam0.bpm||c.bankGroup!==cam0.bankGroup){
    gravarEstado();
    const el=document.getElementById('memStatus');
    if(el){el.textContent='SYNC!';setTimeout(()=>el.textContent='MEM OK',800);}
  }
},MEM_CHECK_MS);

// ══════════════════════════════════════════════════════════════════
// §5c — Contador de ciclos de escrita (saúde da flash/storage)
//
// Conta quantas vezes o FMC-AM 6F escreveu no localStorage.
// Útil para estimar desgaste em dispositivos com flash limitada
// (ex: Raspberry Pi Pico ~100.000 ciclos por célula).
//
// Chave: fmc_write_cycles
// Estrutura: { total, porSessao, primeiraSessao, ultimaSessao }
// ══════════════════════════════════════════════════════════════════
let _ciclosBuffer = 0;        // acumula escritas em RAM antes de persistir
let _ciclosFlushTimer = null; // debounce — persiste a cada 30s

function carregarCiclos(){
  try{
    const raw = localStorage.getItem('fmc_write_cycles');
    return raw ? JSON.parse(raw) : {total:0, sessoes:0, primeiraSessao:null, ultimaSessao:null};
  } catch(e){ return {total:0, sessoes:0, primeiraSessao:null, ultimaSessao:null}; }
}

function contarEscrita(){
  // Incrementa apenas o buffer em RAM — não grava a cada write (evita loop)
  _ciclosBuffer++;
  if(_ciclosFlushTimer) clearTimeout(_ciclosFlushTimer);
  _ciclosFlushTimer = setTimeout(persistirCiclos, 30000); // persiste após 30s de inatividade
}

function persistirCiclos(){
  if(_ciclosBuffer === 0) return;
  try{
    const dados = carregarCiclos();
    const agora = new Date().toISOString();
    dados.total       += _ciclosBuffer;
    dados.ultimaSessao = agora;
    if(!dados.primeiraSessao) dados.primeiraSessao = agora;
    // Esta escrita NÃO chama contarEscrita() — evita loop infinito
    localStorage.setItem('fmc_write_cycles', JSON.stringify(dados));
    _ciclosBuffer = 0;
    atualizarDisplaySaude(dados);
  } catch(e){}
}

function lerEstatisticasCiclos(){
  const dados = carregarCiclos();
  dados.total += _ciclosBuffer; // inclui buffer não persistido
  return dados;
}

function atualizarDisplaySaude(dados){
  const el = document.getElementById('flashHealth');
  if(!el) return;
  // Estimativa de saúde baseada em 100.000 ciclos como referência
  const REF = 100000;
  const pct  = Math.min(100, Math.round((dados.total / REF) * 100));
  const cor  = pct < 50 ? '#00ff66' : pct < 80 ? '#ffaa00' : '#ff2244';
  el.textContent  = `${dados.total.toLocaleString()} escritas (${pct}% ref. 100k)`;
  el.style.color  = cor;
}

// Inicia a sessão — incrementa contador de sessões
function iniciarContadorCiclos(){
  try{
    const dados = carregarCiclos();
    const agora = new Date().toISOString();
    dados.sessoes = (dados.sessoes || 0) + 1;
    dados.ultimaSessao = agora;
    if(!dados.primeiraSessao) dados.primeiraSessao = agora;
    localStorage.setItem('fmc_write_cycles', JSON.stringify(dados));
    atualizarDisplaySaude(dados);
    // Persiste ciclos acumulados ao fechar/recarregar página
    window.addEventListener('beforeunload', persistirCiclos);
  } catch(e){}
}

// ══════════════════════════════════════════════════════════════════
// §5b — Cache de patches A0–J9 (100 patches, 3 camadas)
//
// Estrutura: objeto com chaves "A0".."J9"
//   { nome, volume, efeitos, temTime, temRate, ts }
//
// OFFSET DE VOLUME CONFIRMADO via análise do dump real:
//   byte[110] = Patch Output Volume (0–120, default=100)
//   Confirmado por teste controlado (dump4 com volumes anotados)
//
// Estratégia:
//   1. Ao navegar → busca no cache e exibe imediatamente
//   2. Dump chega → compara → só grava se mudou
//   3. 3 cópias redundantes para proteção contra corrupção
//   4. Debounce de 2s para evitar escritas em rajada
// ══════════════════════════════════════════════════════════════════
const VOL_OFFSET   = 110;  // byte[110] = Patch Output Volume (0-120)
                            // Confirmado: dump4 (100 patches, 13/14 acertos nos valores anotados)
                            // byte[14] era ERRADO — capturava o Level do efeito no slot1
const VOL_DEFAULT  = 100;  // valor padrão da G1On
const VOL_MAX      = 120;  // teto da escala
const BOOST_DELTA  = 10;   // +10 unidades como boost inicial (calibrável)

const CACHE_KEY = n => `fmc_pcache${n}`;
let patchCache = {};
let cacheDirty = false;
let cacheTimer  = null;

function limparCachePatches(){
  // 1. Cancela qualquer gravação pendente antes de apagar
  if(cacheTimer){ clearTimeout(cacheTimer); cacheTimer=null; }
  // 2. Apaga as 3 camadas no localStorage
  for(let n=1;n<=3;n++) try{ localStorage.removeItem(CACHE_KEY(n)); }catch(e){}
  // 3. Zera cache em memória e carrega seed limpo
  patchCache = {};
  Object.keys(PATCH_CACHE_SEED).forEach(k => {
    patchCache[k] = Object.assign({}, PATCH_CACHE_SEED[k]);
  });
  cacheDirty = false; // seed não precisa ser regravado imediatamente
  // 4. Limpa estado do patch atual completamente
  limparPatchAtual();
  // 5. Aplica seed do patch atual no display
  aplicarCacheSeDisponivel(cam0.bank, cam0.patch);
  // 6. Força re-render visual completo
  renderizar();
  // 7. Atualiza labels de todos os botões com nomes do seed
  // Atualiza labels no modo correto
  if(FS_MODE === 12){
    for(let i=0;i<10;i++){
      const cached = lerCachePatch(cam0.bank, i);
      if(labelEls[i] && cached) labelEls[i].textContent = (cached.nome||'').substring(0,10);
    }
  } else {
    for(let i=0;i<5;i++){
      const base=i*2;
      const cached = lerCachePatch(cam0.bank, base);
      if(labelEls[i] && cached) labelEls[i].textContent = (cached.nome||'').substring(0,9);
    }
  }
  // 8. Força dump real da pedaleira (se conectada) após um momento
  if(midiOut&&midiReady) setTimeout(requisitarDump, 300);
  showToast('CACHE LIMPO · SEED RECARREGADO');
}

function carregarCache(){
  for(let n=1; n<=3; n++){
    try{
      const raw = localStorage.getItem(CACHE_KEY(n));
      if(!raw) continue;
      const obj = JSON.parse(raw);
      if(obj && typeof obj === 'object' && Object.keys(obj).length > 0){
        patchCache = obj;
        return;
      }
    } catch(e){}
  }
  // Cache vazio — usa seed com dados reais do full dump
  patchCache = Object.assign({}, PATCH_CACHE_SEED);
  cacheDirty = true; // persiste o seed no próximo ciclo
  agendarGravacaoCache();
}

function gravarCache(){
  if(!cacheDirty) return;
  const json = JSON.stringify(patchCache);
  for(let n=1; n<=3; n++){
    try{ localStorage.setItem(CACHE_KEY(n), json); contarEscrita(); } catch(e){}
  }
  cacheDirty = false;
}

function agendarGravacaoCache(){
  if(cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(gravarCache, 2000);
}

function patchKey(bank, patch){ return `${bank}${patch}`; }
function lerCachePatch(bank, patch){ return patchCache[patchKey(bank, patch)] || null; }

function gravarCachePatch(bank, patch, info){
  const key = patchKey(bank, patch);
  const novo = {
    nome:    info.nome    || '',
    volume:  info.volume  ?? VOL_DEFAULT,  // byte[110] = Patch Output Volume
    efeitos: info.efeitos || [],
    temTime: info.temTime || false,
    temRate: info.temRate || false,
    ts:      Date.now(),
  };
  const atual = patchCache[key];
  const mudou = !atual
    || atual.nome    !== novo.nome
    || atual.volume  !== novo.volume
    || atual.temTime !== novo.temTime
    || atual.temRate !== novo.temRate
    || JSON.stringify(atual.efeitos) !== JSON.stringify(novo.efeitos);
  if(mudou){
    patchCache[key] = novo;
    cacheDirty = true;
    agendarGravacaoCache();
  }
}

// ── Extrai volume do dump raw ────────────────────────────────────
function extrairVolumeDump(rawData){
  if(!rawData || rawData.length <= VOL_OFFSET) return VOL_DEFAULT;
  const v = rawData[VOL_OFFSET];
  return (v >= 0 && v <= VOL_MAX) ? v : VOL_DEFAULT;
}

// ══════════════════════════════════════════════════════════════════
// §6 — Boost de Volume
//
// Aumenta o Output Level do patch atual em +BOOST_DELTA unidades,
// limitado a VOL_MAX (120). Envia via SysEx Param Set.
//
// Param ID do Output Level: 0x0A 0x02 (confirmado via doc G2.1Nu)
// Formato: F0 52 00 63 31 0A 02 [lsb] [msb] F7
//
// Escala 0–120 da G1On: sem offset, lsb = vol & 0x7F, msb = (vol>>7)&0x7F
// (120 → lsb=0x78 msb=0x00)
//
// NOTA: A relação exata entre as 120 unidades e dB depende do firmware.
// Referência documentada G2.1Nu: "setting master patch level to 50 is
// F0 52 00 4D 31 0A 02 18 00 F7" → 50 decimal = 0x32, mas byte=0x18=24?
// ATENÇÃO: pode haver encoding diferente do BPM. A confirmar com teste real.
// Por segurança, BOOST_DELTA=10 é conservador (max headroom sem clipar).
// ══════════════════════════════════════════════════════════════════
let boostAtivo = false;

let boostVolBase = null;  // volume salvo no momento da ativação do boost

async function toggleBoost(){
  const cached = lerCachePatch(cam0.bank, cam0.patch);
  const volBase = patchAtual.volume ?? cached?.volume ?? VOL_DEFAULT;

  if(boostAtivo){
    // Desativa — restaura o volume salvo na ativação (não o atual, que pode ter mudado)
    const volRestaurar = boostVolBase ?? volBase;
    await enviarVolumePatch(volRestaurar);
    boostAtivo = false;
    boostVolBase = null;
    showToast(`BOOST OFF · VOL ${volRestaurar}`);
  } else {
    // Ativa — sobe BOOST_DELTA, capped em VOL_MAX
    const volBoost = Math.min(VOL_MAX, volBase + BOOST_DELTA);
    if(volBoost <= volBase){
      showToast(`VOL JÁ NO MÁXIMO (${volBase})`);
      return;
    }
    boostVolBase = volBase;  // salva o volume original antes de alterar
    await enviarVolumePatch(volBoost);
    boostAtivo = true;
    showToast(`BOOST ON · ${volBase} → ${volBoost} (+${volBoost-volBase})`);
  }
  atualizarBotaoBoost();
}

async function enviarVolumePatch(vol){
  if(!midiOut || !midiReady) return;
  const lsb = vol & 0x7F;
  const msb = (vol >> 7) & 0x7F;
  await garantirEditor();
  enviarMIDI(
    [0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM, 0x0A, 0x02, lsb, msb, 0xF7],
    'sx', `VOL=${vol}`
  );
  await sleep(SYSEX_DELAY);
  // Sem fecharEditor
}

function atualizarBotaoBoost(){
  const btn = document.getElementById('boostBtn');
  if(!btn) return;
  btn.classList.toggle('boost-on', boostAtivo);
  btn.textContent = boostAtivo ? '⬆ BOOST ON' : '⬆ BOOST';
}

// ── Display de volume ─────────────────────────────────────────────
// Mostra o volume do patch atual em tempo real
// Atualizado a cada dump recebido (inclusive troca física na pedaleira)
function atualizarDisplayVolume(vol){
  const el = document.getElementById('patchVolume');
  if(!el) return;
  if(vol === null || vol === undefined){
    el.textContent = '---';
    el.style.opacity = '0.35';
  } else {
    el.textContent = `VOL ${vol}`;
    // Cor: vermelho se muito baixo, amarelo se moderado, normal se alto
    el.style.opacity = '1';
    if(vol === 0)          el.style.color = '#ff2244';
    else if(vol < 30)      el.style.color = '#ffaa00';
    else if(vol >= 110)    el.style.color = '#00ff66';
    else                   el.style.color = '';
  }
}

// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
// Parser do Dump 0x28 — fw 1.21 (confirmado dump3 + dump6)
// ──────────────────────────────────────────────────────────────────
// O stream após byte[5] é um único bloco 7-bit SysEx packed:
//   grupos de 8 bytes físicos → 7 bytes reais (1 MSBs + 7 dados)
// Após desempacotar, cada slot ocupa 18 bytes reais:
//   [0..2]  header 0x11 0x00 0x00
//   [3]     (enabled<<7) | id_high
//   [4]     id_low
//   [5..17] parâmetros do efeito
// ID  = ((up[3]&0x7F)<<7) | (up[4]&0x7F)
// EN  = (up[3]>>7) & 1
// r2  = up[5]  ← discriminador para módulos SHARED
// VOL = byte[110] do dump BRUTO (sem desempacotar)
// ══════════════════════════════════════════════════════════════════
let patchAtual = {nome:null,volume:null,efeitos:[],temTime:false,temRate:false,precisaSincBpm:false,efeitosTime:[],efeitosRate:[]};

function unpack7bitStream(data, start){
  const out = [];
  let i = start;
  while(i < data.length - 1){
    const msbs = data[i++];
    for(let bit=0; bit<7; bit++,i++){
      if(i >= data.length) break;
      out.push(data[i] | (((msbs>>bit)&1)<<7));
    }
  }
  return out;
}

function decode7bitNome(data, offset, len){
  const chars = [];
  let i = offset;
  while(i < offset + len && i < data.length - 1){
    const msbs = data[i++];
    for(let bit=0; bit<7 && i<data.length-1 && chars.length<12; bit++,i++){
      const b = data[i] | (((msbs>>bit)&1)<<7);
      if(b === 0) continue;
      if(b >= 0x20 && b < 0x7F) chars.push(String.fromCharCode(b));
    }
  }
  return chars.join('').trim();
}

function parseZoomDump(data){
  if(!data||data.length<10) return null;
  if(data[0]!==0xF0||data[1]!==ZOOM_MFR||data[4]!==CMD_DUMP_RES) return null;

  const info = {nome:'', volume:VOL_DEFAULT, efeitos:[], bytesTotal:data.length};

  // Nome — bytes[112..] do dump bruto
  info.nome = decode7bitNome(data, 112, 21);

  // Volume — byte[110] do dump bruto (confirmado dump4)
  info.volume = extrairVolumeDump(data);

  // Desempacotar stream 7-bit a partir do byte[5]
  const up = unpack7bitStream(data, 5);
  const SLOT_SIZE = 18;

  const SHARED = {
    [0x0201]:{0x40:'Cry',        0x30:'SeqFilter',
              _c:{Cry:'filter',   SeqFilter:'filter'}, _t:{}},
    [0x2102]:{0x08:'ZNR',        0x20:'NoiseGate',
              _c:{ZNR:'dynamics', NoiseGate:'dynamics'}, _t:{}},
    [0x060A]:{0x10:'BendChorus', 0x40:'Chorus', 0x68:'Ensemble', 0x70:'Vibrato',
              _c:{BendChorus:'mod',Chorus:'mod',Ensemble:'mod',Vibrato:'mod'},
              _t:{BendChorus:'Rate',Chorus:'Rate',Ensemble:'Rate',Vibrato:'Rate'}},
    [0x0614]:{0x08:'Tremolo',    0x68:'StereCho', 0x78:'Octave',
              _c:{Tremolo:'mod',  StereCho:'mod',  Octave:'pitch'},
              _t:{Tremolo:'Rate', StereCho:'Rate', Octave:null}},
    [0x0600]:{0x30:'MonoPitch',  0x40:'Slicer',
              _c:{MonoPitch:'pitch', Slicer:'special'}, _t:{}},
    [0x2606]:{0x20:'CoronaRing', 0x50:'RingMod',  0x60:'TheVibe',
              _c:{CoronaRing:'mod', RingMod:'mod', TheVibe:'mod'},
              _t:{CoronaRing:'Rate',RingMod:'Rate',TheVibe:'Rate'}},
    [0x2902]:{0x28:'Hall',       0x40:'Room',
              _c:{Hall:'reverb',  Room:'reverb'}, _t:{}},
    [0x2904]:{0x20:'TiledRoom',  0x40:'Air',
              _c:{Air:'reverb',   TiledRoom:'reverb'}, _t:{}},
    [0x0903]:{0x20:'EarlyRef',   0x38:'Arena',
              _c:{EarlyRef:'reverb', Arena:'reverb'}, _t:{}},
  };

  for(let i=0; i<5; i++){
    const off = i * SLOT_SIZE;
    if(off + 5 >= up.length) break;
    const b3  = up[off+3];
    const b4  = up[off+4];
    const r2  = up[off+5];
    const id2 = ((b3 & 0x7F) << 7) | (b4 & 0x7F);
    const en  = ((b3 >> 7) & 1) === 1;
    if(id2 === 0) continue; // skip empty slots unconditionally
    let fx;
    if(SHARED[id2]){
      const disc = SHARED[id2];
      const nome_disc = disc[r2] ||
        Object.entries(disc).find(([k,v])=>typeof v==='string'&&!k.startsWith('_'))?.[1] ||
        `FX_${id2.toString(16).toUpperCase()}`;
      fx = {n:nome_disc, c:(disc._c||{})[nome_disc]||'unknown', t:(disc._t||{})[nome_disc]||null};
    } else {
      fx = ZOOM_FX_DB[id2]||{n:`FX_${id2.toString(16).toUpperCase()}`,c:'unknown',t:null};
    }
    const rawSlot = up.slice(off, off + SLOT_SIZE);
    info.efeitos.push({slot:i+1, id:id2, nome:fx.n, cat:fx.c, tap:fx.t, enabled:en, rawSlot, slotIdx:i});
  }

  return info;
}
function aplicarDump(info){
  if(!info) return;
  patchAtual.nome         = info.nome||null;
  patchAtual.volume       = info.volume ?? VOL_DEFAULT;
  patchAtual.efeitos      = info.efeitos;
  patchAtual.efeitosTime  = info.efeitos.filter(e=>e.tap==='Time');
  patchAtual.efeitosRate  = info.efeitos.filter(e=>e.tap==='Rate');
  patchAtual.temTime      = patchAtual.efeitosTime.length>0;
  patchAtual.temRate      = patchAtual.efeitosRate.length>0;
  patchAtual.precisaSincBpm = patchAtual.temTime||patchAtual.temRate;
  atualizarFxIndicators();
  atualizarDisplayVolume(patchAtual.volume);
  const tapBtn = fsEls[FS_IDX_TAP];
  tapBtn.classList.toggle('delay-sync', patchAtual.temTime);
  tapBtn.classList.toggle('rate-sync', !patchAtual.temTime&&patchAtual.temRate);
  if(patchAtual.nome) document.getElementById('patchName').textContent = patchAtual.nome;
  // Reseta boost ao trocar patch
  boostAtivo = false;
  boostVolBase = null;
  atualizarBotaoBoost();
  // Reseta tuner ao trocar patch
  if(tunerAtivo){
    tunerAtivo = false;
    try{ if(midiOut&&midiReady){
      midiOut.send([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, 0x03, 0x43, 0xF7]);
      setTimeout(()=>{ try{ midiOut.send([0xB0|MIDI_CH, 0x4A, 0x00]); }catch(e){} }, 80);
    }} catch(e){}
    atualizarVisualTuner();
  }
  // Persiste no cache
  gravarCachePatch(cam0.bank, cam0.patch, patchAtual);
}

function atualizarFxIndicators(){
  const el = document.getElementById('fxIndicators');
  if(!el) return;
  el.innerHTML='';
  for(const fx of patchAtual.efeitos){
    const t=document.createElement('span');
    t.className=`fx-tag ${fx.cat}${fx.enabled?'':' off'}`;
    t.textContent=fx.nome.substring(0,7);
    el.appendChild(t);
  }
}

function limparPatchAtual(){
  patchAtual.nome=null; patchAtual.volume=null; patchAtual.efeitos=[];
  patchAtual.temTime=false; patchAtual.temRate=false;
  patchAtual.precisaSincBpm=false;
  patchAtual.efeitosTime=[]; patchAtual.efeitosRate=[];
  tapRawDump = null;  // invalida dump ao trocar patch
  const fi=document.getElementById('fxIndicators'); if(fi) fi.innerHTML='';
  fsEls[FS_IDX_TAP].classList.remove('delay-sync','rate-sync');
  atualizarDisplayVolume(null);
  boostAtivo = false;
  boostVolBase = null;
  atualizarBotaoBoost();
}

function aplicarCacheSeDisponivel(bank, patch){
  // Busca no cache — exibe instantaneamente sem esperar o dump
  const cached = lerCachePatch(bank, patch);
  if(!cached || !cached.nome) return false;
  patchAtual.nome          = cached.nome;
  patchAtual.volume        = cached.volume ?? null;  // volume do cache (seed/dump anterior)
  patchAtual.efeitos       = cached.efeitos || [];
  patchAtual.efeitosTime   = patchAtual.efeitos.filter(e=>e.tap==='Time');
  patchAtual.efeitosRate   = patchAtual.efeitos.filter(e=>e.tap==='Rate');
  patchAtual.temTime       = patchAtual.efeitosTime.length > 0;
  patchAtual.temRate       = patchAtual.efeitosRate.length > 0;
  patchAtual.precisaSincBpm = patchAtual.temTime || patchAtual.temRate;
  atualizarFxIndicators();
  atualizarDisplayVolume(patchAtual.volume);
  const tapBtn2 = fsEls[FS_IDX_TAP];
  tapBtn2.classList.toggle('delay-sync', patchAtual.temTime);
  tapBtn2.classList.toggle('rate-sync', !patchAtual.temTime&&patchAtual.temRate);
  // Atualiza nome no display imediatamente
  const el = document.getElementById('patchName');
  if(el) el.textContent = cached.nome;
  return true;
}

// ══════════════════════════════════════════════════════════════════
// MIDI — helpers
// ══════════════════════════════════════════════════════════════════
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let midiAccess=null, midiOut=null, midiReady=false, g1onDetectada=false;
let dumpTimer=null, sysexIdleTimer=null, indicadorTimer=null;
let midiBuffer=[], midiFlushTimer=null;
const ZOOM_KEYWORDS = ['zoom','g1on','g1xon','g1'];

function nomeContemZoom(nome){ return ZOOM_KEYWORDS.some(k=>(nome||'').toLowerCase().includes(k)); }

function enviarMIDI(bytes,tipo,label){
  logMIDI({type:tipo||'sx',label});
  if(!midiOut||!midiReady) return;
  try{ midiOut.send(bytes); }
  catch(e){ logMIDI({type:'err',label:`TX ERR: ${e.message}`}); }
}

function logMIDI(msg){ piscarIndicador(); }

function piscarIndicador(){
  const el=document.getElementById('midiIndicator');
  if(!el) return;
  el.classList.add('activity');
  if(indicadorTimer) clearTimeout(indicadorTimer);
  indicadorTimer=setTimeout(()=>{
    el.classList.remove('activity');
    el.className='midi-indicator '+(midiReady?'connected':'sim');
  },120);
}

function setMidiStatus(label,state){
  const el=document.getElementById('midiIndicator');
  const lb=document.getElementById('midiPortLabel');
  if(el) el.className=`midi-indicator ${state}`;
  if(lb) lb.textContent=label;
}
function truncar(s){ return s&&s.length>16?s.substring(0,14)+'…':s; }

// ── Protocolo Zoom G1On (confirmado fw 1.21, model 0x63) ────────
// BPM: F0 52 00 63 31 0A 07 [lsb] [msb] F7
//   encoding: lsb=bpm&0x7F, msb=(bpm>>7)&0x7F  (SEM offset)
//
// ESTRATÉGIA DE EDITOR:
// - garantirEditor(): verifica flag antes de abrir — para dump/volume
// - forcarEditor(): SEMPRE reenvia EDIT ON — para tap tempo
//   (tap precisa garantia absoluta pois o editor pode ter expirado
//    silenciosamente na pedaleira sem o JS saber)
// ────────────────────────────────────────────────────────────────
let editorAberto = false;
let editorTimer  = null;

async function garantirEditor(){
  if(editorAberto) return;
  if(!midiOut||!midiReady) return;
  enviarMIDI([0xF0,0x7E,0x00,0x06,0x01,0xF7],'sx','IDENTITY REQ');
  await sleep(80);
  enviarMIDI([0xF0,ZOOM_MFR,ZOOM_DEV,ZOOM_MODEL,CMD_EDIT_ON,0xF7],'sx','EDIT ON');
  await sleep(SYSEX_DELAY);
  enviarMIDI([0xF0,ZOOM_MFR,ZOOM_DEV,ZOOM_MODEL,0x33,0xF7],'sx','EDITOR PING');
  await sleep(SYSEX_DELAY);
  editorAberto = true;
  reiniciarWatchdogEditor();
}

async function forcarEditor(){
  // Preamble completo conforme documentação G2.1Nu (compatível G1On fw 1.21):
  //   1. F0 7E 00 06 01 F7        — Identity Request
  //   2. F0 52 00 63 50 F7        — Edit ON
  //   3. F0 52 00 63 33 F7        — Editor Ping (confirma modo editor)
  // Sem os 3, a G1On pode ignorar comandos de parâmetro subsequentes
  if(!midiOut||!midiReady) return;
  enviarMIDI([0xF0,0x7E,0x00,0x06,0x01,0xF7],'sx','IDENTITY REQ');
  await sleep(80);
  enviarMIDI([0xF0,ZOOM_MFR,ZOOM_DEV,ZOOM_MODEL,CMD_EDIT_ON,0xF7],'sx','EDIT ON');
  await sleep(SYSEX_DELAY);
  enviarMIDI([0xF0,ZOOM_MFR,ZOOM_DEV,ZOOM_MODEL,0x33,0xF7],'sx','EDITOR PING');
  await sleep(SYSEX_DELAY);
  editorAberto = true;
  reiniciarWatchdogEditor();
}

function reiniciarWatchdogEditor(){
  if(editorTimer) clearTimeout(editorTimer);
  editorTimer = setTimeout(async()=>{
    editorAberto = false;
    await garantirEditor();
  }, 4 * 60 * 1000);
}

async function fecharEditor(){
  if(!midiOut||!midiReady) return;
  enviarMIDI([0xF0,ZOOM_MFR,ZOOM_DEV,ZOOM_MODEL,CMD_EDIT_OFF,0xF7],'sx','EDIT OFF');
  await sleep(SYSEX_DELAY);
  editorAberto = false;
  if(editorTimer){ clearTimeout(editorTimer); editorTimer=null; }
}

async function requisitarDump(){
  if(!midiOut||!midiReady) return;
  await garantirEditor();
  enviarMIDI([0xF0,ZOOM_MFR,ZOOM_DEV,ZOOM_MODEL,CMD_DUMP_REQ,0xF7],'sx','DUMP REQ 0x29');
}

function enviarProgramChange(pc){
  enviarMIDI([0xC0|MIDI_CH,pc],'pc',`PC ${pc} [${cam0.bank}${cam0.patch+1}]`);
  limparPatchAtual();
  aplicarCacheSeDisponivel(cam0.bank, cam0.patch);
  if(dumpTimer) clearTimeout(dumpTimer);
  dumpTimer = setTimeout(requisitarDump, PC_TO_DUMP_MS);
}

// ══════════════════════════════════════════════════════════════════
// §tap — Tap Tempo + Auto-Calibrador de paramIdx
//
// A G1On NÃO aceita BPM global via MIDI (diferente da G3).
// A controladora calcula o valor correto e envia para cada parâmetro
// de cada efeito ativo no patch atual, individualmente por slot.
//
// DOIS MODOS DE OPERAÇÃO:
//
//   MODO SHOW — paramIdx já confirmado no cache:
//     envia direto, zero latência extra.
//
//   MODO APRENDIZADO — paramIdx desconhecido:
//     tenta paramIdx 0, 1, 2... até TAP_MAX_PROBE.
//     Para cada candidato: envia valor de teste → pede dump → compara.
//     Quando confirma → salva no cache por ID e por família.
//     Na próxima vez → MODO SHOW.
//
// CACHE DE PARAMIDX (localStorage 'fmc-tap-rawcache'):
//   { "0x286e": { paramIdx:0, escala:31.5, tipo:'ms', familia:'delay-28' },
//     "familia-delay-28": { paramIdx:0 },   ← herança por família
//     ... }
//
// FAMÍLIA DOS IDs:
//   0x08xx → 'delay-08'    0x28xx → 'delay-28'
//   0x06xx → 'mod-06'      0x26xx → 'mod-26'
//   (mesma família herda paramIdx confirmado de outro membro)
//
// PARAM_OFFSET = 6:
//   rawSlot[6] = Param 1 (paramIdx=0 no Param Set SysEx)
//   rawSlot[7] = Param 2 (paramIdx=1)
//   rawSlot[6+N] = Param N+1 (paramIdx=N)
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// TAP TEMPO — via reescrita de patch completo (SysEx 0x28 bidirecional)
//
// DESCOBERTA CONFIRMADA (2026-03-18):
//   O Time do Delay na G1On é codificado no ID do efeito (id_lo = rawSlot[4]).
//   CMD_PARAM 0x31 NÃO controla o Time — ele altera outros bytes do slot.
//   O único mecanismo que funciona é reescrever o patch completo via 0x28.
//
// PROTOCOLO:
//   1. Guarda o rawDump (134 bytes) recebido no último dump
//   2. Modifica rawSlot[3] (id_hi) e rawSlot[4] (id_lo) com o id do tempo alvo
//   3. Repacota os bytes (pack7bit)
//   4. Envia: F0 52 00 63 28 [129 bytes reempacotados] F7
//   5. G1On aceita imediatamente — sem PC, sem reload
//
// TABELA DE CALIBRAÇÃO (Delay 0x28xx, confirmada por dumps reais A0-A5):
//   1ms→0x0800 | 100ms→0x2818 | 500ms→0x287C |
//   1000ms→0x2879 | 2000ms→0x2873 | 4000ms→0x2867
//
// INTERPOLAÇÃO:
//   Para ms não exatos, interpola linearmente entre os pontos da tabela.
//   Ex: 750ms → entre 500(id=0x287C=10364) e 1000(id=0x2879=10361)
//       frac=0.5 → id=round(10364 + 0.5*(10361-10364)) = 10362 = 0x287A
// ══════════════════════════════════════════════════════════════════

// Tabela de calibração confirmada — Delay (família 0x08xx e 0x28xx)
const TAP_CAL_DELAY = [
  {ms:    1, id: 0x0800},
  {ms:  100, id: 0x2818},
  {ms:  500, id: 0x287C},
  {ms: 1000, id: 0x2879},
  {ms: 2000, id: 0x2873},
  {ms: 4000, id: 0x2867},
];

// Guarda o rawDump mais recente (134 bytes) para reescrita
let tapRawDump = null;

function setTapRawDump(dump){
  tapRawDump = Array.from(dump);
}

// Pack 7-bit (inverso do unpack — converte array 8-bit → stream 7-bit SysEx)
function pack7bit(unpacked){
  const out = [];
  for(let i = 0; i < unpacked.length; i += 7){
    const chunk = unpacked.slice(i, i + 7);
    let msbs = 0;
    for(let j = 0; j < chunk.length; j++) if(chunk[j] & 0x80) msbs |= (1 << j);
    out.push(msbs);
    for(let j = 0; j < chunk.length; j++) out.push(chunk[j] & 0x7F);
  }
  return out;
}

// Interpola id na tabela de calibração para um dado ms
function tapCalInterp(ms, table){
  const t = table;
  if(ms <= t[0].ms) return t[0].id;
  if(ms >= t[t.length-1].ms) return t[t.length-1].id;
  for(let i = 0; i < t.length-1; i++){
    if(ms >= t[i].ms && ms <= t[i+1].ms){
      const frac = (ms - t[i].ms) / (t[i+1].ms - t[i].ms);
      return Math.round(t[i].id + frac * (t[i+1].id - t[i].id));
    }
  }
  return t[0].id;
}

// Reconstrói o dump com um novo id no slot especificado
function tapRebuildDump(rawDump, slotIdx, newId){
  const up = unpack7bitStream(rawDump, 5);
  const newUp = Array.from(up);
  const off = slotIdx * 18;
  if(off + 5 >= newUp.length) return null;

  const new_hi = (newId >> 7) & 0x7F;
  const new_lo = newId & 0x7F;
  const en = (newUp[off+3] >> 7) & 1;  // preserva enabled

  newUp[off+3] = (en << 7) | new_hi;
  newUp[off+4] = new_lo;
  // rawSlot[5] (r2) não mexe

  const repacked = pack7bit(newUp);
  const newRaw = Array.from(rawDump);
  for(let i = 0; i < repacked.length && (5+i) < 110; i++){
    newRaw[5+i] = repacked[i];
  }
  return newRaw;
}

// Envia tap para um efeito via write 0x28
async function enviarTapEfeito(efeito, bpmCalc, ms, hz){
  if(!tapRawDump){
    showToast('TAP: aguardando dump do patch');
    return null;
  }

  const familia = familiaDoId(efeito.id);

  // Delays: usa tabela de calibração
  if(familia && (familia === 'delay-08' || familia === 'delay-28')){
    const msAlvo = Math.max(1, Math.min(4000, ms));
    const newId  = tapCalInterp(msAlvo, TAP_CAL_DELAY);
    const newDump = tapRebuildDump(tapRawDump, efeito.slotIdx, newId);
    if(!newDump){ logMIDI({type:'err', label:`TAP: rebuild falhou slot${efeito.slotIdx}`}); return null; }

    try{
      midiOut.send(newDump);
      // Atualiza rawDump local com o novo estado
      tapRawDump = newDump;
      // Atualiza rawSlot no patchAtual para consistência
      const up = unpack7bitStream(newDump, 5);
      const off = efeito.slotIdx * 18;
      if(patchAtual.efeitos[efeito.slotIdx]){
        patchAtual.efeitos[efeito.slotIdx].rawSlot = Array.from(up.slice(off, off+18));
        patchAtual.efeitos[efeito.slotIdx].id = newId;
      }
      logMIDI({type:'sx', label:`TAP ${bpmCalc}bpm → ${efeito.nome} slot${efeito.slotIdx+1} id=0x${newId.toString(16).toUpperCase()} (${msAlvo}ms)`});
      return `${efeito.nome}→${msAlvo}ms`;
    } catch(e){
      logMIDI({type:'err', label:`TAP ERR: ${e.message}`});
      return null;
    }
  }

  // Modulações (Rate): mesmo mecanismo write 0x28
  // Rate está em rawSlot[6] (param[0]) para a maioria dos mods
  // Escala empírica: hz * escala → 0-127
  // TAP_CAL_MOD precisa ser calibrada — por ora usa escala conservadora
  if(familia && (familia === 'mod-06' || familia === 'mod-26')){
    if(!tapRawDump){ showToast('TAP: aguardando dump'); return null; }

    // Rate param: rawSlot[6] = param[0] para mods da família 0x06/0x26
    // Escala: 120bpm = 2hz, val ideal ~60 → escala ~30
    // Ajuste empírico: val = round(hz * 30), clamp 0-127
    const RATE_ESCALA = 30;
    const val = Math.max(0, Math.min(127, Math.round(hz * RATE_ESCALA)));

    // Modifica rawSlot[6] do efeito
    if(efeito.rawSlot && efeito.rawSlot.length > 6){
      efeito.rawSlot[6] = val;
    }

    const newDump = (() => {
      try{
        const up    = unpack7bitStream(tapRawDump, 5);
        const newUp = Array.from(up);
        const off   = efeito.slotIdx * 18;
        if(off + 17 < newUp.length && efeito.rawSlot){
          for(let i = 0; i < 18 && (off+i) < newUp.length; i++)
            newUp[off+i] = efeito.rawSlot[i];
        }
        const repacked = pack7bit(newUp);
        const newRaw   = Array.from(tapRawDump);
        for(let i = 0; i < repacked.length && (5+i) < 110; i++)
          newRaw[5+i] = repacked[i];
        return newRaw;
      } catch(e){ return null; }
    })();

    if(!newDump){ return null; }

    try{
      midiOut.send(newDump);
      tapRawDump = newDump;
      logMIDI({type:'sx', label:`TAP RATE ${bpmCalc}bpm → ${efeito.nome} slot${efeito.slotIdx+1} rawSlot[6]=${val} (${hz.toFixed(2)}hz)`});
      return `${efeito.nome}→${val}(rate)`;
    } catch(e){ return null; }
  }

  return null;
}

// Tap Tempo — dispara após SYSEX_IDLE_MS
function enviarSysExTapTempo(bpm){
  if(sysexIdleTimer) clearTimeout(sysexIdleTimer);
  sysexIdleTimer = setTimeout(async()=>{
    if(!midiOut||!midiReady){ showToast('TAP: SEM MIDI'); return; }

    const bpmCalc = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
    const ms  = Math.round(60000 / bpmCalc);
    const hz  = bpmCalc / 60;

    if(patchAtual.efeitos.length === 0){
      showToast(`TAP ${bpmCalc}bpm · SEM DUMP (navegue p/ carregar)`);
      return;
    }
    const efeitosAlvo = patchAtual.efeitos.filter(e => e.tap && e.rawSlot);
    if(efeitosAlvo.length === 0){
      showToast(`TAP ${bpmCalc}bpm · sem Time/Rate`);
      return;
    }

    await forcarEditor();

    const enviados = [];
    for(const efeito of efeitosAlvo){
      const r = await enviarTapEfeito(efeito, bpmCalc, ms, hz);
      if(r) enviados.push(r);
      await sleep(SYSEX_DELAY);
    }

    if(enviados.length > 0) showToast(`TAP ${bpmCalc}bpm · ${ms}ms · ${enviados.join(' · ')}`);
    piscarIndicador();
  }, SYSEX_IDLE_MS);
}

// ── Cache de paramIdx (RAM + localStorage) ──────────────────────
let tapRawCache = {};

function carregarTapRawCache(){
  try{
    const s = localStorage.getItem(TAP_RAW_CACHE_KEY);
    if(s) tapRawCache = JSON.parse(s);
  } catch(e){ tapRawCache = {}; }
}

function gravarTapRawCache(){
  try{ localStorage.setItem(TAP_RAW_CACHE_KEY, JSON.stringify(tapRawCache)); }
  catch(e){}
}

function limparTapRawCache(){
  tapRawCache = {};
  try{ localStorage.removeItem(TAP_RAW_CACHE_KEY); } catch(e){}
  showToast('TAP CACHE LIMPO');
}

function lerTapCache(id){
  const hex = '0x' + id.toString(16).toLowerCase();
  return tapRawCache[hex] || null;
}

function lerTapCacheFamilia(familia){
  const key = 'familia-' + familia;
  return tapRawCache[key] || null;
}

function gravarTapCache(id, familia, paramIdx, escala, tipo){
  const hex = '0x' + id.toString(16).toLowerCase();
  tapRawCache[hex] = { paramIdx, escala, tipo, familia, ts: Date.now() };
  // também grava na família para herança
  const fkey = 'familia-' + familia;
  if(!tapRawCache[fkey]) tapRawCache[fkey] = { paramIdx };
  gravarTapRawCache();
}

// ── Família do ID ────────────────────────────────────────────────
function familiaDoId(id){
  const alto = (id >> 8) & 0xFF;
  if(alto === 0x08) return 'delay-08';
  if(alto === 0x28) return 'delay-28';
  if(alto === 0x06) return 'mod-06';
  if(alto === 0x26) return 'mod-26';
  if(alto === 0x09 || alto === 0x29) return 'reverb';
  return null;
}

// ── Dump de confirmação para o calibrador ───────────────────────
// Retorna uma Promise que resolve com os bytes do dump (ou null se timeout)
function aguardarDumpCalibracao(timeoutMs){
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      bgScanAtivo   = false;
      bgScanPending = null;
      resolve(null);
    }, timeoutMs);
    bgScanAtivo = true;
    bgScanPending = (data) => {
      clearTimeout(timer);
      bgScanAtivo = false;
      resolve(data);
    };
  });
}

// ── Flag de modo calibração ──────────────────────────────────────
// false = modo palco (tap envia direto, nunca calibra automaticamente)
// true  = modo calibração (tap dispara calibração se paramIdx desconhecido)
let modoCalibracaoAtivo = false;

function ativarModoCalibracaoUI(){
  modoCalibracaoAtivo = true;
  showToast('CALIBRAÇÃO ATIVA · navegue pelos patches com delay/mod');
  document.getElementById('calBtn') && document.getElementById('calBtn').classList.add('cal-on');
}

function desativarModoCalibracaoUI(){
  modoCalibracaoAtivo = false;
  showToast('CALIBRAÇÃO CONCLUÍDA · modo palco ativo');
  document.getElementById('calBtn') && document.getElementById('calBtn').classList.remove('cal-on');
}

// ── Calibrador de paramIdx ───────────────────────────────────────
// Varre paramIdx 0..TAP_MAX_PROBE-1 enviando valor de teste e
// confirmando via dump. Salva o resultado no cache.
// SÓ É CHAMADO quando modoCalibracaoAtivo=true.
async function calibrarParamIdx(efeito){
  if(!midiOut || !midiReady) return null;

  const familia = familiaDoId(efeito.id);
  const slotIdx = efeito.slotIdx;
  const lo      = TAP_TEST_VAL & 0x7F;
  const hi      = (TAP_TEST_VAL >> 7) & 0x7F;

  // Salva rawSlot original para restaurar depois de cada teste
  const rawOriginal = efeito.rawSlot ? [...efeito.rawSlot] : null;

  for(let p = 0; p < TAP_MAX_PROBE; p++){
    showToast(`CAL: ${efeito.nome} testando param[${p}]…`);

    // 1. Envia valor de teste
    try{
      midiOut.send([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
                    slotIdx, p, lo, hi, 0xF7]);
    } catch(e){ continue; }

    await sleep(TAP_PROBE_DELAY);

    // 2. Pede dump de confirmação
    enviarMIDI([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_DUMP_REQ, 0xF7],
               'sx', `CAL probe p=${p}`);

    const dumpData = await aguardarDumpCalibracao(700);
    if(!dumpData) continue;

    const info = parseZoomDump(dumpData);
    if(!info) continue;
    const efDump = info.efeitos.find(e => e.slotIdx === slotIdx);
    if(!efDump || !efDump.rawSlot) continue;

    // 3. Verifica se rawSlot[PARAM_OFFSET + p] mudou para TAP_TEST_VAL
    const bytePos  = TAP_PARAM_OFFSET + p;
    if(bytePos >= efDump.rawSlot.length) continue;
    const byteAtual = efDump.rawSlot[bytePos];

    if(byteAtual === TAP_TEST_VAL){
      // 4. Confirmado — restaura valor original antes de sair
      if(rawOriginal){
        const valOrig   = rawOriginal[bytePos] || 0;
        const loO = valOrig & 0x7F, hiO = (valOrig >> 7) & 0x7F;
        try{ midiOut.send([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
                           slotIdx, p, loO, hiO, 0xF7]); }
        catch(e){}
        await sleep(60);
      }

      const escFam = (familia && TAP_FAMILIA_ESCALA[familia])
        ? TAP_FAMILIA_ESCALA[familia]
        : { escala: 8.0, tipo: 'ms' };

      gravarTapCache(efeito.id, familia, p, escFam.escala, escFam.tipo);
      showToast(`CAL: ${efeito.nome} ✓ param[${p}] · ${escFam.escala}${escFam.tipo}/unit`);
      logMIDI({type:'sx',
        label:`CAL OK ${efeito.nome} 0x${efeito.id.toString(16)} paramIdx=${p} familia=${familia}`});
      return { paramIdx: p, escala: escFam.escala, tipo: escFam.tipo };
    }

    // Não confirmou — restaura e tenta próximo
    if(rawOriginal){
      const valOrig   = rawOriginal[TAP_PARAM_OFFSET + p] || 0;
      const loO = valOrig & 0x7F, hiO = (valOrig >> 7) & 0x7F;
      try{ midiOut.send([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
                         slotIdx, p, loO, hiO, 0xF7]); }
      catch(e){}
      await sleep(60);
    }
  }

  // Esgotou tentativas — tenta herdar da família
  if(familia){
    const fc = lerTapCacheFamilia(familia);
    if(fc){
      const esc = TAP_FAMILIA_ESCALA[familia] || { escala:8.0, tipo:'ms' };
      gravarTapCache(efeito.id, familia, fc.paramIdx, esc.escala, esc.tipo);
      showToast(`CAL: ${efeito.nome} herdou família ${familia} param[${fc.paramIdx}]`);
      return { paramIdx: fc.paramIdx, escala: esc.escala, tipo: esc.tipo };
    }
  }

  showToast(`CAL: ${efeito.nome} — sem resposta`);
  logMIDI({type:'err', label:`CAL FALHOU ${efeito.nome} 0x${efeito.id.toString(16)}`});
  return null;
}

// ── Calibração completa de todos os patches ──────────────────────
// Varre A0–J9, pede dump de cada patch, calibra todos os efeitos
// com tap que ainda não estão no cache. Roda em background.
let calScanRodando = false;

async function iniciarCalibracaoCompleta(){
  if(calScanRodando){ showToast('CALIBRAÇÃO JÁ EM ANDAMENTO'); return; }
  if(!midiOut || !midiReady){ showToast('SEM MIDI — conecte a G1On'); return; }

  calScanRodando = true;
  ativarModoCalibracaoUI();
  await forcarEditor();

  let total = 0, calibrados = 0, ja_sabia = 0;

  for(let bi = 0; bi < BANKS_ALL.length; bi++){
    for(let pi = 0; pi < 10; pi++){
      if(!calScanRodando) break; // permite cancelar

      const pc = bi * 10 + pi;
      const label = BANKS_ALL[bi] + pi;

      // Navega para o patch
      try{ midiOut.send([0xC0 | MIDI_CH, pc]); } catch(e){ continue; }
      await sleep(400);

      // Pede dump — forcar (não só garantir) para máxima confiabilidade no loop
      await forcarEditor();
      enviarMIDI([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_DUMP_REQ, 0xF7],
                 'sx', `CAL SCAN ${label}`);

      const dumpData = await aguardarDumpCalibracao(800);
      if(!dumpData){ continue; }

      const info = parseZoomDump(dumpData);
      if(!info) continue;

      // Atualiza cache do patch enquanto passa
      gravarCachePatch(BANKS_ALL[bi], pi, info);

      // Calibra cada efeito com tap que ainda não tem paramIdx
      for(const ef of info.efeitos.filter(e => e.tap && e.rawSlot)){
        total++;
        const cached = lerTapCache(ef.id);
        if(cached){ ja_sabia++; continue; }

        const resultado = await calibrarParamIdx(ef);
        if(resultado) calibrados++;

        await forcarEditor(); // reabre editor após cada calibração
        await sleep(80);
      }

      showToast(`CAL: ${label} · ${calibrados} novos · ${ja_sabia} já sabia`);
    }
    if(!calScanRodando) break;
  }

  // Volta pro patch que estava antes
  const pcAtual = BANKS_ALL.indexOf(cam0.bank) * 10 + cam0.patch;
  try{ midiOut.send([0xC0 | MIDI_CH, pcAtual]); } catch(e){}
  await sleep(400);
  await requisitarDump();

  calScanRodando = false;
  desativarModoCalibracaoUI();
  showToast(`CAL COMPLETA · ${calibrados} calibrados · ${ja_sabia} já salvos · ${total-calibrados-ja_sabia} sem resposta`);
}

function cancelarCalibracao(){
  calScanRodando = false;
  modoCalibracaoAtivo = false;
  bgScanAtivo   = false;
  if(bgScanPending){ bgScanPending(null); bgScanPending = null; }
  showToast('CALIBRAÇÃO CANCELADA');
  const btn = document.getElementById('calBtn');
  if(btn) btn.classList.remove('cal-on');
}


// ── Recebe mensagens MIDI ─────────────────────────────────────
function onMensagemMIDI(event){
  const d=event.data;
  if(!d||d.length<1) return;
  piscarIndicador();

  // PC recebido — usuário trocou patch fisicamente na G1On
  if((d[0]&0xF0)===0xC0 && d.length>=2){
    const pc = d[1];
    const bankIdx = Math.floor(pc/10);
    const patchIdx = pc%10;
    if(bankIdx < BANKS_ALL.length){
      cam0.bank  = BANKS_ALL[bankIdx];
      cam0.patch = patchIdx;
      cam0.bankGroup = bankIdx>=5?1:0;
      limparPatchAtual();
      aplicarCacheSeDisponivel(cam0.bank, cam0.patch);
      gravarEstado();
      renderizar();
      setTimeout(requisitarDump, PC_TO_DUMP_MS);
    }
    return;
  }

  if(!d||d.length<5) return;
  if(d[0]===0xF0&&d[1]===ZOOM_MFR&&d[4]===CMD_DUMP_RES){
    logMIDI({type:'rx',label:`RX 0x28 (${d.length}b)`});
    // Roteia: se background scan está aguardando, entrega para ele
    // caso contrário aplica no patch atual
    if(bgScanAtivo && bgScanPending){
      bgScanPending(Array.from(d)); bgScanPending=null;
    } else {
      setTapRawDump(d);  // guarda para reescrita pelo tap
      aplicarDump(parseZoomDump(d));
      reiniciarWatchdogEditor();
    }
  }
}

// ── Conexão MIDI ───────────────────────────────────────────────
function atualizarBarraMIDI(estado,texto){
  const dot=document.getElementById('midiBarDot');
  const txt=document.getElementById('midiBarTexto');
  const btn=document.getElementById('midiBarBtn');
  if(!dot||!txt) return;
  dot.className='midi-bar-dot '+estado;
  txt.className='midi-bar-texto'+(estado==='g1on'?' g1on':estado==='erro'?' erro':'');
  txt.innerHTML=texto;
  if(!btn) return;
  if(estado==='g1on'||estado==='conectado'){
    btn.textContent='CONECTADO ✓'; btn.className='midi-bar-btn '+(estado==='g1on'?'g1on':'ok');
  } else if(estado==='aguardando'){
    btn.textContent='AGUARDANDO…'; btn.className='midi-bar-btn loading';
  } else if(estado==='erro'){
    btn.textContent='TENTAR NOVAMENTE'; btn.className='midi-bar-btn';
  } else {
    btn.textContent='CONECTAR MIDI'; btn.className='midi-bar-btn';
  }
}

async function conectarMIDI(){
  if(!navigator.requestMIDIAccess){
    atualizarBarraMIDI('erro','Web MIDI não suportado. Use Chrome no Android.');
    return;
  }
  atualizarBarraMIDI('aguardando','Solicitando permissão MIDI…');
  let acesso=null;
  try{ acesso=await navigator.requestMIDIAccess({sysex:true}); }
  catch(e1){
    try{ acesso=await navigator.requestMIDIAccess({sysex:false}); }
    catch(e2){ atualizarBarraMIDI('erro','Permissão negada. Tente novamente.'); return; }
  }
  midiAccess=acesso; midiReady=true;
  midiAccess.onstatechange=onMidiStateChange;
  for(const inp of midiAccess.inputs.values()) inp.onmidimessage=onMensagemMIDI;
  verificarPortas();
}

function verificarPortas(){
  if(!midiAccess) return;
  const outs=[...midiAccess.outputs.values()];
  const ins=[...midiAccess.inputs.values()];
  if(!outs.length&&!ins.length){
    atualizarBarraMIDI('aguardando','Nenhum dispositivo MIDI. Conecte a G1On e tente novamente.');
    midiOut=null; return;
  }
  const zOut=outs.find(o=>nomeContemZoom(o.name))||outs[0];
  midiOut=zOut;
  g1onDetectada=nomeContemZoom(zOut?.name||'');
  if(g1onDetectada){
    atualizarBarraMIDI('g1on',`<strong>Zoom G1On detectada</strong> · ${zOut.name}`);
    setTimeout(async()=>{
      await garantirEditor();
      setTimeout(requisitarDump, 300);
    }, 300);
  } else {
    atualizarBarraMIDI('conectado',`<strong>MIDI ativo</strong> · ${zOut?.name||'—'} · G1On não identificada`);
  }
}

function onMidiStateChange(e){
  const p=e.port;
  if(p.type==='output'){
    if(p.state==='connected'&&(!midiOut||nomeContemZoom(p.name))) midiOut=p;
    if(p.state==='disconnected'&&midiOut?.id===p.id){
      midiOut=null; g1onDetectada=false;
      editorAberto=false;
      if(bgScanPending){ bgScanPending(null); bgScanPending=null; }
      if(editorTimer){ clearTimeout(editorTimer); editorTimer=null; }
    }
    verificarPortas();
  }
  if(p.type==='input'&&p.state==='connected') p.onmidimessage=onMensagemMIDI;
}

function iniciarMIDI(){
  atualizarBarraMIDI('off','Toque em <strong>CONECTAR MIDI</strong> para iniciar');
}

// ══════════════════════════════════════════════════════════════════
// §7 — Cache oportunista (sem PC automático)
//
// NÃO envia Program Change automático — isso mudaria o som no palco.
// Em vez disso, coleta o dump do patch sempre que o usuário navega
// naturalmente. Com o tempo, todos os patches visitados ficam no cache.
//
// O bgScanPending existe para rotear dumps que chegam fora do fluxo
// normal (ex: usuário troca patch na pedaleira fisicamente).
// ══════════════════════════════════════════════════════════════════
let bgScanAtivo   = false;
let bgScanPending = null;

// ══════════════════════════════════════════════════════════════════
// §4.1 — Tap Tempo (performance.now — monotônico)
// ══════════════════════════════════════════════════════════════════
let tapTimes=[], tapTimer=null, tapLedTimer=null, tapBeatTimer=null;

function registrarTap(){
  const now=performance.now();
  if(tapTimer) clearTimeout(tapTimer);
  tapTimer=setTimeout(resetarTap,TAP_TIMEOUT);
  if(tapTimes.length>0&&(now-tapTimes[tapTimes.length-1])<TAP_TIMEOUT){
    tapTimes.push(now);
    if(tapTimes.length>TAP_AVG_N+1) tapTimes.shift();
    if(tapTimes.length>=2){
      const ivs=[];
      for(let i=1;i<tapTimes.length;i++) ivs.push(tapTimes[i]-tapTimes[i-1]);
      const avg=ivs.reduce((a,b)=>a+b,0)/ivs.length;
      cam0.bpm=Math.min(BPM_MAX,Math.max(BPM_MIN,Math.round(60000/avg)));
      iniciarPiscarBeat(Math.round(60000/cam0.bpm));
      enviarSysExTapTempo(cam0.bpm);
      renderizar();
    }
  } else {
    tapTimes=[now];
  }
  piscarBeatManual();
}

function piscarBeatManual(){
  const btn=fsEls[FS_IDX_TAP];
  btn.classList.add('tap-beat'); btn.classList.remove('tap-off');
  if(tapLedTimer) clearTimeout(tapLedTimer);
  tapLedTimer=setTimeout(()=>{btn.classList.remove('tap-beat');btn.classList.add('tap-off');},80);
}

function iniciarPiscarBeat(intervalMs){
  if(tapBeatTimer) clearInterval(tapBeatTimer);
  const onMs=Math.min(80,intervalMs*0.15);
  tapBeatTimer=setInterval(()=>{
    if(bankSelect) return;
    const btn=fsEls[FS_IDX_TAP];
    btn.classList.add('tap-beat'); btn.classList.remove('tap-off');
    setTimeout(()=>{btn.classList.remove('tap-beat');btn.classList.add('tap-off');},onMs);
  },intervalMs);
}

function resetarTap(){
  tapTimes=[];
  if(tapBeatTimer){clearInterval(tapBeatTimer);tapBeatTimer=null;}
  iniciarPiscarBeat(Math.round(60000/cam0.bpm));
}

// ══════════════════════════════════════════════════════════════════
// DOM refs
// ══════════════════════════════════════════════════════════════════
const $patchId   = document.getElementById('patchId');
const $patchName = document.getElementById('patchName');
const $bpmVal    = document.getElementById('bpmVal');
const $modeBadge = document.getElementById('modeBadge');
const $toast     = document.getElementById('toast');
const $display   = document.getElementById('mainDisplay');

// ══════════════════════════════════════════════════════════════════
// Render
// ══════════════════════════════════════════════════════════════════
function corDoBanco(bank){ return BANK_COLOR[bank]||'#888'; }

function renderizar(){
  const cor=corDoBanco(bankSelect&&preselectBank?preselectBank:cam0.bank);
  const bank=cam0.bank;
  $bpmVal.textContent=Math.round(cam0.bpm);
  if(bankSelect&&preselectBank){
    $patchId.textContent=preselectBank+'?';$patchId.className='patch-id blink';
    $patchId.style.setProperty('--bank-color',corDoBanco(preselectBank));
    $patchName.textContent='AGUARDANDO CONFIRMAÇÃO';
    $display.style.setProperty('--bank-color',corDoBanco(preselectBank));
  } else if(bankSelect){
    $patchId.textContent='??';$patchId.className='patch-id blink';
    $patchName.textContent='SELECIONE O BANCO';
    $display.style.setProperty('--bank-color','#ff6b00');
  } else {
    $patchId.textContent=bank+cam0.patch;$patchId.className='patch-id';
    $patchId.style.setProperty('--bank-color',cor);
    if(!patchAtual.nome) $patchName.textContent=PATCH_NAMES[bank]?.[cam0.patch]||`PATCH ${cam0.patch+1}`;
    $display.style.setProperty('--bank-color',cor);
  }
  const visGroup=BANKS_ALL.slice(cam0.bankGroup*5,cam0.bankGroup*5+5);
  const bankInView=visGroup.includes(cam0.bank);
  if(bankSelect){
    const grp=BANKS_ALL.slice(preselectGrp*5,preselectGrp*5+5);
    for(let i=0;i<5;i++){
      const b=grp[i],bc=corDoBanco(b),btn=fsEls[i],isP=preselectBank===b;
      btn.style.setProperty('--bank-color',bc);
      btn.classList.remove('lit-top','lit-bottom');btn.classList.toggle('preselect-mode',true);
      btn.style.borderColor=isP?bc:'';
      btn.style.boxShadow=isP?`0 0 16px ${bc}88,0 0 40px ${bc}33`:'';
      btn.style.color=isP?bc:'';
      labelEls[i].textContent=fsToggle&&isP?'ÍMPARES':isP?'CONFIRMAR':b;
      btn.childNodes[0].textContent=b;
    }
    labelEls[5].textContent='TAP=LAYER HOLD=SAIR';
    $modeBadge.className=preselectBank?'mode-badge confirming':'mode-badge banksel';
    $modeBadge.textContent=preselectBank?`CONF ${preselectBank}?`:'BANK SEL';
  } else {
    for(let i=0;i<5;i++){
      const base=i*2,isTop=bankInView&&cam0.patch===base,isBot=bankInView&&cam0.patch===base+1;
      const btn=fsEls[i];
      btn.style.setProperty('--bank-color',cor);btn.classList.remove('preselect-mode');
      btn.style.borderColor='';btn.style.boxShadow='';btn.style.color='';
      btn.classList.toggle('lit-top',isTop);btn.classList.toggle('lit-bottom',isBot);
      btn.childNodes[0].textContent=`FS${i+1}`;
      if(bankInView){
        const next=(lastFsIdx===i&&fsToggle)?base+1:base;
        const show=(isTop||isBot)?cam0.patch:next;
        // Prioridade: cache do dump > tabela local
        const cached = lerCachePatch(cam0.bank, show);
        const nomePatch = (cached&&cached.nome) || PATCH_NAMES[cam0.bank]?.[show] || `P${show+1}`;
        labelEls[i].textContent = nomePatch.substring(0,9);
      } else { labelEls[i].textContent='· · ·'; }
    }
    labelEls[5].textContent='TAP · HOLD';
    $modeBadge.className='mode-badge normal';$modeBadge.textContent='EXECUÇÃO';
  }
}

// ══════════════════════════════════════════════════════════════════
// Footswitches
// ══════════════════════════════════════════════════════════════════
const fsGrid=document.getElementById('fsGrid');
const fsEls=[],labelEls=[];
for(let i=0;i<FS_COUNT;i++){
  const col=document.createElement('div');col.className='fs-col';
  const btn=document.createElement('div');btn.className='fs-btn';
  btn.setAttribute('role','button');btn.setAttribute('tabindex','0');
  // Label text: mode-aware
  if(FS_MODE===12){
    if(i<10) btn.appendChild(document.createTextNode(`FS${i+1}`));
    else if(i===10){ btn.appendChild(document.createTextNode('BANK'));
      const s=document.createElement('span');s.style.cssText='font-size:7px;opacity:.6;display:block;margin-top:1px';
      s.textContent='HOLD=TUNER';btn.appendChild(s); }
    else { btn.appendChild(document.createTextNode('TAP'));btn.classList.add('tap-btn'); }
  } else {
    btn.appendChild(document.createTextNode(i<5?`FS${i+1}`:'FS6'));
    if(i===5){
      const s=document.createElement('span');
      s.style.cssText='font-size:7px;opacity:.6;display:block;margin-top:1px';
      s.textContent='TAP';btn.appendChild(s);btn.classList.add('tap-btn');
    }
  }
  const lbl=document.createElement('div');lbl.className='fs-label';
  col.appendChild(btn);col.appendChild(lbl);fsGrid.appendChild(col);
  fsEls.push(btn);labelEls.push(lbl);
}

// ── Estado de navegação ─────────────────────────────────────────
let bankSelect=false,preselectBank=null,preselectGrp=0,lastFsIdx=null,fsToggle=false;
let tunerAtivo=false; // Tuner: SysEx F0 52 00 63 03 42/43 F7 + CC74 fallback + PC estabilização

// ── Tuner ─────────────────────────────────────────────────────

async function toggleTuner(){
  tunerAtivo = !tunerAtivo;
  if(!midiOut || !midiReady){
    atualizarVisualTuner();
    showToast(tunerAtivo ? '🎸 TUNER ON (sem MIDI)' : 'TUNER OFF');
    return;
  }

  if(tunerAtivo){
    // 1. SysEx tuner ON (model 0x63 corrigido)
    enviarMIDI([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, 0x03, 0x42, 0xF7],
               'sx', 'TUNER ON (SysEx)');
    await sleep(SYSEX_DELAY);
    // 2. CC 74 val=64 — fallback/reforço
    try{ midiOut.send([0xB0|MIDI_CH, 0x4A, 0x40]); } catch(e){}
    showToast('🎸 TUNER ON · AFINE SEM MEDO');
  } else {
    // 1. SysEx tuner OFF
    enviarMIDI([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, 0x03, 0x43, 0xF7],
               'sx', 'TUNER OFF (SysEx)');
    await sleep(SYSEX_DELAY);
    // 2. CC 74 val=0 — fallback/reforço
    try{ midiOut.send([0xB0|MIDI_CH, 0x4A, 0x00]); } catch(e){}
    await sleep(40);
    // 3. PC patch atual — estabiliza estado
    const pc = BANKS_ALL.indexOf(cam0.bank) * 10 + cam0.patch;
    try{ midiOut.send([0xC0|MIDI_CH, pc]); } catch(e){}
    // PC fecha implicitamente o editor na G1On — força reabertura no próximo uso
    editorAberto = false;
    showToast('TUNER OFF · VOLTANDO AO VIVO');
  }

  atualizarVisualTuner();
}

function atualizarVisualTuner(){
  const btn = fsEls[FS_IDX_TUNER];
  btn.classList.toggle('tuner-on', tunerAtivo);
  labelEls[FS_IDX_TUNER].textContent = tunerAtivo ? '🎸 AFINAR' : (labelEls[2].dataset.nomePatch || '· · ·');
  $modeBadge.className  = tunerAtivo ? 'mode-badge tuner' : 'mode-badge normal';
  $modeBadge.textContent = tunerAtivo ? 'TUNER · MUTE' : 'EXECUÇÃO';
}

// ── Handlers (com flag touchAtivo para bug mobile) ──────────────
const debounceTimers={},holdTimers={},pressTimes={},touchAtivo={};
function attachFS(idx,el){
  function onPress(isTouch){
    if(debounceTimers[idx]) return;
    debounceTimers[idx]=setTimeout(()=>{debounceTimers[idx]=null;},DEBOUNCE_MS);
    if(isTouch) touchAtivo[idx]=true;
    el.classList.add('pressed');pressTimes[idx]=Date.now();
    // Hold: mode-aware
    if(FS_MODE===12){
      if(idx===FS_IDX_TAP)  holdTimers[idx]=setTimeout(toggleTuner, HOLD_MS);   // hold TAP = tuner
      if(idx===FS_IDX_BANK) holdTimers[idx]=setTimeout(()=>{}, HOLD_MS);        // hold BANK = nada
    } else {
      if(idx===FS_IDX_BANK) holdTimers[idx]=setTimeout(onFS6Hold, HOLD_MS);
    }
  }
  function onRelease(isTouch){
    if(isTouch) touchAtivo[idx]=false;
    el.classList.remove('pressed');
    const held=Date.now()-(pressTimes[idx]||0);
    clearTimeout(holdTimers[idx]);
    if(FS_MODE===12){
      if(idx===FS_IDX_TAP){
        if(held<HOLD_MS) registrarTap();          // press = tap
        // hold já disparou toggleTuner via holdTimer
      } else if(idx===FS_IDX_BANK){
        if(held<HOLD_MS) onFS11Press();           // press = bank select
        // hold = nada
      } else {
        // idx 0-4 = patches 0-4, idx 6-10 = patches 5-9
        const patchIdx = idx < 5 ? idx : idx - 1; // idx 6→5, 7→6, 8→7, 9→8, 10→9
        onFSPatch12(patchIdx);
      }
    } else {
      if(idx===5){ if(held<HOLD_MS) onFS6Tap(); }
      else if(idx===2){ if(held<HOLD_MS && !tunerAtivo) onFSPatch(idx); }
      else onFSPatch(idx);
    }
  }
  el.addEventListener('mousedown', e=>{e.preventDefault();if(!touchAtivo[idx])onPress(false);});
  el.addEventListener('mouseup',   e=>{e.preventDefault();if(!touchAtivo[idx])onRelease(false);});
  el.addEventListener('mouseleave',()=>{if(!touchAtivo[idx]){el.classList.remove('pressed');clearTimeout(holdTimers[idx]);}});
  el.addEventListener('touchstart',e=>{e.preventDefault();onPress(true);},{passive:false});
  el.addEventListener('touchend',  e=>{e.preventDefault();onRelease(true);},{passive:false});
  el.addEventListener('touchcancel',()=>{touchAtivo[idx]=false;el.classList.remove('pressed');clearTimeout(holdTimers[idx]);});
}
fsEls.forEach((el,i)=>attachFS(i,el));

// ── Lógica de navegação ─────────────────────────────────────────
function onFSPatch(idx){
  if(bankSelect&&preselectBank){
    const pIdx=idx*2+(fsToggle?1:0);
    cam0.bank=preselectBank;cam0.patch=pIdx;cam0.bankGroup=preselectGrp;
    bankSelect=false;preselectBank=null;lastFsIdx=idx;
    limparPatchAtual();
    enviarProgramChange(BANKS_ALL.indexOf(cam0.bank)*10+pIdx);
    flashConfirmRing(fsEls[idx]);
    showToast(`${cam0.bank}${pIdx+1} — ${PATCH_NAMES[cam0.bank]?.[pIdx]||''}`);
    gravarEstado();renderizar();return;
  }
  if(bankSelect){
    const grp=BANKS_ALL.slice(preselectGrp*5,preselectGrp*5+5);
    const e=grp[idx];if(!e)return;
    preselectBank=e;fsToggle=false;
    showToast(`BANCO ${e} · CONFIRME COM FS1–5`);renderizar();return;
  }
  const vg=BANKS_ALL.slice(cam0.bankGroup*5,cam0.bankGroup*5+5);
  if(!vg.includes(cam0.bank)) return;
  const base=idx*2;
  if(lastFsIdx!==idx){lastFsIdx=idx;fsToggle=(cam0.patch===base)?true:false;}
  else fsToggle=!fsToggle;
  cam0.patch=base+(fsToggle?1:0);
  limparPatchAtual();
  enviarProgramChange(BANKS_ALL.indexOf(cam0.bank)*10+cam0.patch);
  flashConfirmRing(fsEls[idx]);gravarEstado();renderizar();
}

function onFS6Tap(){
  if(bankSelect){
    if(preselectBank){fsToggle=!fsToggle;showToast(`${preselectBank} · LAYER ${fsToggle?'ÍMPAR':'PAR'}`);}
    else{preselectGrp=preselectGrp===0?1:0;const g=BANKS_ALL.slice(preselectGrp*5,preselectGrp*5+5);showToast(`GRUPO ${g[0]}–${g[4]}`);}
    renderizar();return;
  }
  registrarTap();
}

function onFS6Hold(){
  if(bankSelect){bankSelect=false;preselectBank=null;showToast('BANK SELECT CANCELADO');}
  else{bankSelect=true;preselectBank=null;preselectGrp=cam0.bankGroup;fsToggle=false;
    const g=BANKS_ALL.slice(preselectGrp*5,preselectGrp*5+5);showToast(`BANK SELECT · ${g[0]}–${g[4]}`);}
  renderizar();
}

// ── 12 FS navigation ────────────────────────────────────────────
// FS1-10 = patches 0-9, FS11 = bank select(press)/tuner(hold), FS12 = tap
function onFSPatch12(idx){
  // idx 0-9 → patches 0-9 do banco ativo
  if(bankSelect){
    // Bank select mode: FS1-10 = bancos A-J
    const banco = BANKS_ALL[idx];
    if(!banco) return;
    if(preselectBank === banco){
      // Segunda press confirma e sai do bank select
      cam0.bank = banco;
      cam0.patch = 0;
      cam0.bankGroup = BANKS_ALL.indexOf(banco) >= 5 ? 1 : 0;
      bankSelect = false; preselectBank = null;
      limparPatchAtual();
      enviarProgramChange(BANKS_ALL.indexOf(cam0.bank)*10 + cam0.patch);
      flashConfirmRing(fsEls[idx]);
      showToast(`BANCO ${banco} · ${lerCachePatch(banco,0)?.nome||'PATCH 1'}`);
      gravarEstado(); renderizar();
    } else {
      preselectBank = banco;
      showToast(`BANCO ${banco} · PRESS NOVAMENTE PARA CONFIRMAR`);
      renderizar();
    }
    return;
  }
  // Modo normal: idx = patch 0-9
  cam0.patch = idx;
  limparPatchAtual();
  enviarProgramChange(BANKS_ALL.indexOf(cam0.bank)*10 + idx);
  flashConfirmRing(fsEls[idx]);
  gravarEstado(); renderizar();
}

function onFS11Press(){
  // Press = entrar/sair de bank select
  if(bankSelect){
    bankSelect = false; preselectBank = null;
    showToast('BANK SELECT CANCELADO');
  } else {
    bankSelect = true; preselectBank = null;
    showToast('BANK SELECT · A–J NOS FS1–10');
  }
  renderizar();
}

function onFS11Hold(){
  // Hold = tuner (já disparado pelo holdTimer → toggleTuner)
  // Este handler existe para não conflitar com onFS11Press
}

// ── renderizar() — dual-mode aware ──────────────────────────────
// A função renderizar() original está acima e funciona para FS_MODE=6.
// Para FS_MODE=12 usamos renderizar12() chamada pelo alias abaixo.
// Sobrescrevemos renderizar só se FS_MODE===12.
if(FS_MODE === 12){
  // Guarda a original para compatibilidade
  const _renderizar6 = renderizar;

  // Redefine renderizar para modo 12
  // eslint-disable-next-line no-global-assign
  renderizar = function renderizar12(){
    const cor = corDoBanco(bankSelect&&preselectBank ? preselectBank : cam0.bank);
    const bank = cam0.bank;
    $bpmVal.textContent = Math.round(cam0.bpm);

    // Display principal
    if(bankSelect && preselectBank){
      $patchId.textContent = preselectBank+'?'; $patchId.className='patch-id blink';
      $patchId.style.setProperty('--bank-color', corDoBanco(preselectBank));
      $patchName.textContent = 'CONFIRME O BANCO';
      $display.style.setProperty('--bank-color', corDoBanco(preselectBank));
    } else if(bankSelect){
      $patchId.textContent = '??'; $patchId.className='patch-id blink';
      $patchName.textContent = 'SELECIONE O BANCO · FS1–FS10';
      $display.style.setProperty('--bank-color', '#ff6b00');
    } else {
      $patchId.textContent = bank+cam0.patch;
      $patchId.className = 'patch-id';
      $patchId.style.setProperty('--bank-color', cor);
      if(!patchAtual.nome) $patchName.textContent = lerCachePatch(bank,cam0.patch)?.nome || `PATCH ${cam0.patch+1}`;
      $display.style.setProperty('--bank-color', cor);
    }

    if(bankSelect){
      // FS1-10 = bancos A-J
      for(let i=0;i<10;i++){
        const b=BANKS_ALL[i], bc=corDoBanco(b), btn=fsEls[i];
        const isP = preselectBank===b;
        btn.style.setProperty('--bank-color', bc);
        btn.classList.remove('lit-top','lit-bottom','preselect-mode');
        btn.classList.add('preselect-mode');
        btn.style.borderColor = isP ? bc : '';
        btn.style.boxShadow   = isP ? `0 0 16px ${bc}88,0 0 40px ${bc}33` : '';
        btn.style.color       = isP ? bc : '';
        // Scribble strip: nome do banco
        const nomePatch0 = lerCachePatch(b,0)?.nome || b;
        labelEls[i].textContent = isP ? 'CONFIRMAR' : b;
        btn.childNodes[0].textContent = b;
      }
      // FS11: bank btn
      fsEls[10].classList.remove('lit-top','lit-bottom');
      labelEls[10].textContent = 'CANCELAR';
      // FS12: tap sempre ativo
      labelEls[11].textContent = 'TAP';
    } else {
      // FS1-10: patches 0-9 do banco ativo
      for(let i=0;i<10;i++){
        const btn=fsEls[i];
        const isActive = cam0.patch===i;
        btn.style.setProperty('--bank-color', cor);
        btn.classList.remove('preselect-mode');
        btn.style.borderColor=''; btn.style.boxShadow=''; btn.style.color='';
        // Acende o FS do patch ativo
        btn.classList.toggle('lit-active', isActive);
        btn.classList.toggle('lit-top',    false);
        btn.classList.toggle('lit-bottom', false);
        if(isActive) btn.classList.add('lit-top'); // reutiliza estilo lit-top para ativo
        btn.childNodes[0].textContent = `FS${i+1}`;
        // Scribble strip: nome do patch
        const cached = lerCachePatch(bank, i);
        const nomePatch = (cached&&cached.nome) ? cached.nome.substring(0,10) : `P${i+1}`;
        labelEls[i].textContent = nomePatch;
        // Destaca label se patch ativo
        labelEls[i].style.color = isActive ? cor : '';
        labelEls[i].style.textShadow = isActive ? `0 0 6px ${cor}` : '';
      }
      // FS11
      fsEls[10].classList.remove('lit-top','lit-bottom','preselect-mode');
      fsEls[10].style.borderColor=''; fsEls[10].style.boxShadow='';
      labelEls[10].textContent = tunerAtivo ? '🎸 AFINAR' : 'BANK·TUNER';
      labelEls[10].style.color=''; labelEls[10].style.textShadow='';
      // FS12 tap
      labelEls[11].textContent = 'TAP';
      labelEls[11].style.color=''; labelEls[11].style.textShadow='';
      // Mode badge
      $modeBadge.className = 'mode-badge normal';
      $modeBadge.textContent = 'EXECUÇÃO';
    }

    // Notifica ToneWebLib se existir
    if(typeof toneWebLibAtualizar === 'function') toneWebLibAtualizar();
  };
}

function flashConfirmRing(el){
  const r=document.createElement('div');r.className='confirm-ring';
  el.appendChild(r);setTimeout(()=>r.remove(),400);
}
let toastTimer=null;
function showToast(msg){
  $toast.textContent=msg;$toast.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$toast.classList.remove('show'),2200);
}

// ── Bloqueios ───────────────────────────────────────────────────
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('gesturechange',e=>e.preventDefault());
document.addEventListener('gestureend',e=>e.preventDefault());
document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});

// ── Init ────────────────────────────────────────────────────────
carregarEstado();
carregarCache();
carregarTapRawCache();
iniciarContadorCiclos();
cam0.bankGroup=BANKS_ALL.indexOf(cam0.bank)>=5?1:0;
aplicarCacheSeDisponivel(cam0.bank, cam0.patch);
renderizar();
iniciarPiscarBeat(Math.round(60000/cam0.bpm));
iniciarMIDI();
showToast((typeof THEME_NAME !== 'undefined' ? THEME_NAME : 'FMC-AM 6F v4') + ' · PRONTO');

function mostrarDetalhesSaude(){
  const d = lerEstatisticasCiclos();
  const REF = 100000;
  const pct = Math.min(100, Math.round((d.total / REF) * 100));
  showToast(`💾 ${d.total.toLocaleString()} escritas · ${d.sessoes||0} sessões · ${pct}% de 100k`);
}

