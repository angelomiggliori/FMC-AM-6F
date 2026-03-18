// FMC-AM 6F · Motor v4.2 — fmc-engine.js — build: v4.2-b20260316-tap9
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
  // Fonte primária: dump3 (100 patches nome=efeito, fw 1.21)
  // Fonte secundária: dump profundo E0-E9 + dump J0
  // id2 = (raw[0]<<7)|raw[1]  |  raw[2] = byte MSBs params
  // IDs com ⚠ são compartilhados → discriminados por raw[2] no SHARED
  // ══════════════════════════════════════════════════════════════════
  // ── Dynamics / Filter ────────────────────────────────────────────
  0x0101:({n:'Comp',      c:'dynamics', t:null}),
  0x0105:({n:'SlowAtck',  c:'filter',   t:null}),
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
  0x2407:({n:'VXCombo',   c:'amp',      t:null}),
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
  0x0600:({n:'MonoPitch', c:'pitch',    t:null}),
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
  0x2901:({n:'Rvb01b', c:'reverb',   t:null}),
  0x2903:({n:'Rvb03b', c:'reverb',   t:null}),
  0x2906:({n:'Rvb06b', c:'reverb',   t:null}),
  0x2907:({n:'Rvb07b', c:'reverb',   t:null}),
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
};

