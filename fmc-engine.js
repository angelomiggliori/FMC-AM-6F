// FMC-AM 6F · Motor v4.2 — fmc-engine.js
// Este arquivo é o motor completo. Os temas carregam via <script src='fmc-engine.js'>
// NÃO edite os temas para lógica MIDI — edite apenas este arquivo.

'use strict';
// ══════════════════════════════════════════════════════════════════
// FMC-AM 6F · Motor v4.1 — Debug definitivo
// Model ID: 0x63 (confirmado via Identity Response fw 1.21)
// BPM encoding: lsb=bpm&0x7F, msb=(bpm>>7)&0x7F (sem offset)
// Nome patch: 7-bit SysEx packing, offset 112, 21 bytes
// ══════════════════════════════════════════════════════════════════

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
  // Fonte: fulldump A0-J9 (fw 1.21) + deep dump E0-E9 anotado
  // id2 = (raw[0]<<7)|raw[1]  ← 2 bytes
  // raw[2] = byte MSBs dos parâmetros (não é parte do ID)
  // IDs compartilhados → discriminados por raw[2] no SHARED map abaixo
  // ══════════════════════════════════════════════════════════════════
  // ─── Estruturais ─────────────────────────────────────────────────
  0x2100:({n:'AmpSim',   c:'amp',      t:null}),  // A0-A6 slot1
  0x2102:({n:'AmpSim-B', c:'amp',      t:null}),  // B0-B8 slot1
  0x0201:({n:'AmpSim-C', c:'amp',      t:null}),  // C0-C8 slot1
  0x2100:({n:'AmpSim',   c:'amp',      t:null}),  // D0-D8 slot1 (mesmo id)
  0x0600:({n:'AmpSim-D', c:'amp',      t:null}),  // E2s1 MonoPitch→AmpSim-D
  0x087D:({n:'Empty',    c:'empty',    t:null}),  // slots não configurados
  0x22C8:({n:'Cab-A',    c:'cab',      t:null}),  // banco A
  0x2002:({n:'Cab-BC',   c:'cab',      t:null}),  // bancos B/C
  0x2A48:({n:'Cab-D',    c:'cab',      t:null}),  // banco D
  0x0888:({n:'Cab-Bass', c:'cab',      t:null}),  // A8/B8/C8/D8
  0x0004:({n:'ZNR',      c:'dynamics', t:null}),
  0x0008:({n:'GraphicEQ',c:'filter',   t:null}),
  // ─── Pitch ───────────────────────────────────────────────────────
  0x2608:({n:'Detune',   c:'pitch',    t:null}),
  0x010C:({n:'Octave',   c:'pitch',    t:null}),
  0x0600:({n:'MonoPitch',c:'pitch',    t:null}),  // E2s1
  0x1000:({n:'PitchSHFT',c:'pitch',   t:null}),
  0x0100:({n:'HPS',      c:'pitch',    t:null}),
  // ─── Delay/Time ──────────────────────────────────────────────────
  0x0050:({n:'CarbonDly',c:'delay',    t:'Time'}),
  0x1C00:({n:'Delay',    c:'delay',    t:'Time'}),  // E5s4
  0x280B:({n:'Delay',    c:'delay',    t:'Time'}),  // J0s1
  0x0052:({n:'TapeEcho', c:'delay',    t:'Time'}),  // banco C (pré-reset)
  0x1880:({n:'TapeEcho', c:'delay',    t:'Time'}),  // E9s4 (pós-reset)
  0x287C:({n:'FilterDly',c:'delay',    t:'Time'}),
  0x286D:({n:'MultiTapD',c:'delay',    t:'Time'}),
  0x2816:({n:'PitchDly', c:'delay',    t:'Time'}),
  0x0990:({n:'StereoDly',c:'delay',    t:'Time'}),
  // ─── Modulação/Rate ──────────────────────────────────────────────
  0x060A:({n:'BendChorus',c:'mod',     t:'Rate'}),
  0x0480:({n:'Chorus',   c:'mod',      t:'Rate'}),
  0x0200:({n:'CoronaTri',c:'mod',      t:'Rate'}),
  0x208C:({n:'DuoPhase', c:'mod',      t:'Rate'}),
  0x1080:({n:'Flanger',  c:'mod',      t:'Rate'}),  // E1s4
  0x214C:({n:'Flanger',  c:'mod',      t:'Rate'}),  // J0s2
  0x0180:({n:'Tremolo',  c:'mod',      t:'Rate'}),  // J0s3 (variante)
  0x0614:({n:'Tremolo',  c:'mod',      t:'Rate'}),  // E4s1
  0x090C:({n:'Vibrato',  c:'mod',      t:'Rate'}),
  0x1400:({n:'SuperCho', c:'mod',      t:'Rate'}),  // E3s4 — raw[2] distingue Z-Organ/ModReverb
  0x2316:({n:'Slicer',   c:'special',  t:null}),
  0x070C:({n:'RtCloset', c:'special',  t:null}),
  0x004E:({n:'Bomber',   c:'special',  t:null}),
  0x00CE:({n:'BitCrush', c:'special',  t:null}),
  // ─── Reverb ──────────────────────────────────────────────────────
  0x2904:({n:'Air',      c:'reverb',   t:null}),
  0x2092:({n:'Arena',    c:'reverb',   t:null}),
  0x00D2:({n:'Hall',     c:'reverb',   t:null}),
  0x0012:({n:'HDHall',   c:'reverb',   t:null}),
  0x0112:({n:'ParticleR',c:'reverb',   t:null}),
  0x0812:({n:'Plate',    c:'reverb',   t:null}),
  0x2908:({n:'Spring63', c:'reverb',   t:null}),
  // ─── Compartilhados (raw[2] discrimina — ver SHARED map) ─────────
  // 0x0000 → EarlyRef / TheVibe / TiledRoom
  // 0x000C → Cry / Ensemble / StereCho
  // 0x0010 → OverDrive / ReverseDL / StompDly
  // 0x004C → Phaser / VinFLNGR
  // 0x0080 → Room / fCycle
  // 0x1400 → SuperCho / ModReverb / Z-Organ
};

