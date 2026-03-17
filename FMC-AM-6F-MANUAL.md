# FMC-AM 6F — Manual Técnico Completo

**Controladora MIDI Virtual para Zoom G1On**  
Versão: `v5.1-b20260317` | Autor: Angelo Miggliori  
Protocolo confirmado: G1On fw 1.21, model ID `0x63`

---

## Índice

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Arquitetura dos Arquivos](#2-arquitetura-dos-arquivos)
3. [Protocolo MIDI — Zoom G1On](#3-protocolo-midi--zoom-g1on)
4. [Parser do Dump SysEx 0x28](#4-parser-do-dump-sysex-0x28)
5. [Banco de Efeitos (ZOOM_FX_DB)](#5-banco-de-efeitos-zoom_fx_db)
6. [SHARED — Módulos Compartilhados](#6-shared--módulos-compartilhados)
7. [Sistema de Cache e Seed](#7-sistema-de-cache-e-seed)
8. [Tap Tempo](#8-tap-tempo)
9. [ToneWebLib — Signal Chain Visual](#9-toneweblib--signal-chain-visual)
10. [Boost de Volume](#10-boost-de-volume)
11. [Footswitches e Navegação](#11-footswitches-e-navegação)
12. [Tuner](#12-tuner)
13. [Sistema de Dados Externos](#13-sistema-de-dados-externos)
14. [Editor de Configuração](#14-editor-de-configuração)
15. [Ferramentas de Diagnóstico](#15-ferramentas-de-diagnóstico)
16. [Engenharia Reversa — Histórico Completo](#16-engenharia-reversa--histórico-completo)
17. [Como Contribuir / Continuar](#17-como-contribuir--continuar)

---

## 1. Visão Geral do Projeto

O FMC-AM 6F é uma **controladora MIDI virtual** que roda no browser via Web MIDI API. Comunica-se diretamente com a Zoom G1On via USB/MIDI SysEx proprietário, permitindo:

- Navegar pelos 100 patches (bancos A–J, patches 0–9)
- Ver nome do patch, signal chain completa, volume em tempo real
- Editar parâmetros de efeitos via ToneWebLib (sliders com live preview)
- Tap Tempo sincronizado com delays e modulações
- Tuner via SysEx
- Boost de volume por patch
- Cache local de patches para resposta instantânea
- 12 footswitches: patches 0–4 (top), BANK (top-right), patches 5–9 (bottom), TAP (bottom-right)

**Stack técnica:** HTML + CSS + JavaScript puro · Web MIDI API nativa (Chrome/Edge) · fmc-engine.js motor único · dados externos via `data/*.json` · persistência via localStorage

**Limitação:** Web MIDI API só funciona em Chrome/Edge desktop.

---

## 2. Arquitetura dos Arquivos

```
FMC-AM-6F/
├── fmc-engine.js           ← Motor único — toda a lógica MIDI aqui
├── fmc-data-manager.js     ← I/O GitHub API (leitura/escrita JSONs externos)
├── fmc-settings.html       ← Painel de configuração (auth SHA-256)
│
├── theme-headrush.html     ← Tema HeadRush Prime (12 FS, ToneWebLib)
├── theme-boss.html         ← Tema Boss ME-90
├── theme-kemper.html       ← Tema Kemper
├── theme-zoom.html         ← Tema Zoom nativo
│
├── index.html              ← Hub de navegação
├── pedalboard-v4.html      ← GUI compacta
├── pedalboard-v2.html      ← GUI legada
├── pedalboard-sim.html     ← Simulador sem MIDI
├── fmc-editor.html         ← Editor visual de configuração
├── full-dump.html          ← Varre A0→J9, exporta JSON
├── auto-dump.html          ← Dump rápido do banco ativo
├── dump-e0e9.html          ← Dump profundo banco E
├── midi-sniffer.html       ← Monitor MIDI em tempo real
├── tap-debug.html          ← Debug de tap tempo
│
└── data/
    ├── patch-cache.json    ← 100 patches reais do fulldump (cat/tap corretos)
    ├── fx-db.json          ← 143+ efeitos mapeados
    ├── fx-params.json      ← Parâmetros extraídos dos ZDL (tapParamIdx)
    ├── tap-cache.json      ← Cache de calibração de tap (populado ao vivo)
    ├── bank-colors.json    ← Cores dos bancos A–J
    ├── cat-colors.json     ← Cores das categorias de efeitos
    ├── led-config.json     ← Config dos LEDs NeoPixel
    ├── fs-config.json      ← Config dos footswitches
    ├── timing.json         ← Timings MIDI
    ├── boost.json          ← Config do boost de volume
    └── meta.json           ← Metadados do projeto
```

### Como os temas carregam o engine

Cada HTML de tema declara `THEME_NAME` e `THEME_FS` **antes** de incluir o engine:

```html
<script>
  const THEME_NAME = 'HeadRush Prime · FMC-AM 6F';
  const THEME_FS   = 12;  // 6 ou 12 footswitches
</script>
<script src="fmc-engine.js"></script>
```

O engine lê os elementos HTML pelo ID e os atualiza diretamente. **Nenhuma lógica MIDI nos arquivos de tema.**

IDs HTML obrigatórios: `patchId`, `patchName`, `fxIndicators`, `patchVolume`, `bpmVal`, `fsGrid`, `mainDisplay`, `midiBarDot`, `midiBarTexto`, `midiBarBtn`, `modeBadge`, `boostBtn`, `toast`, `midiIndicator`, `midiPortLabel`, `memStatus`, `flashHealth`, `calBtn`

---

## 3. Protocolo MIDI — Zoom G1On

### Identificação

| Parâmetro | Valor | Notas |
|---|---|---|
| Fabricante SysEx | `0x52` | Zoom |
| Device | `0x00` | |
| Model ID | `0x63` | G1On fw 1.21 (não `0x61`) |

### Sequência de Handshake (obrigatória)

```
1. TX: F0 7E 00 06 01 F7              → Identity Request
   RX: F0 7E 00 06 02 52 63 ... F7   → confirma model=0x63

2. TX: F0 52 00 63 50 F7              → Edit ON

3. TX: F0 52 00 63 33 F7              → Ping  ← OBRIGATÓRIO
```

**⚠️ Crítico:** Sem o ping `0x33`, a G1On aceita o Edit ON mas ignora Dump Requests.

### Comandos SysEx

```js
const CMD_EDIT_ON  = 0x50;  // Ativa modo editor
const CMD_EDIT_OFF = 0x51;  // Desativa (grava no flash — EVITAR)
const CMD_DUMP_REQ = 0x29;  // Requisita dump do patch atual
const CMD_DUMP_RES = 0x28;  // Resposta dump (134 bytes)
const CMD_PARAM    = 0x31;  // Set parâmetro individual
```

### Requisitar Dump

```
TX: F0 52 00 63 29 F7
RX: F0 52 00 63 28 [129 bytes payload] F7  (134 bytes total)
```

### Set Parâmetro (CMD_PARAM)

```
TX: F0 52 00 63 31 [slotIdx] [paramIdx] [valLo] [valHi] F7
```

- `slotIdx`: 0–4
- `paramIdx`: índice do parâmetro no slot (0 = byte enable/ID)
- `valLo = val & 0x7F`, `valHi = (val>>7) & 0x7F`

**Enable/Disable de efeito:**
```js
// enabled está em rawSlot[3] bit7
const val = ef.enabled ? (rawSlot[3] | 0x80) : (rawSlot[3] & 0x7F);
midiOut.send([0xF0, 0x52, 0x00, 0x63, 0x31, slotIdx, 0, val & 0x7F, (val>>7) & 0x7F, 0xF7]);
```

### Program Change

```
TX: C0 [bankIndex * 10 + patchIndex]
```

### Tuner

```
TX: F0 52 00 63 03 42 F7  → ON
TX: F0 52 00 63 03 43 F7  → OFF
```

### Estratégia do Editor

- Abre uma vez ao conectar, **nunca fecha entre patches**
- `CMD_EDIT_OFF` grava no flash: latência 800ms+, evitar
- Watchdog de 4 minutos reabre automaticamente

**Timings confirmados:**
```js
const SYSEX_IDLE_MS = 50;    // idle antes de enviar
const SYSEX_DELAY   = 80;    // entre mensagens SysEx
const PC_TO_DUMP_MS = 500;   // após PC antes de dump request
const HOLD_MS       = 900;   // hold de footswitch
```

---

## 4. Parser do Dump SysEx 0x28

### Estrutura do dump (134 bytes raw)

```
[0]        = 0xF0   SysEx start
[1]        = 0x52   Zoom MFR
[2]        = 0x00   Device
[3]        = 0x63   Model ID
[4]        = 0x28   Dump Response CMD
[5..109]   = Payload 7-bit packed (5 slots × 18 bytes unpacked → ~105 packed)
[110]      = Patch Output Volume (0–120)   ← OFFSET CRÍTICO
[111]      = 0x00 padding
[112..132] = Nome do patch (7-bit packed, max 12 chars)
[133]      = 0xF7   SysEx end
```

### Packing 7-bit SysEx

A cada 7 bytes de dados, precede com 1 byte de MSBs (bit7 de cada byte):

```js
function unpack7bitStream(data, start) {
  const out = [];
  let i = start;
  while (i < data.length - 1) {
    const msbs = data[i++];
    for (let bit = 0; bit < 7; bit++) {
      if (i >= data.length) break;
      out.push(data[i++] | (((msbs >> bit) & 1) << 7));
    }
  }
  return out;
}
```

### Estrutura de cada Slot (18 bytes unpacked)

```
off+0..2  = header bytes (artefatos do packing — MSBs dos params anteriores)
off+3     = (enabled<<7) | (id>>7)&0x7F   ← HIGH byte do ID + enabled flag
off+4     = id & 0x7F                      ← LOW byte do ID
off+5     = r2 (byte discriminador SHARED)
off+6..17 = parâmetros do efeito (12 bytes)
```

```js
const id2 = ((b3 & 0x7F) << 7) | (b4 & 0x7F);
const en  = ((b3 >> 7) & 1) === 1;   // rawSlot[3] bit7
if (id2 === 0) continue;              // skip incondicional — slot vazio
```

**⚠️ enabled = rawSlot[3] bit7** — não `rawSlot[0] & 0x01`. Corrigido em v5.1 após auditoria de 12 amostras.

### Slots não-contíguos são normais

A G1On permite gaps na chain. Patch D5: slot1=ZNR, slot2=VAZIO, slot3=BlackBrth. Comportamento real do hardware.

### Patch Output Volume

```js
const VOL_OFFSET = 110;
const volume = rawData[110];  // 0–120
```

Histórico: byte[14] foi testado e rejeitado — era o Level do efeito no slot 1.

---

## 5. Banco de Efeitos (ZOOM_FX_DB)

### Estrutura

```js
const ZOOM_FX_DB = {
  0x0101: ({n:'Comp',  c:'dynamics', t:null}),
  0x280B: ({n:'Delay', c:'delay',    t:'Time'}),
  // n=nome, c=categoria, t='Time'|'Rate'|null
};
```

### Categorias e cores

| Cat | Cor | Tap |
|---|---|---|
| dynamics | #ffd740 | — |
| filter   | #ff9e30 | — |
| drive    | #ff7a50 | — |
| amp      | #ff6688 | — |
| pitch    | #80ffea | — |
| mod      | #b388ff | Rate |
| delay    | #00e5ff | Time |
| reverb   | #6eb5ff | — |
| special  | #cc55ff | — |

### Família de IDs (heurística de fallback)

| Hi byte | Cat | Tap |
|---|---|---|
| 0x01, 0x21 | dynamics | — |
| 0x02, 0x22 | filter | — |
| 0x03, 0x23 | drive | — |
| 0x04, 0x24 | amp | — |
| 0x05, 0x25 | pitch | — |
| 0x06, 0x26 | mod | Rate |
| 0x07, 0x27 | special | — |
| 0x08, 0x28 | delay | Time |
| 0x09, 0x29 | reverb | — |

**Exceções intencionais:**
- `0x0314` Amp → `cat:'amp'` (hi=0x03 drive, mas é amp sim)
- `0x0600/0x0601/0x2604/0x2608` → `cat:'pitch'` `t:null` (pitch shifters na família 0x06)

### IDs família 0x00xx — identificados por engenharia reversa

Estes IDs não têm hi-byte de família. Identificados cruzando dumps com ToneLib e descrições dos patches de fábrica:

| ID | Nome | Cat | Tap | Evidência (certeza) |
|---|---|---|---|---|
| `0x0007` | CabSim | amp | — | Sempre junto com AmpSim. r2=0x28 fixo. A G1On usa 2 slots para amp+cab. (99%) |
| `0x0010` | GraphicEQ | filter | — | Params idênticos ao `0x0008`. Invisível no ToneLib. Módulo interno de EQ. (85%) |
| `0x0018` | StereoCho | mod | Rate | ToneLib A5: desc **"StereoCho effect"**. B1: **"shimmering chorus"**. (100%) |
| `0x0019` | CoronaTri | mod | Rate | ToneLib H3: desc **"CoronaTri gives a gorgeous 12-string sound"**. (100%) |
| `0x0020` | LongDelay | delay | Time | ToneLib G9: desc **"long delay sound for guitar solos"**. (90%) |
| `0x0028` | GraphicEQ | filter | — | EQ pós-amp. r2=0x20 fixo. params `[3,3,32,...]` idênticos. (85%) |
| `0x0030` | AcoSim | special | — | ToneLib B3: desc **"uses the Aco.Sim effect"**. r2=0x08 fixo. (100%) |
| `0x000C` | InternalFX | special | — | 1 ocorrência (C2 TRIPY slot4). Invisível no ToneLib. Desconhecido. (—) |
| `0x0000` | *(vazio)* | — | — | Skip incondicional. |

### Outros IDs identificados por engenharia reversa

| ID | Nome | Cat | Evidência |
|---|---|---|---|
| `0x080E` | Dly0E | delay | Família 0x08xx. J9 Power Lead. |
| `0x2004` | Bypass | special | ToneLib H0: mostra literalmente **"Bypass"** na chain. (100%) |
| `0x2006` | Detune12 | pitch | ToneLib C9: **"12-string guitar sound"**. (90%) |
| `0x200B` | AmpSim | amp | Família 0x20xx. Só no ToneLib, não no dump — fw anterior? |

### Nomes corrigidos confirmados pelo ToneLib (2026-03-17)

| ID | Era | Correto | Confirmação |
|---|---|---|---|
| `0x2407` | VXCombo | **DeluxeR** | ToneLib C2 TRIPY: slot1 mostra **"DELUXE-R"** (Fender Deluxe Reverb 1965) |
| `0x2901` | Rvb01b | **Plate** | ToneLib C2 TRIPY: slot5 mostra **"Plate"** |
| `0x2907` | Rvb07b | **Hall** | ToneLib B5 CrystalVib: slot2 mostra **"Hall"** (r2=0x28) |

### IDs invisíveis no ToneLib

`0x0007`, `0x0010`, `0x0018`, `0x000C` são filtrados da chain UI pelo ToneLib. Eles **ocupam slots reais** na G1On e são exibidos na ToneWebLib para que a signal chain seja completa. Não são erros do parser.

---

## 6. SHARED — Módulos Compartilhados

Mesmo módulo DSP com presets diferentes. O byte `r2` (= `rawSlot[5]`) discrimina o preset:

```js
const SHARED = {
  [0x060A]: {  // Chorus/Ensemble/Vibrato/BendChorus
    0x10:'BendChorus', 0x40:'Chorus', 0x68:'Ensemble', 0x70:'Vibrato',
    _c:{...mod}, _t:{...Rate}
  },
  [0x0614]: {  // Tremolo/StereoCho/Octave
    0x08:'Tremolo', 0x68:'StereCho', 0x78:'Octave',
    _c:{Tremolo:'mod', StereCho:'mod', Octave:'pitch'},
    _t:{Tremolo:'Rate', StereCho:'Rate', Octave:null}
  },
  [0x2606]: {  // CoronaRing/RingMod/TheVibe
    0x20:'CoronaRing', 0x50:'RingMod', 0x60:'TheVibe',
    _c:{...mod}, _t:{...Rate}
  },
  [0x2902]: {0x28:'Hall',      0x40:'Room',      _c:{...reverb}},
  [0x2904]: {0x20:'TiledRoom', 0x40:'Air',       _c:{...reverb}},
  [0x0903]: {0x20:'EarlyRef',  0x38:'Arena',     _c:{...reverb}},
  [0x0201]: {0x40:'Cry',       0x30:'SeqFilter', _c:{...filter}},
  [0x2102]: {0x08:'ZNR',       0x20:'NoiseGate', _c:{...dynamics}},
  [0x0600]: {0x30:'MonoPitch', 0x40:'Slicer',    _c:{MonoPitch:'pitch', Slicer:'special'}},
};
```

**Resolução:** `disc[r2]` → nome → `_c[nome]` cat → `_t[nome]` tap.

---

## 7. Sistema de Cache e Seed

### PATCH_CACHE_SEED

Seed de 100 patches reais gerado de `fmc_g1on_fulldump__11_.json`. Cada entrada:

```js
'A2': {
  nome:'Blue Ld', volume:100, temTime:false, temRate:false,
  efeitos:[
    {slot:1, id:8448, nome:'Dyn00b', cat:'dynamics', tap:null,
     enabled:false, rawSlot:[17,0,0,66,...], slotIdx:0},
    ...
  ], ts:0
}
```

**Estado atual:** `cat:unknown = 0`. Todos 100 patches com categoria correta.

### Fluxo de cache

1. Init: `PATCH_CACHE_SEED` (embutido)
2. Navegar para patch: `ts > 0` → usa cache; `ts === 0` → dump request
3. Receber dump: atualiza cache + `ts = Date.now()`
4. `limparCachePatches()`: reseta para `ts = 0`

---

## 8. Tap Tempo

### Fluxo

```
Toca TAP → registrarTap() → calcula BPM (média 4 batidas)
  → converte BPM → ms (delays) ou Hz (mods)
  → CMD_PARAM para cada efeito com tap:'Time' ou tap:'Rate'
  → atualiza display BPM
```

### Resolução do tapParamIdx

```
1. lerTapCache(id)         → cache local por ID
2. lerTapCacheFamilia(fam) → herda de outro ID da mesma família
3. fx-params.json          → tapParamIdx extraído dos ZDL
4. Sem mapa → toast "rode CAL"
```

### fx-params.json — tapParamIdx sem calibração

Extraído dos 900 ZDL compilados do Zoom Effects Manager:

| ID | Nome | tapParamIdx | Parâmetro |
|---|---|---|---|
| 0x280B | Delay | 1 | Time |
| 0x2860 | CarbonDly | 1 | Time |
| 0x2869 | Dly69 | 1 | Time |
| 0x286A | IceDly | 2 | TIME (idx 2) |
| 0x287C | FilterDly | 3 | TimeA (idx 3) |
| 0x060A | Chorus | 1 | RATE |
| 0x260B | VinFLNGR | 3 | Rate (idx 3) |
| 0x2602 | Phaser | 2 | Speed (idx 2) |

---

## 9. ToneWebLib — Signal Chain Visual

Componente visual em `theme-headrush.html` que exibe e edita a signal chain. Completamente separado do engine — lê `patchAtual.efeitos[]`.

### Interações

| Ação | Resultado |
|---|---|
| Tap simples no bloco | Toggle ON/OFF do efeito |
| Double-tap no bloco | Abre param editor (overlay) |
| Drag & drop | Reordena slots |

### Toggle ON/OFF — protocolo correto

```js
// enabled em rawSlot[3] bit7 (confirmado v5.1)
ef.rawSlot[3] = ef.enabled ? (ef.rawSlot[3] | 0x80) : (ef.rawSlot[3] & 0x7F);
midiOut.send([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
              ef.slotIdx, 0, val & 0x7F, (val>>7) & 0x7F, 0xF7]);
```

### Param Editor

Overlay `position:absolute` dentro do `.main-display` — zero layout shift. Sliders para `rawSlot[3..17]` (exceto byte 0 = enable). Envia CMD_PARAM em tempo real.

### double-tap timing

```js
if (now - last < 380) {
  clearTimeout(twlTapTime['_t'+i]);  // cancela single-tap pendente
  twlAbrirEditor(i);
} else {
  twlTapTime[i] = now;
  twlTapTime['_t'+i] = setTimeout(() => {
    if (twlTapTime[i] === now) twlToggleFx(i);
  }, 390);
}
```

---

## 10. Boost de Volume

```js
const BOOST_DELTA = 10;  // degraus de volume
```
- Ativa: envia `volume + BOOST_DELTA` via CMD_PARAM
- Reseta ao trocar patch

---

## 11. Footswitches e Navegação

### Layout — Modo 12 FS (HeadRush Prime)

```
[FS1][FS2][FS3][FS4][FS5][BANK]    ← índices 0-4 = patches 0-4, idx 5 = BANK
[FS6][FS7][FS8][FS9][FS10][TAP]    ← índices 6-10 = patches 5-9, idx 11 = TAP
```

```js
const FS_IDX_TAP   = FS_MODE === 12 ? 11 : 5;
const FS_IDX_BANK  = FS_MODE === 12 ?  5 : 5;
const FS_IDX_TUNER = FS_MODE === 12 ?  5 : 2;  // hold = tuner
```

### Bank Select (12 FS)

1. Press BANK → modo bank select
2. FS1–FS5 e FS6–FS10 mostram bancos A–J
3. 2º press no mesmo banco confirma

### Layout — Modo 6 FS

```
[ FS1 ][ FS2 ][ FS3/TUNER(hold) ]
[ FS4 ][ FS5 ][ FS6/TAP · BANK(hold) ]
```

---

## 12. Tuner

```
ON:  F0 52 00 63 03 42 F7
OFF: F0 52 00 63 03 43 F7
```

Ao desativar: reenvia último PC para estabilizar patch.

---

## 13. Sistema de Dados Externos

### fmc-data-manager.js

```js
await FMCData.load('patch-cache.json')  // GET fetch
await FMCData.save('tap-cache.json', data)  // PUT GitHub API
```

Token PAT em `localStorage['fmc-github-token']`.

### Formato backup ToneLib (.G1on_Backup)

- Arquivo zip com prefixo `63 00 00 00` (devId=99)
- Conteúdo: `ToneLib.data` XML UTF-8 CRLF
- Estrutura: `<Patches ver="1"><patch devId="99" ver="1.21" ...><data size="134" hash="..." dump="f0,52,...,f7"/></patch>...</Patches>\x00`

**⚠️ O campo `hash` é validado na importação** com algoritmo proprietário do ToneLib (não é CRC32, MD5, SHA1, FNV-1a, MurmurHash3, nem CRC16). Patches gerados sinteticamente são rejeitados. Não existe forma conhecida de calcular o hash correto sem o código-fonte do ToneLib.

---

## 14. Editor de Configuração

### Autenticação (SHA-256)

```js
const _H = {
  u: '0331c608d68f3c5dc4c1217af632e80aaa1ad522be9f51affa68631d498a8826',
  p: '4a78d2105f3db807fd6d46c8ac3b95115af74bee1e656886de2301455149acc6'
};
// Plaintext nunca armazenado — hash via crypto.subtle
```

### Painéis

- GitHub Token (PAT para escrita nos JSONs)
- Banco de Efeitos (ZOOM_FX_DB editor)
- Cores dos Bancos / Categorias
- Timing MIDI
- Boost & Volume
- Exportar JS

---

## 15. Ferramentas de Diagnóstico

### full-dump.html

Varre 100 patches (A0–J9). PC → 500ms → Dump Request → `0x28`. Exporta JSON com `rawHex`, `rawSlot`, `efeitos`, `volume`.

### auto-dump.html

Dump rápido banco A (A0–A9).

### dump-e0e9.html

Dump profundo banco E. byte[110]=volume destacado em âmbar.

### midi-sniffer.html

Monitor em tempo real: SysEx (hex + interpretação), PC, CC, Note.

### tap-debug.html

Debug: BPM calculado, tapParamIdx resolvido, valor enviado.

---

## 16. Engenharia Reversa — Histórico Completo

### Protocolo

| Versão | Descoberta |
|---|---|
| v1 | Model ID = 0x63 (não 0x61) |
| v2 | Ping 0x33 obrigatório após Edit ON |
| v3 | Editor permanente (0x51 grava no flash = 800ms latência) |
| v4 | VOL_OFFSET = byte[110] (byte[14] era Level do efeito) |

### Parser

| Versão | Descoberta |
|---|---|
| v1 | id2 = 3 bytes (errado) |
| v2 | id2 = (raw[0]<<7)\|raw[1] — confirmado |
| v3 | enabled = raw[0] & 0x01 (estava errado) |
| v4 | **enabled = rawSlot[3] bit7** — auditoria 12 amostras |
| v5 | skip incondicional id2=0x0000 (antes gerava UNK_0x0 fantasma) |
| v5.1 | Gaps na chain são normais — comportamento real do hardware |

### ZOOM_FX_DB

| Versão | Descoberta |
|---|---|
| v1–v3 | IDs básicos por observação |
| v3 | SHARED map para módulos multi-preset |
| v4 | 142 IDs do fulldump (100 patches) |
| v5.1 | 0x2407=**DeluxeR** (era VXCombo) — ToneLib C2 |
| v5.1 | 0x2901=**Plate** (era Rvb01b) — ToneLib C2 |
| v5.1 | 0x2907=**Hall** (era Rvb07b) — ToneLib B5 |
| v5.1 | 0x0030=**AcoSim** — ToneLib B3 desc explícita |
| v5.1 | 0x0018=**StereoCho** — ToneLib A5 desc explícita |
| v5.1 | 0x0019=**CoronaTri** — ToneLib H3 desc explícita |
| v5.1 | 0x0007=**CabSim** — padrão amp+cab |
| v5.1 | 0x2004=**Bypass** — ToneLib H0 explícito |
| v5.1 | 0x0020=**LongDelay**, 0x2006=**Detune12**, 0x080E=**Dly0E** |
| v5.1 | cat:unknown = 0 (100% patches mapeados) |

### ZDL Reverse Engineering

O Zoom Effects Manager distribui efeitos como ZDL compilados num container Qt RCC v3 (`.dat`). Processo:

1. Qt RCC v3 parser: `tree_offset`, `data_offset`, `names_offset`
2. Inner container: sequência `[uint16_BE unc_size][zlib_data]`
3. Cada blob: ELF/DSP compilado para o processador da G1On
4. Strings extraídas: `Dll_XXX`, `ZDL_XXX`, nomes de parâmetros
5. `tapParamIdx` por posição de `Time`/`Rate` na lista de params

900 blobs extraídos → 85 efeitos únicos → `data/fx-params.json` (60 com tapParamIdx mapeado).

### Tentativa de presets sintéticos

Investigada para probe de IDs desconhecidos. Resultado: ToneLib valida campo `hash` com algoritmo proprietário não identificado (tentados: CRC32, MD5, SHA1, FNV-1a, MurmurHash3, CRC16-CCITT, byte-swaps, variantes). **Impossível gerar presets válidos sem o código-fonte.** Estratégia substituída por verificação manual no ToneLib.

---

## 17. Como Contribuir / Continuar

### Pontos críticos que NÃO devem ser revertidos

1. `VOL_OFFSET = 110` — byte[14] era Level do efeito
2. Handshake: Identity + Edit ON + **Ping 0x33**
3. `enabled = rawSlot[3] bit7` (não `rawSlot[0] & 0x01`)
4. Skip: `if(id2 === 0) continue` — incondicional
5. Editor permanente — nunca `CMD_EDIT_OFF` entre patches

### O que ainda está incompleto

- `0x000C` (InternalFX): não identificado definitivamente (1 ocorrência)
- Hash ToneLib: algoritmo não revertido — impossível gerar backups sintéticos
- Editor completo de patches (save → enviar G1On → dump confirmação): arquitetado, não implementado
- fx-params.json: 60 de 143 efeitos com params mapeados — restante usa nomes genéricos

### Para adicionar um novo tema

1. Copiar `theme-boss.html` como base
2. Declarar `THEME_FS = 6` ou `12` antes do engine
3. Incluir todos os IDs HTML obrigatórios (ver seção 2)
4. Incluir `fmc-engine.js` por último
5. Adicionar card no `index.html`

### Para identificar IDs desconhecidos

1. Abrir ToneLib com G1On conectada
2. Navegar ao patch com o ID
3. Observar nome e posição na chain
4. Cruzar com posição do slot no dump
5. Atualizar `ZOOM_FX_DB`

---

*Manual atualizado em 17/03/2026 | FMC-AM 6F v5.1-b20260317*