// Seed cache: 36 patches reais coletados do full dump (fw 1.21)
const PATCH_CACHE_SEED = {
  'A0':{nome:'Graphi',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:515,nome:'GraphicEQ',cat:'filter',tap:null,enabled:false}],ts:0},
  'A1':{nome:'ParaEQ',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:514,nome:'ParaEQ',cat:'filter',tap:null,enabled:false}],ts:0},
  'A2':{nome:'160 Co',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:265,nome:'160Comp',cat:'dynamics',tap:null,enabled:true}],ts:0},
  'A3':{nome:'AutoWa',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:8708,nome:'AutoWah',cat:'filter',tap:null,enabled:false}],ts:0},
  'A4':{nome:'Comp',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:257,nome:'Comp',cat:'dynamics',tap:null,enabled:true}],ts:0},
  'A5':{nome:'Cry',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:513,nome:'Cry',cat:'filter',tap:null,enabled:true}],ts:0},
  'A6':{nome:'Excite',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:512,nome:'Exciter',cat:'filter',tap:null,enabled:false}],ts:0},
  'A7':{nome:'fCycle',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:8705,nome:'fCycle',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'A8':{nome:'M-Filt',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:526,nome:'MFilter',cat:'filter',tap:null,enabled:false}],ts:0},
  'A9':{nome:'NoiseGe',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'NoiseGate',cat:'dynamics',tap:null,enabled:false}],ts:0},
  'B0':{nome:'OptCom 0',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:8449,nome:'OptComp',cat:'dynamics',tap:null,enabled:true}],ts:0},
  'B1':{nome:'RndmFLR',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:520,nome:'RndmFltr',cat:'filter',tap:null,enabled:true}],ts:0},
  'B2':{nome:'SeqFLT',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:513,nome:'SeqFilter',cat:'filter',tap:null,enabled:true}],ts:0},
  'B3':{nome:'SlowATCK',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:261,nome:'SlowAtck',cat:'filter',tap:null,enabled:false}],ts:0},
  'B4':{nome:'Step',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:527,nome:'StepFltr',cat:'filter',tap:null,enabled:false}],ts:0},
  'B5':{nome:'ZNR    0',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:8450,nome:'ZNR',cat:'dynamics',tap:null,enabled:false}],ts:0},
  'B6':{nome:'Aco.Si',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:788,nome:'Amp',cat:'amp',tap:null,enabled:false}],ts:0},
  'B7':{nome:'Booste',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:788,nome:'Amp',cat:'amp',tap:null,enabled:false}],ts:0},
  'B8':{nome:'Dist 1',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'B9':{nome:'Dist+',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:788,nome:'Amp',cat:'amp',tap:null,enabled:false}],ts:0},
  'C0':{nome:'ExtremS',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'C1':{nome:'FuzzSme',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:785,nome:'Fuzz',cat:'drive',tap:null,enabled:true}],ts:0},
  'C2':{nome:'Govern',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'C3':{nome:'GreatMf',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:785,nome:'Fuzz',cat:'drive',tap:null,enabled:true}],ts:0},
  'C4':{nome:'ALIEN',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1039,nome:'ALIEN',cat:'amp',tap:null,enabled:true}],ts:0},
  'C5':{nome:'HotBox',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'C6':{nome:'Lead',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'C7':{nome:'MetalWL',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'C8':{nome:'OverDre',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'C9':{nome:'Squeak',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:778,nome:'Squeak',cat:'drive',tap:null,enabled:false}],ts:0},
  'D0':{nome:'T Scre',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:785,nome:'Fuzz',cat:'drive',tap:null,enabled:true}],ts:0},
  'D1':{nome:'Z Clea',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'D2':{nome:'Z MP1',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'D3':{nome:'Z Scre',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'D4':{nome:'Z Wild',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:783,nome:'Drive',cat:'drive',tap:null,enabled:false}],ts:0},
  'D5':{nome:'B-BREA',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9231,nome:'BlackBrth',cat:'amp',tap:null,enabled:false}],ts:0},
  'D6':{nome:'BG CRUC',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9230,nome:'USBlues',cat:'amp',tap:null,enabled:false}],ts:0},
  'D7':{nome:'BG DRIE',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9227,nome:'DZDrive',cat:'amp',tap:null,enabled:true}],ts:0},
  'D8':{nome:'BGN DRE',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1045,nome:'BGNDrive',cat:'amp',tap:null,enabled:false}],ts:0},
  'D9':{nome:'CAR DRE',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9228,nome:'CARDrive',cat:'amp',tap:null,enabled:true}],ts:0},
  'E0':{nome:'DELUXE',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1036,nome:'VXJimi',cat:'amp',tap:null,enabled:true}],ts:0},
  'E1':{nome:'DZ DRIE',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9227,nome:'DZDrive',cat:'amp',tap:null,enabled:false}],ts:0},
  'E2':{nome:'FD COMO',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1030,nome:'FDCombo',cat:'amp',tap:null,enabled:false}],ts:0},
  'E3':{nome:'FD VIBO',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1038,nome:'MS1959',cat:'amp',tap:null,enabled:false}],ts:0},
  'E4':{nome:'HW STA',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1037,nome:'HWStar',cat:'amp',tap:null,enabled:true}],ts:0},
  'E5':{nome:'MS 195',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1038,nome:'MS1959',cat:'amp',tap:null,enabled:true}],ts:0},
  'E6':{nome:'MATCH',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1031,nome:'Matchless',cat:'amp',tap:null,enabled:false}],ts:0},
  'E7':{nome:'MS CRUC',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1042,nome:'MSCrunch',cat:'amp',tap:null,enabled:false}],ts:0},
  'E8':{nome:'MS DRIE',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1044,nome:'MSDrive',cat:'amp',tap:null,enabled:true}],ts:0},
  'E9':{nome:'REVO-1',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1040,nome:'REVO1',cat:'amp',tap:null,enabled:false}],ts:0},
  'F0':{nome:'TANGERE',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1041,nome:'Tangerine',cat:'amp',tap:null,enabled:true}],ts:0},
  'F1':{nome:'TONE CY',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1043,nome:'ToneCycle',cat:'amp',tap:null,enabled:true}],ts:0},
  'F2':{nome:'TW ROC',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9229,nome:'TWRock',cat:'amp',tap:null,enabled:false}],ts:0},
  'F3':{nome:'US BLU',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9230,nome:'USBlues',cat:'amp',tap:null,enabled:true}],ts:0},
  'F4':{nome:'VX COMO',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9223,nome:'VXCombo',cat:'amp',tap:null,enabled:true}],ts:0},
  'F5':{nome:'VX JMI',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1036,nome:'VXJimi',cat:'amp',tap:null,enabled:true}],ts:0},
  'F6':{nome:'BendCh',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1546,nome:'BendChorus',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'F7':{nome:'BitCru',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9985,nome:'BitCrush',cat:'special',tap:null,enabled:false}],ts:0},
  'F8':{nome:'Bomber 0',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9984,nome:'Bomber',cat:'special',tap:null,enabled:true}],ts:0},
  'F9':{nome:'Chorus',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1546,nome:'Chorus',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'G0':{nome:'Coronari',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9734,nome:'CoronaRing',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'G1':{nome:'Detune',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9736,nome:'Detune',cat:'pitch',tap:null,enabled:true}],ts:0},
  'G2':{nome:'DuoPha',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:1547,nome:'DuoPhase',cat:'mod',tap:'Rate',enabled:true}],ts:0},
  'G3':{nome:'Ensembe',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1546,nome:'Ensemble',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'G4':{nome:'Flange',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:9739,nome:'VinFLNGR',cat:'mod',tap:'Rate',enabled:true}],ts:0},
  'G5':{nome:'HPS    h',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1537,nome:'HPS',cat:'pitch',tap:null,enabled:true}],ts:0},
  'G6':{nome:'MonoPich',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1536,nome:'MonoPitch',cat:'pitch',tap:null,enabled:false}],ts:0},
  'G7':{nome:'Octave h',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1556,nome:'Octave',cat:'pitch',tap:null,enabled:false}],ts:0},
  'G8':{nome:'Phaser',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:9730,nome:'Phaser',cat:'mod',tap:'Rate',enabled:true}],ts:0},
  'G9':{nome:'PitchSFT',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9732,nome:'PitchSHFT',cat:'pitch',tap:null,enabled:true}],ts:0},
  'H0':{nome:'RingMo',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:9734,nome:'RingMod',cat:'mod',tap:'Rate',enabled:true}],ts:0},
  'H1':{nome:'Rt Clo',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1804,nome:'RtCloset',cat:'special',tap:null,enabled:true}],ts:0},
  'H2':{nome:'Slicer',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1536,nome:'Slicer',cat:'special',tap:null,enabled:false}],ts:0},
  'H3':{nome:'Stereo',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1556,nome:'StereCho',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'H4':{nome:'SuperCo',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:1548,nome:'SuperCho',cat:'mod',tap:'Rate',enabled:true}],ts:0},
  'H5':{nome:'TheVib',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:9734,nome:'TheVibe',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'H6':{nome:'Tremol',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1556,nome:'Tremolo',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'H7':{nome:'VinFLN',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:9739,nome:'VinFLNGR',cat:'mod',tap:'Rate',enabled:true}],ts:0},
  'H8':{nome:'Vibrat',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1546,nome:'Vibrato',cat:'mod',tap:'Rate',enabled:false}],ts:0},
  'H9':{nome:'Z-Orga',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:1809,nome:'Z-Organ',cat:'special',tap:null,enabled:true}],ts:0},
  'I0':{nome:'Air    0',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:10500,nome:'Air',cat:'reverb',tap:null,enabled:true}],ts:0},
  'I1':{nome:'Arena',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:2307,nome:'Arena',cat:'reverb',tap:null,enabled:true}],ts:0},
  'I2':{nome:'Carbonly',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:10336,nome:'CarbonDly',cat:'delay',tap:'Time',enabled:true}],ts:0},
  'I3':{nome:'Delay',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:10251,nome:'Delay',cat:'delay',tap:'Time',enabled:true}],ts:0},
  'I4':{nome:'EarlyR',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:2307,nome:'EarlyRef',cat:'reverb',tap:null,enabled:true}],ts:0},
  'I5':{nome:'Filterly',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:10364,nome:'FilterDly',cat:'delay',tap:'Time',enabled:true}],ts:0},
  'I6':{nome:'Hall',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:10498,nome:'Hall',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I7':{nome:'HD Hal P',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:2324,nome:'HDHall',cat:'reverb',tap:null,enabled:false}],ts:0},
  'I8':{nome:'ModRevb',volume:0,temTime:false,temRate:true,efeitos:[{slot:1,id:2313,nome:'ModReverb',cat:'reverb',tap:'Rate',enabled:true}],ts:0},
  'I9':{nome:'MultiTD',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:10349,nome:'MultiTapD',cat:'delay',tap:'Time',enabled:true}],ts:0},
  'J0':{nome:'ParticeR',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:2314,nome:'ParticleR',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J1':{nome:'PitchDy',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:10262,nome:'PitchDly',cat:'delay',tap:'Time',enabled:false}],ts:0},
  'J2':{nome:'Plate',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:2306,nome:'Plate',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J3':{nome:'ReversL',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:2167,nome:'ReverseDL',cat:'delay',tap:'Time',enabled:true}],ts:0},
  'J4':{nome:'Room   P',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:10498,nome:'Room',cat:'reverb',tap:null,enabled:false}],ts:0},
  'J5':{nome:'Spring3',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:10504,nome:'Spring63',cat:'reverb',tap:null,enabled:true}],ts:0},
  'J6':{nome:'Stereoly',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:2089,nome:'StereoDly',cat:'delay',tap:'Time',enabled:false}],ts:0},
  'J7':{nome:'-      @',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:2055,nome:'StompDly',cat:'delay',tap:'Time',enabled:true}],ts:0},
  'J8':{nome:'StompDy',volume:0,temTime:true,temRate:false,efeitos:[{slot:1,id:2055,nome:'StompDly',cat:'delay',tap:'Time',enabled:true}],ts:0},
  'J9':{nome:'TiledR',volume:0,temTime:false,temRate:false,efeitos:[{slot:1,id:10500,nome:'TiledRoom',cat:'reverb',tap:null,enabled:true}],ts:0},
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
    if(id2 === 0 && !en) continue;
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
  const tapBtn = fsEls[5];
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
  const fi=document.getElementById('fxIndicators'); if(fi) fi.innerHTML='';
  fsEls[5].classList.remove('delay-sync','rate-sync');
  atualizarDisplayVolume(null);
  // Reseta boost visual sempre que o patch muda
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