// Seed cache: 36 patches reais coletados do full dump (fw 1.21)
const PATCH_CACHE_SEED = {
  'A0':{nome:'Dotted135',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:8904,nome:'Cab-A',cat:'cab',tap:null,enabled:true},{slot:3,id:4,nome:'ZNR',cat:'dynamics',tap:null,enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A1':{nome:'Clean ae',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:8904,nome:'Cab-A',cat:'cab',tap:null,enabled:true},{slot:3,id:4,nome:'ZNR',cat:'dynamics',tap:null,enabled:true},{slot:4,id:4224,nome:'Flanger',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A2':{nome:'Delay 5',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:8904,nome:'Cab-A',cat:'cab',tap:null,enabled:true},{slot:3,id:4,nome:'ZNR',cat:'dynamics',tap:null,enabled:true},{slot:4,id:4224,nome:'Flanger',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A3':{nome:'Clean ae',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:8904,nome:'Cab-A',cat:'cab',tap:null,enabled:true},{slot:3,id:4,nome:'ZNR',cat:'dynamics',tap:null,enabled:true},{slot:4,id:5248,nome:'FX_1480',cat:'unknown',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A4':{nome:'Phaser',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:8904,nome:'Cab-A',cat:'cab',tap:null,enabled:true},{slot:3,id:4,nome:'ZNR',cat:'dynamics',tap:null,enabled:true},{slot:4,id:4096,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:false},{slot:5,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A5':{nome:'Clean ae',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:8904,nome:'Cab-A',cat:'cab',tap:null,enabled:true},{slot:3,id:4,nome:'ZNR',cat:'dynamics',tap:null,enabled:true},{slot:4,id:5248,nome:'FX_1480',cat:'unknown',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A6':{nome:'Tremol',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:8904,nome:'Cab-A',cat:'cab',tap:null,enabled:true},{slot:3,id:4,nome:'ZNR',cat:'dynamics',tap:null,enabled:true},{slot:4,id:384,nome:'Tremolo',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A7':{nome:'Violao',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A8':{nome:'Bass',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1536,nome:'AmpSim-D',cat:'amp',tap:null,enabled:false},{slot:2,id:2184,nome:'Cab-Bass',cat:'cab',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'A9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B0':{nome:'Dotted135',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:false},{slot:3,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true},{slot:4,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B1':{nome:'Clean ae',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:false},{slot:3,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B2':{nome:'Delay 5',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:false},{slot:3,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true},{slot:4,id:4224,nome:'Flanger',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B3':{nome:'Clean ae',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:false},{slot:3,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B4':{nome:'Phaser',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:false},{slot:3,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true},{slot:4,id:4096,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B5':{nome:'Clean ae',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:false},{slot:3,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B6':{nome:'Tremol',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:false},{slot:3,id:8,nome:'GraphicEQ',cat:'filter',tap:null,enabled:true},{slot:4,id:384,nome:'Tremolo',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B7':{nome:'Violao',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B8':{nome:'Bass',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1536,nome:'AmpSim-D',cat:'amp',tap:null,enabled:false},{slot:2,id:2184,nome:'Cab-Bass',cat:'cab',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'B9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C0':{nome:'Dotted135',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:513,nome:'AmpSim-C',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:true},{slot:3,id:16,nome:'Delay',cat:'delay',tap:'Time',enabled:true},{slot:4,id:4096,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C1':{nome:'Clean ae',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:513,nome:'AmpSim-C',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:true},{slot:3,id:82,nome:'TapeEcho',cat:'delay',tap:'Time',enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C2':{nome:'Delay 5',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:513,nome:'AmpSim-C',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:true},{slot:3,id:80,nome:'CarbonDly',cat:'delay',tap:'Time',enabled:false},{slot:4,id:4096,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C3':{nome:'Clean ae',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:513,nome:'AmpSim-C',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:true},{slot:3,id:82,nome:'TapeEcho',cat:'delay',tap:'Time',enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C4':{nome:'Phaser',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:513,nome:'AmpSim-C',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:true},{slot:3,id:76,nome:'FX_004C',cat:'unknown',tap:null,enabled:false},{slot:4,id:4096,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C5':{nome:'Clean ae',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:513,nome:'AmpSim-C',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:true},{slot:3,id:82,nome:'TapeEcho',cat:'delay',tap:'Time',enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C6':{nome:'Tremol',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:513,nome:'AmpSim-C',cat:'amp',tap:null,enabled:false},{slot:2,id:8194,nome:'Cab-BC',cat:'cab',tap:null,enabled:true},{slot:3,id:12,nome:'Ensemble',cat:'mod',tap:'Rate',enabled:true},{slot:4,id:4096,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C7':{nome:'Violao',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C8':{nome:'Bass',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1536,nome:'AmpSim-D',cat:'amp',tap:null,enabled:false},{slot:2,id:2184,nome:'Cab-Bass',cat:'cab',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'C9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D0':{nome:'VOX JMDtd',volume:80,temTime:true,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:10824,nome:'Cab-D',cat:'cab',tap:null,enabled:false},{slot:3,id:16,nome:'Delay',cat:'delay',tap:'Time',enabled:true},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D1':{nome:'VOX JMCln',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:10824,nome:'Cab-D',cat:'cab',tap:null,enabled:false},{slot:3,id:82,nome:'TapeEcho',cat:'delay',tap:'Time',enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D2':{nome:'VOX Dl135',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:10824,nome:'Cab-D',cat:'cab',tap:null,enabled:false},{slot:3,id:80,nome:'CarbonDly',cat:'delay',tap:'Time',enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D3':{nome:'VOX JMCln',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:10824,nome:'Cab-D',cat:'cab',tap:null,enabled:false},{slot:3,id:82,nome:'TapeEcho',cat:'delay',tap:'Time',enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D4':{nome:'VOX Flg',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:10824,nome:'Cab-D',cat:'cab',tap:null,enabled:false},{slot:3,id:12,nome:'Ensemble',cat:'mod',tap:'Rate',enabled:false},{slot:4,id:1024,nome:'FX_0400',cat:'unknown',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D5':{nome:'VOX JMCln',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:10824,nome:'Cab-D',cat:'cab',tap:null,enabled:false},{slot:3,id:82,nome:'TapeEcho',cat:'delay',tap:'Time',enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D6':{nome:'VOX Tr',volume:80,temTime:false,temRate:false,efeitos:[{slot:1,id:8448,nome:'AmpSim',cat:'amp',tap:null,enabled:false},{slot:2,id:10824,nome:'Cab-D',cat:'cab',tap:null,enabled:false},{slot:3,id:12,nome:'Ensemble',cat:'mod',tap:'Rate',enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D7':{nome:'Violao',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D8':{nome:'Bass',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1536,nome:'AmpSim-D',cat:'amp',tap:null,enabled:false},{slot:2,id:2184,nome:'Cab-Bass',cat:'cab',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'D9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'E0':{nome:'-',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1546,nome:'BendChorus',cat:'mod',tap:'Rate',enabled:false},{slot:2,id:206,nome:'BitCrush',cat:'special',tap:null,enabled:true},{slot:3,id:78,nome:'Bomber',cat:'special',tap:null,enabled:false},{slot:4,id:1152,nome:'Chorus',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:512,nome:'CoronaTri',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'E1':{nome:'-',volume:52,temTime:false,temRate:true,efeitos:[{slot:1,id:9736,nome:'Detune',cat:'pitch',tap:null,enabled:false},{slot:2,id:8332,nome:'DuoPhase',cat:'mod',tap:'Rate',enabled:true},{slot:3,id:12,nome:'Ensemble',cat:'mod',tap:'Rate',enabled:false},{slot:4,id:4224,nome:'Flanger',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:256,nome:'HPS',cat:'pitch',tap:null,enabled:false}],ts:0},
  'E2':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:1536,nome:'AmpSim-D',cat:'amp',tap:null,enabled:false},{slot:2,id:268,nome:'Octave',cat:'pitch',tap:null,enabled:false},{slot:3,id:76,nome:'FX_004C',cat:'unknown',tap:null,enabled:false},{slot:4,id:4096,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:false},{slot:5,id:256,nome:'HPS',cat:'pitch',tap:null,enabled:false}],ts:0},
  'E3':{nome:'-',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:1804,nome:'RtCloset',cat:'special',tap:null,enabled:false},{slot:2,id:2316,nome:'Vibrato',cat:'mod',tap:'Rate',enabled:false},{slot:3,id:12,nome:'Ensemble',cat:'mod',tap:'Rate',enabled:false},{slot:4,id:5120,nome:'SuperCho',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'E4':{nome:'-',volume:2,temTime:false,temRate:false,efeitos:[{slot:1,id:1556,nome:'Tremolo',cat:'mod',tap:'Rate',enabled:false},{slot:2,id:2316,nome:'Vibrato',cat:'mod',tap:'Rate',enabled:false},{slot:3,id:76,nome:'FX_004C',cat:'unknown',tap:null,enabled:true},{slot:4,id:5120,nome:'SuperCho',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false}],ts:0},
  'E5':{nome:'-',volume:60,temTime:false,temRate:false,efeitos:[{slot:1,id:10500,nome:'Air',cat:'reverb',tap:null,enabled:false},{slot:2,id:8338,nome:'Arena',cat:'reverb',tap:null,enabled:true},{slot:3,id:80,nome:'CarbonDly',cat:'delay',tap:'Time',enabled:false},{slot:4,id:7168,nome:'Delay',cat:'delay',tap:'Time',enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'E6':{nome:'-',volume:90,temTime:false,temRate:false,efeitos:[{slot:1,id:10364,nome:'FilterDly',cat:'delay',tap:'Time',enabled:false},{slot:2,id:210,nome:'Hall',cat:'reverb',tap:null,enabled:false},{slot:3,id:18,nome:'HDHall',cat:'reverb',tap:null,enabled:false},{slot:4,id:5120,nome:'SuperCho',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'E7':{nome:'-',volume:20,temTime:false,temRate:false,efeitos:[{slot:1,id:10349,nome:'MultiTapD',cat:'delay',tap:'Time',enabled:false},{slot:2,id:274,nome:'ParticleR',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'E8':{nome:'-',volume:80,temTime:true,temRate:false,efeitos:[{slot:1,id:10262,nome:'PitchDly',cat:'delay',tap:'Time',enabled:false},{slot:2,id:2066,nome:'Plate',cat:'reverb',tap:null,enabled:false},{slot:3,id:16,nome:'Delay',cat:'delay',tap:'Time',enabled:true},{slot:4,id:128,nome:'Room',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'E9':{nome:'-',volume:58,temTime:true,temRate:false,efeitos:[{slot:1,id:10504,nome:'Spring63',cat:'reverb',tap:null,enabled:false},{slot:2,id:2448,nome:'StereoDly',cat:'delay',tap:'Time',enabled:true},{slot:3,id:16,nome:'Delay',cat:'delay',tap:'Time',enabled:true},{slot:4,id:6272,nome:'TapeEcho',cat:'delay',tap:'Time',enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F0':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F1':{nome:'-',volume:100,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'AmpSim-B',cat:'amp',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F2':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F3':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F4':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F5':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F6':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F7':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F8':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'F9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G0':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G1':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G2':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G3':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G4':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G5':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G6':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G7':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G8':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'G9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H0':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H1':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H2':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H3':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H4':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H5':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H6':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H7':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H8':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'H9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I0':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I1':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I2':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I3':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I4':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I5':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I6':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I7':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I8':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J0':{nome:'Patch es',volume:70,temTime:false,temRate:true,efeitos:[{slot:1,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:false},{slot:2,id:8524,nome:'Flanger',cat:'mod',tap:'Rate',enabled:true},{slot:3,id:76,nome:'FX_004C',cat:'unknown',tap:null,enabled:false},{slot:4,id:384,nome:'Tremolo',cat:'mod',tap:'Rate',enabled:false},{slot:5,id:256,nome:'HPS',cat:'pitch',tap:null,enabled:false}],ts:0},
  'J1':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J2':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J3':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J4':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J5':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J6':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J7':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J8':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J9':{nome:'-',volume:50,temTime:false,temRate:false,efeitos:[{slot:1,id:2173,nome:'Empty',cat:'empty',tap:null,enabled:false},{slot:2,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:3,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:4,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false},{slot:5,id:0,nome:'EarlyRef',cat:'reverb',tap:null,enabled:false}],ts:0},
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
//   byte[14] = Output Level do patch (0–120, default=100)
//   Todos os patches com configuração padrão têm valor 100
//
// Estratégia:
//   1. Ao navegar → busca no cache e exibe imediatamente
//   2. Dump chega → compara → só grava se mudou
//   3. 3 cópias redundantes para proteção contra corrupção
//   4. Debounce de 2s para evitar escritas em rajada
// ══════════════════════════════════════════════════════════════════
const VOL_OFFSET   = 14;   // byte[14] = Output Level confirmado no dump real
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
  for(let i=0;i<5;i++){
    const base=i*2;
    const cached = lerCachePatch(cam0.bank, base);
    if(labelEls[i] && cached) labelEls[i].textContent = (cached.nome||'').substring(0,9);
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
    volume:  info.volume  ?? VOL_DEFAULT,  // byte[14] — confirmado
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

async function toggleBoost(){
  const cached = lerCachePatch(cam0.bank, cam0.patch);
  const volBase = cached?.volume ?? VOL_DEFAULT;

  if(boostAtivo){
    // Desativa — restaura volume original
    await enviarVolumePatch(volBase);
    boostAtivo = false;
    showToast(`BOOST OFF · VOL ${volBase}`);
  } else {
    // Ativa — sobe BOOST_DELTA, capped em VOL_MAX
    const volBoost = Math.min(VOL_MAX, volBase + BOOST_DELTA);
    if(volBoost <= volBase){
      showToast(`VOL JÁ NO MÁXIMO (${volBase})`);
      return;
    }
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

// ══════════════════════════════════════════════════════════════════
// Parser do Dump 0x28
// Nome: 7-bit SysEx packing a partir do byte 112
// Slots: estrutura a ser refinada — por ora registra bytes raw
// ══════════════════════════════════════════════════════════════════
let patchAtual = {nome:null,efeitos:[],temTime:false,temRate:false,precisaSincBpm:false,efeitosTime:[],efeitosRate:[]};

function decode7bitNome(data, offset, len){
  // Decodifica nome em formato 7-bit SysEx packing
  // Para cada grupo: 1 byte MSBs + até 7 bytes de dados
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

  // Nome — 7-bit SysEx packing a partir do byte 112
  info.nome = decode7bitNome(data, 112, 21);

  // Volume — byte[14] = Output Level (0–120, confirmado nos dumps reais)
  info.volume = extrairVolumeDump(data);

  // Slots — id3 = (raw[0]<<14)|(raw[1]<<7)|raw[2], zero conflitos (fw 1.21)
  for(let i=0;i<5;i++){
    const off = 9 + i*20;
    if(off+3 >= data.length) break;
    const r0=data[off], r1=data[off+1];
    // ID = 2 bytes: (r0<<7)|r1  ← confirmado por engenharia reversa dumps reais fw 1.21
    // r0 bit0 = enabled flag: 0 = ON, 1 = OFF  (INVERTIDO — confirmado por deep dump E0-E9)
    // raw[2] = byte de MSBs dos parâmetros (não é parte do ID)
    const id2 = (r0<<7)|r1;
    const en  = (r0&0x01)===0;  // bit0=0 → ON, bit0=1 → OFF
    // Para IDs compartilhados (0x0000, 0x000C, 0x0010, 0x0080, 0x1400),
    // raw[2] diferencia o efeito real. Mapa: [id2, raw2] → nome
    const r2 = data[off+2];
    const SHARED = {
      [0x0000]: {3:'EarlyRef', 76:'TheVibe', 82:'TiledRoom', other:'EarlyRef'},
      [0x000C]: {10:'Ensemble', 20:'StereCho', other:'Cry'},
      [0x0010]: {7:'StompDly', 119:'ReverseDL', other:'Delay'},
      [0x0080]: {68:'fCycle', 82:'Room', other:'Room'},
      [0x1400]: {12:'SuperCho', 18:'ModReverb', 14:'Z-Organ', other:'SuperCho'},
    };
    let fx;
    if(SHARED[id2]){
      const disc = SHARED[id2];
      const nome_disc = disc[r2] || disc.other;
      const cat_map = {EarlyRef:'reverb',TheVibe:'mod',TiledRoom:'reverb',
        Ensemble:'mod',StereCho:'mod',Cry:'filter',
        StompDly:'delay',ReverseDL:'delay',Delay:'delay',
        fCycle:'mod',Room:'reverb',
        SuperCho:'mod',ModReverb:'reverb','Z-Organ':'special'};
      const tap_map = {TheVibe:'Rate',Ensemble:'Rate',StereCho:'Rate',
        StompDly:'Time',ReverseDL:'Time',Delay:'Time',fCycle:'Rate',SuperCho:'Rate'};
      fx = {n:nome_disc, c:cat_map[nome_disc]||'unknown', t:tap_map[nome_disc]||null};
    } else {
      fx = ZOOM_FX_DB[id2]||{n:`FX_${id2.toString(16).toUpperCase()}`,c:'unknown',t:null};
    }
    const rawSlot = Array.from(data.slice(off, off+20));
    info.efeitos.push({slot:i+1, id:id2, nome:fx.n, cat:fx.c, tap:fx.t, enabled:en, rawSlot, slotIdx:i});
  }

  return info;
}

function aplicarDump(info){
  if(!info) return;
  patchAtual.nome         = info.nome||null;
  patchAtual.volume       = info.volume ?? VOL_DEFAULT;
  patchAtual.efeitos      = info.efeitos;
  patchAtual.efeitosTime  = info.efeitos.filter(e=>e.enabled&&e.tap==='Time');
  patchAtual.efeitosRate  = info.efeitos.filter(e=>e.enabled&&e.tap==='Rate');
  patchAtual.temTime      = patchAtual.efeitosTime.length>0;
  patchAtual.temRate      = patchAtual.efeitosRate.length>0;
  patchAtual.precisaSincBpm = patchAtual.temTime||patchAtual.temRate;
  atualizarFxIndicators();
  const tapBtn = fsEls[5];
  tapBtn.classList.toggle('delay-sync', patchAtual.temTime);
  tapBtn.classList.toggle('rate-sync', !patchAtual.temTime&&patchAtual.temRate);
  if(patchAtual.nome) document.getElementById('patchName').textContent = patchAtual.nome;
  // Reseta boost ao trocar patch
  boostAtivo = false;
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
  patchAtual.nome=null;patchAtual.efeitos=[];
  patchAtual.temTime=false;patchAtual.temRate=false;
  patchAtual.precisaSincBpm=false;
  patchAtual.efeitosTime=[];patchAtual.efeitosRate=[];
  const fi=document.getElementById('fxIndicators'); if(fi) fi.innerHTML='';
  fsEls[5].classList.remove('delay-sync','rate-sync');
}

function aplicarCacheSeDisponivel(bank, patch){
  // Busca no cache — exibe instantaneamente sem esperar o dump
  const cached = lerCachePatch(bank, patch);
  if(!cached || !cached.nome) return false;
  patchAtual.nome          = cached.nome;
  patchAtual.efeitos       = cached.efeitos || [];
  patchAtual.efeitosTime   = patchAtual.efeitos.filter(e=>e.enabled&&e.tap==='Time');
  patchAtual.efeitosRate   = patchAtual.efeitos.filter(e=>e.enabled&&e.tap==='Rate');
  patchAtual.temTime       = patchAtual.efeitosTime.length > 0;
  patchAtual.temRate       = patchAtual.efeitosRate.length > 0;
  patchAtual.precisaSincBpm = patchAtual.temTime || patchAtual.temRate;
  atualizarFxIndicators();
  const tapBtn = fsEls[5];
  tapBtn.classList.toggle('delay-sync', patchAtual.temTime);
  tapBtn.classList.toggle('rate-sync', !patchAtual.temTime&&patchAtual.temRate);
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

// Tap Tempo
// ══════════════════════════════════════════════════════════════════
// §tap — Tap Tempo
//
// A G1On NÃO aceita BPM global via MIDI.
// A controladora calcula o valor correto e envia para cada parâmetro
// de cada efeito ativo no patch atual, independente do slot.
//
// Protocolo Param Set: F0 52 00 63 31 [slotIdx 0-4] [paramIdx] [valLo] [valHi] F7
//   slotIdx = slot 1→0, slot 2→1, ... slot 5→4
//   paramIdx = índice do parâmetro dentro do slot (0=primeiro dial)
//   rawSlot[2] = byte de MSBs (não é param)
//   rawSlot[3] = param[0] → paramIdx=0
//   rawSlot[4] = param[1] → paramIdx=1
//   rawSlot[6] = param[3] → paramIdx=3  ← TIME da maioria dos delays
//
// Escalas confirmadas por engenharia reversa dos dumps reais (fw 1.21):
//   Delay(0x1C00):    raw[6]=param[3], escala=8ms/unit
//   TapeEcho(0x1880): raw[6]=param[3], escala=10ms/unit
//   ReverseDL:        raw[6]=param[3], escala=20ms/unit
//   FilterDly(0x287C):raw[6]=param[3], escala≈7.8ms/unit
//   StompDly:         raw[6]=param[3], escala≈3.5ms/unit
//   MultiTapD(0x286D):raw[6]=param[3], escala≈46.9ms/unit
//   PitchDly(0x2816): raw[7]=param[4], escala=9ms/unit
//   Phaser(0x004C):   raw[3]=param[0], escala÷2 (rate Hz×2)
//   Flanger(0x1080):  raw[4]=param[1], escala×8 (rate Hz×8)
//   Chorus(0x0480):   raw[6]=param[3], escala÷2 (rate Hz×2)
//   Tremolo(0x0614):  raw[4]=param[1], escala÷4 (rate Hz÷4→val)
//   Vibrato(0x090C):  raw[9]=param[6], escala÷2 (rate Hz÷2→val)
//
// Fórmulas de conversão BPM → ms/Hz:
//   Time: ms = 60000 / bpm  (1/4 note)
//   Rate: Hz = bpm / 60
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// TAP_PARAM_MAP — fonte: dumps reais (fw 1.21) + firmware ZDL
//
// id3 = (raw[0]<<14)|(raw[1]<<7)|raw[2]  ← parser de 3 bytes
// raw  = índice absoluto no rawSlot[] onde fica o parâmetro
// tipo = 'ms' (tempo) ou 'hz' (frequência)
// escala: valor SysEx = round(ms/escala) ou round(hz*escala)
//
// ✅ = confirmado por dump real  |  ⚠️ = inferido do ZDL
// ══════════════════════════════════════════════════════════════════
const TAP_PARAM_MAP = {
  // ✅ = confirmado por dump real (fw 1.21)
  // FÓRMULA ms:  val = round((60000/bpm) / escala)
  // FÓRMULA hz:  val = round(bpm/60 × escala)
  // rawIdx = índice absoluto no rawSlot[]
  // ─── Delays (Time) ──────────────────────────────────────────────
  0x1C00:({raw:6, tipo:'ms', escala:7.143}),    // Delay     ✅ E5  500ms→70
  0x280B:({raw:6, tipo:'ms', escala:7.143}),    // Delay     ✅ J0
  0x0052:({raw:6, tipo:'ms', escala:8.929}),    // TapeEcho  ✅ banco C (pré-reset)
  0x1880:({raw:6, tipo:'ms', escala:8.929}),    // TapeEcho  ✅ E9  500ms→56
  0x287C:({raw:6, tipo:'ms', escala:7.813}),    // FilterDly ✅ E6  500ms→64
  0x286D:({raw:6, tipo:'ms', escala:7.813}),    // MultiTapD ✅ E7
  0x2816:({raw:7, tipo:'ms', escala:50.0}),     // PitchDly  ✅ E8  500ms→10
  0x0010:({raw:6, tipo:'ms', escala:10.0}),     // Rev/Stomp ✅ raw[2] discrimina escala real
  0x0990:({raw:6, tipo:'ms', escala:5.208}),    // StereoDly ✅ E9  500ms→96
  0x0050:({raw:6, tipo:'ms', escala:7.143}),    // CarbonDly ⚠  a confirmar
  // ─── Modulações (Rate) ──────────────────────────────────────────
  0x0480:({raw:6, tipo:'hz', escala:25.0}),     // Chorus    ✅ E0  rate25→50
  0x1080:({raw:4, tipo:'hz', escala:28.0}),     // Flanger   ✅ E1  rate7→56
  0x214C:({raw:4, tipo:'hz', escala:28.0}),     // Flanger   ✅ J0
  0x004C:({raw:3, tipo:'hz', escala:12.0}),     // Phaser    ✅ E2  rate12→24
  0x1400:({raw:6, tipo:'hz', escala:25.0}),     // SuperCho  ✅ E3  rate50→50
  0x0614:({raw:2, tipo:'hz', escala:4.0}),      // Tremolo   ✅ E4  rate33→8
  0x0180:({raw:2, tipo:'hz', escala:4.0}),      // Tremolo   ✅ J0
  0x090C:({raw:9, tipo:'hz', escala:7.5}),      // Vibrato   ✅ E4  rate30→15
  0x000C:({raw:6, tipo:'hz', escala:15.0}),     // Ensemble  ⚠  raw[2] discrimina StereCho
  0x0000:({raw:3, tipo:'hz', escala:3.0}),      // TheVibe   ⚠
  0x0080:({raw:9, tipo:'hz', escala:6.0}),      // fCycle    ✅ E4  rate6→12
  0x208C:({raw:3, tipo:'hz', escala:20.0}),     // DuoPhase  ⚠
  0x0200:({raw:3, tipo:'hz', escala:3.0}),      // CoronaTri ⚠
  0x060A:({raw:6, tipo:'hz', escala:25.0}),     // BendChorus⚠  mesma família Chorus
};

// Tap Tempo — dispara SYSEX_IDLE_MS após último toque
function enviarSysExTapTempo(bpm){
  if(sysexIdleTimer) clearTimeout(sysexIdleTimer);
  sysexIdleTimer = setTimeout(async()=>{
    if(!midiOut||!midiReady){
      showToast('TAP: SEM MIDI');
      return;
    }

    const bpmCalc = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
    const ms  = Math.round(60000 / bpmCalc);  // 1/4 note
    const hz  = bpmCalc / 60;

    // Diagnóstico 1: patch carregado?
    const total   = patchAtual.efeitos.length;
    const comTap  = patchAtual.efeitos.filter(e=>e.tap).length;
    const comRaw  = patchAtual.efeitos.filter(e=>e.tap&&e.rawSlot).length;
    const ativos  = patchAtual.efeitos.filter(e=>e.enabled&&e.tap&&e.rawSlot).length;

    if(total === 0){
      showToast(`TAP ${bpmCalc}bpm · SEM DUMP (navegue p/ carregar)`);
      return;
    }
    if(comTap === 0){
      const nomes = patchAtual.efeitos.map(e=>`${e.nome}(0x${e.id.toString(16).toUpperCase()})`).join(' ');
      showToast(`TAP ${bpmCalc}bpm · NENHUM FX c/Time/Rate · ${nomes}`);
      return;
    }
    if(comRaw === 0){
      showToast(`TAP ${bpmCalc}bpm · FX c/tap mas sem rawSlot — redump`);
      return;
    }
    if(ativos === 0){
      const tapFx = patchAtual.efeitos.filter(e=>e.tap).map(e=>e.nome).join(' ');
      showToast(`TAP ${bpmCalc}bpm · FX desativados: ${tapFx}`);
      return;
    }

    // Handshake completo
    await forcarEditor();

    // Itera sobre todos os slots do patch atual com Time ou Rate
    const efeitosAlvo = patchAtual.efeitos.filter(e => e.enabled && e.tap && e.rawSlot);
    if(efeitosAlvo.length === 0){
      showToast(`TAP ${bpmCalc}bpm — nenhum efeito ativo com Time/Rate`);
      logMIDI({type:'sx', label:`TAP ${bpmCalc}bpm — nenhum efeito ativo com Time/Rate`});
      return;
    }

    const enviados = [];
    for(const efeito of efeitosAlvo){
      // id3 = (raw[0]<<14)|(raw[1]<<7)|raw[2] — mesmo parser do parseZoomDump
      const id3 = efeito.id;  // já calculado como id3 no parseZoomDump
      const map = TAP_PARAM_MAP[id3];
      if(!map){
        showToast(`TAP: ${efeito.nome} ID=0x${id3.toString(16).toUpperCase()} SEM MAPA`);
        logMIDI({type:'sx', label:`TAP ${bpmCalc}bpm — ${efeito.nome}(0x${id3.toString(16).toUpperCase()}) sem mapeamento`});
        continue;
      }

      // Calcula valor a enviar
      let val;
      if(map.tipo === 'ms'){
        val = Math.round(ms / map.escala);
      } else {
        val = Math.round(hz * map.escala);
      }
      val = Math.max(0, Math.min(127, val));

      // raw[] = índice absoluto no slot raw (confirmado por dumps reais)
      // O SysEx Param Set usa esse mesmo índice diretamente
      const slotIdx = efeito.slotIdx;   // 0-4
      const rawIdx  = map.raw;          // índice absoluto no rawSlot[]
      const valLo   = val & 0x7F;
      const valHi   = (val >> 7) & 0x7F;

      try{
        midiOut.send([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
                      slotIdx, rawIdx, valLo, valHi, 0xF7]);
        enviados.push(`${efeito.nome}→${val}`);
        logMIDI({type:'sx', label:`TAP ${bpmCalc}bpm → ${efeito.nome} slot${slotIdx} raw[${rawIdx}] val=${val}`});
      } catch(e){
        logMIDI({type:'err', label:`TAP ERR ${efeito.nome}: ${e.message}`});
      }
      await sleep(SYSEX_DELAY);
    }

    if(enviados.length > 0){
      showToast(`TAP ${bpmCalc}bpm · ${ms}ms · ${enviados.join(' · ')}`);
    }
    piscarIndicador();
  }, SYSEX_IDLE_MS);
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
  const btn=fsEls[5];
  btn.classList.add('tap-beat'); btn.classList.remove('tap-off');
  if(tapLedTimer) clearTimeout(tapLedTimer);
  tapLedTimer=setTimeout(()=>{btn.classList.remove('tap-beat');btn.classList.add('tap-off');},80);
}

function iniciarPiscarBeat(intervalMs){
  if(tapBeatTimer) clearInterval(tapBeatTimer);
  const onMs=Math.min(80,intervalMs*0.15);
  tapBeatTimer=setInterval(()=>{
    if(bankSelect) return;
    const btn=fsEls[5];
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
for(let i=0;i<6;i++){
  const col=document.createElement('div');col.className='fs-col';
  const btn=document.createElement('div');btn.className='fs-btn';
  btn.setAttribute('role','button');btn.setAttribute('tabindex','0');
  btn.appendChild(document.createTextNode(i<5?`FS${i+1}`:'FS6'));
  if(i===5){
    const s=document.createElement('span');
    s.style.cssText='font-size:7px;opacity:.6;display:block;margin-top:1px';
    s.textContent='TAP';btn.appendChild(s);btn.classList.add('tap-btn');
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
  const btn = fsEls[2];
  btn.classList.toggle('tuner-on', tunerAtivo);
  labelEls[2].textContent = tunerAtivo ? '🎸 AFINAR' : (labelEls[2].dataset.nomePatch || '· · ·');
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
    // Hold: FS3(idx=2) → tuner | FS6(idx=5) → bank select
    if(idx===2) holdTimers[idx]=setTimeout(toggleTuner, HOLD_MS);
    if(idx===5) holdTimers[idx]=setTimeout(onFS6Hold,   HOLD_MS);
  }
  function onRelease(isTouch){
    if(isTouch) touchAtivo[idx]=false;
    el.classList.remove('pressed');
    const held=Date.now()-(pressTimes[idx]||0);
    clearTimeout(holdTimers[idx]);
    if(idx===5){ if(held<HOLD_MS) onFS6Tap(); }
    else if(idx===2){ if(held<HOLD_MS && !tunerAtivo) onFSPatch(idx); } // tap normal no FS3 — bloqueado se tuner ativo
    else onFSPatch(idx);
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