// ── Constantes do calibrador ────────────────────────────────────
const TAP_RAW_CACHE_KEY = 'fmc-tap-rawcache';
const TAP_PARAM_OFFSET  = 6;    // rawSlot[6] = Param 1 do efeito
const TAP_MAX_PROBE     = 8;    // máximo de paramIdx a tentar
const TAP_PROBE_DELAY   = 150;  // ms: envia teste → pede dump
const TAP_TEST_VAL      = 64;   // valor de teste (meio da escala, fácil de detectar)

// Escalas conservadoras por família (usadas antes de calibração de escala)
const TAP_FAMILIA_ESCALA = {
  'delay-08': { escala: 8.0,  tipo: 'ms' },
  'delay-28': { escala: 31.5, tipo: 'ms' },
  'mod-06':   { escala: 12.0, tipo: 'hz' },
  'mod-26':   { escala: 12.0, tipo: 'hz' },
};

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

// ── Enviar tap para um efeito ────────────────────────────────────
// MODO PALCO: se paramIdx não estiver no cache, avisa e pula.
// MODO CALIBRAÇÃO: nunca entra aqui direto — calibração roda separado.
async function enviarTapEfeito(efeito, bpmCalc, ms, hz){
  const slotIdx = efeito.slotIdx;
  let mapa = lerTapCache(efeito.id);

  // Sem cache direto → tenta herdar da família
  if(!mapa){
    const familia = familiaDoId(efeito.id);
    if(familia){
      const fc = lerTapCacheFamilia(familia);
      if(fc){
        const esc = TAP_FAMILIA_ESCALA[familia] || { escala:8.0, tipo:'ms' };
        mapa = { paramIdx: fc.paramIdx, escala: esc.escala, tipo: esc.tipo };
        gravarTapCache(efeito.id, familia, fc.paramIdx, esc.escala, esc.tipo);
      }
    }
  }

  // Ainda sem mapa → avisa mas NÃO calibra automaticamente no palco
  if(!mapa){
    showToast(`TAP: ${efeito.nome} não calibrado · rode CAL antes do show`);
    logMIDI({type:'err', label:`TAP SKIP ${efeito.nome} — sem cache, rode calibração`});
    return null;
  }

  // Calcula e envia
  let val = mapa.tipo === 'ms'
    ? Math.round(ms / mapa.escala)
    : Math.round(hz * mapa.escala);
  val = Math.max(0, Math.min(127, val));

  const lo = val & 0x7F;
  const hi = (val >> 7) & 0x7F;

  await garantirEditor();  // FIX: garante editor aberto antes do Param Set

  try{
    midiOut.send([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
                  slotIdx, mapa.paramIdx, lo, hi, 0xF7]);
    logMIDI({type:'sx',
      label:`TAP ${bpmCalc}bpm → ${efeito.nome} slot${slotIdx} param[${mapa.paramIdx}] val=${val}`});
    return `${efeito.nome}@S${slotIdx+1}p${mapa.paramIdx}→${val}`;
  } catch(e){
    logMIDI({type:'err', label:`TAP ERR ${efeito.nome}: ${e.message}`});
    return null;
  }
}
//

// Tap Tempo — dispara SYSEX_IDLE_MS após último toque
function enviarSysExTapTempo(bpm){
  if(sysexIdleTimer) clearTimeout(sysexIdleTimer);
  sysexIdleTimer = setTimeout(async()=>{
    if(!midiOut||!midiReady){
      showToast('TAP: SEM MIDI');
      return;
    }

    const bpmCalc = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
    const ms  = Math.round(60000 / bpmCalc);
    const hz  = bpmCalc / 60;

    // Diagnóstico: patch carregado?
    if(patchAtual.efeitos.length === 0){
      showToast(`TAP ${bpmCalc}bpm · SEM DUMP (navegue p/ carregar)`);
      return;
    }
    const efeitosAlvo = patchAtual.efeitos.filter(e => e.tap && e.rawSlot);
    if(efeitosAlvo.length === 0){
      const nomes = patchAtual.efeitos.map(e=>`${e.nome}`).join(' · ');
      showToast(`TAP ${bpmCalc}bpm · sem Time/Rate · ${nomes}`);
      return;
    }

    // Garante editor aberto antes de qualquer envio
    await forcarEditor();

    const enviados = [];
    for(const efeito of efeitosAlvo){
      const resultado = await enviarTapEfeito(efeito, bpmCalc, ms, hz);
      if(resultado) enviados.push(resultado);
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

