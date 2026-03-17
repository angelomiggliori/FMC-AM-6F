# FMC-AM 6F — Manual Técnico Completo
**Controladora MIDI Virtual para Zoom G1On**  
Versão: `v4.2-b20260316-final` | Autor: Angelo Miggliori  
Protocolo confirmado: G1On fw 1.21, model ID `0x63`

---

## Índice

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Arquitetura dos Arquivos](#2-arquitetura-dos-arquivos)
3. [Protocolo MIDI — Zoom G1On](#3-protocolo-midi--zoom-g1on)
4. [Parser do Dump SysEx 0x28](#4-parser-do-dump-sysex-0x28)
5. [Banco de Efeitos (ZOOM_FX_DB)](#5-banco-de-efeitos-zoom_fx_db)
6. [Sistema de Cache](#6-sistema-de-cache)
7. [Tap Tempo — TAP_PARAM_MAP](#7-tap-tempo--tap_param_map)
8. [Boost de Volume](#8-boost-de-volume)
9. [Footswitches e Navegação](#9-footswitches-e-navegação)
10. [Tuner](#10-tuner)
11. [LEDs NeoPixel (Pico)](#11-leds-neopixel-pico)
12. [Editor de Configuração](#12-editor-de-configuração)
13. [Ferramentas de Diagnóstico](#13-ferramentas-de-diagnóstico)
14. [Como Contribuir / Continuar](#14-como-contribuir--continuar)
15. [Histórico de Descobertas](#15-histórico-de-descobertas)

---

## 1. Visão Geral do Projeto

O FMC-AM 6F é uma **controladora MIDI virtual** que roda no browser via Web MIDI API. Ela se comunica diretamente com a Zoom G1On via USB/MIDI SysEx proprietário, permitindo:

- Navegar pelos 100 patches (bancos A–J, patches 0–9)
- Ver o nome do patch, efeitos ativos, volume em tempo real
- Tap Tempo sincronizado com delays e modulações
- Tuner via SysEx
- Boost de volume por patch
- Cache local de patches para resposta instantânea
- Interface com 5 temas visuais distintos

**Stack técnica:**
- HTML + CSS + JavaScript puro (sem framework)
- Web MIDI API nativa (Chrome/Edge)
- `fmc-engine.js` = motor único compartilhado por todos os temas
- Persistência via `localStorage`

**Limitação conhecida:** Web MIDI API só funciona em Chrome/Edge em desktop. Não funciona em iOS Safari.

---

## 2. Arquitetura dos Arquivos

```
fmc-am-6f/
│
├── fmc-engine.js          ← MOTOR ÚNICO — toda a lógica aqui
│
├── index.html             ← Hub de navegação
├── pedalboard-v4.html     ← GUI principal
├── theme-boss.html        ← Tema Boss ME-90
├── theme-headrush.html    ← Tema Headrush
├── theme-kemper.html      ← Tema Kemper
├── theme-zoom.html        ← Tema Zoom nativo
│
├── fmc-editor.html        ← Editor de configuração (nomes, cores, LEDs, FS)
│
├── full-dump.html         ← Varre A0→J9, exporta JSON
├── auto-dump.html         ← Dump rápido do banco ativo
├── dump-e0e9.html         ← Dump profundo banco E (deep)
└── midi-sniffer.html      ← Monitor MIDI em tempo real
```

### Como os temas carregam o engine

Cada HTML de tema inclui o engine via `<script src="fmc-engine.js">` e define uma constante `THEME_NAME` antes do include. O engine lê os elementos HTML pelo ID (`patchId`, `patchName`, `fxIndicators`, `patchVolume`, `bpmVal`, `fsGrid`, etc.) e os atualiza diretamente.

---

## 3. Protocolo MIDI — Zoom G1On

### Identificação

| Parâmetro | Valor |
|---|---|
| Fabricante | `0x52` (Zoom) |
| Device | `0x00` |
| Model ID | `0x63` (G1On fw 1.21) |

### Sequência de Handshake (obrigatória)

```
1. TX: F0 7E 00 06 01 F7           → Identity Request
   RX: F0 7E 00 06 02 52 63 ...F7  → Identity Response (confirma model=0x63)

2. TX: F0 52 00 63 50 F7           → Edit ON
   RX: F0 52 00 63 58 F7           → Confirmação (não obrigatório aguardar)

3. TX: F0 52 00 63 33 F7           → Editor Ping (OBRIGATÓRIO — sem ele a G1On ignora comandos)
```

**⚠️ Crítico:** O ping `0x33` é mandatório. Sem ele a G1On aceita o Edit ON mas não entra completamente no modo editor e ignora os Dump Requests subsequentes.

### Comandos SysEx

```js
const CMD_EDIT_ON  = 0x50;   // Ativa modo editor
const CMD_EDIT_OFF = 0x51;   // Desativa modo editor
const CMD_DUMP_REQ = 0x29;   // Requisita dump do patch atual
const CMD_DUMP_RES = 0x28;   // Resposta dump (134 bytes)
const CMD_PARAM    = 0x31;   // Set parâmetro
```

### Requisitar Dump

```
TX: F0 52 00 63 29 F7
RX: F0 52 00 63 28 [129 bytes de dados] F7   (134 bytes total)
```

### Set Parâmetro

```
TX: F0 52 00 63 31 [slotIdx] [rawIdx] [valLo] [valHi] F7
```
- `slotIdx`: 0–4 (slot do efeito)
- `rawIdx`: índice do parâmetro dentro do slot
- `valLo/valHi`: valor em 7-bit split

### Program Change

```
TX: C0 [pc]     onde pc = bankIndex * 10 + patchIndex
```
Exemplo: Banco B (índice 1), patch 3 → `C0 13`

### Tuner

```
TX: F0 52 00 63 03 42 F7    → Tuner ON
TX: F0 52 00 63 03 43 F7    → Tuner OFF
TX: B0 4A 7F                → CC74 fallback
```

### Estratégia de Editor

O editor é mantido **aberto permanentemente** durante o uso normal:
- Abre uma vez ao conectar (Identity + Edit ON + Ping)
- Watchdog de 4 minutos: se o timer expirar, reabre automaticamente
- Nunca fecha entre patches (fechar grava no flash e causa reload lento)
- Fecha apenas ao desconectar

**Timings confirmados:**
```js
const SYSEX_IDLE_MS = 50;    // 50ms idle antes de enviar
const SYSEX_DELAY   = 80;    // 80ms entre mensagens SysEx
const PC_TO_DUMP_MS = 500;   // 500ms após PC antes de requisitar dump
```

---

## 4. Parser do Dump SysEx 0x28

### Estrutura do dump (134 bytes)

```
[0]    = 0xF0  (SysEx start)
[1]    = 0x52  (Zoom MFR)
[2]    = 0x00  (Device)
[3]    = 0x63  (Model ID)
[4]    = 0x28  (Dump Response)
[5..8] = Pré-slot (bytes de MSBs do packing)
[9..28]   = Slot 1 (20 bytes)
[29..48]  = Slot 2
[49..68]  = Slot 3
[69..88]  = Slot 4
[89..108] = Slot 5
[109..132]= Nome do patch (7-bit SysEx packed, 7 chars visíveis)
[110]     = Patch Output Volume (0–120) ← OFFSET CRÍTICO
[133]  = 0xF7  (SysEx end)
```

### Estrutura de cada Slot (20 bytes)

```
raw[0] = byte MSBs dos parâmetros + enabled flag no bit 0
raw[1] = parte baixa do ID do efeito
raw[2] = byte MSBs dos parâmetros (para discriminar módulos compartilhados)
raw[3..19] = parâmetros do efeito
```

### Cálculo do ID do efeito

```js
const id2 = (raw[0] << 7) | raw[1];
const enabled = (raw[0] & 0x01) === 1;
```

**⚠️ Atenção:** o bit 0 do `raw[0]` é o flag `enabled`. Isso significa que `raw[0]` é sempre par quando o efeito está desligado e ímpar quando ligado. O ID real usa os bits 1–7 de `raw[0]`.

### Patch Output Volume

```js
const VOL_OFFSET = 110;
const volume = rawData[VOL_OFFSET]; // 0–120
```

**Histórico:** `byte[14]` foi testado e rejeitado — capturava o Level do efeito no slot 1, não o Patch Volume. O offset correto `byte[110]` foi descoberto por teste controlado (dump4 com volumes anotados manualmente e cruzados bit a bit).

### Nome do Patch

```js
// 7-bit SysEx unpack a partir do byte 109
function decode7bitNome(data, offset, len) {
  const chars = [];
  let i = offset;
  while (i < offset + len && i < data.length - 1) {
    const msbs = data[i++];
    for (let bit = 0; bit < 7; bit++) {
      if (chars.length >= len || i >= data.length) break;
      chars.push(String.fromCharCode(data[i++] | (((msbs >> bit) & 1) << 7)));
    }
  }
  return chars.join('').trim();
}
```

---

## 5. Banco de Efeitos (ZOOM_FX_DB)

### Estrutura

```js
const ZOOM_FX_DB = {
  0x0101: ({n:'Comp', c:'dynamics', t:null}),
  // ...
};
// Campos:
//   n  = nome exibido na GUI
//   c  = categoria (define a cor da tag)
//   t  = 'Time' | 'Rate' | null (para tap tempo)
```

### Categorias disponíveis

| Categoria | Cor padrão | Tipo de tap |
|---|---|---|
| `dynamics` | #ffcc00 | — |
| `filter` | #ff6b00 | — |
| `drive` | #ff6600 | — |
| `amp` | #ff8800 | — |
| `pitch` | #00ccff | — |
| `mod` | #aa88ff | Rate |
| `delay` | #00ffcc | Time |
| `reverb` | #4488ff | — |
| `special` | #cc44ff | — |

### Módulos Compartilhados (SHARED)

Alguns IDs são compartilhados entre múltiplos efeitos — o mesmo módulo DSP com presets diferentes. O `raw[2]` (byte MSBs dos parâmetros) discrimina qual preset está ativo:

```js
const SHARED = {
  [0x060A]: {0x10:'BendChorus', 0x40:'Chorus', 0x68:'Ensemble', 0x70:'Vibrato', ...},
  [0x0614]: {0x08:'Tremolo', 0x68:'StereCho', 0x78:'Octave', ...},
  [0x2606]: {0x20:'CoronaRing', 0x50:'RingMod', 0x60:'TheVibe', ...},
  [0x2902]: {0x28:'Hall', 0x40:'Room', ...},
  [0x2904]: {0x20:'TiledRoom', 0x40:'Air', ...},
  [0x0903]: {0x20:'EarlyRef', 0x38:'Arena', ...},
  [0x0201]: {0x40:'Cry', 0x30:'SeqFilter', ...},
  [0x2102]: {0x08:'ZNR', 0x20:'NoiseGate', ...},
  [0x0600]: {0x30:'MonoPitch', 0x40:'Slicer', ...},
};
```

### Como editar o FX_DB

**Via Editor:** abrir `fmc-editor.html` → painel "Banco de Efeitos"  
**Manual:** editar `fmc-engine.js`, bloco `const ZOOM_FX_DB = {`

Para adicionar um efeito novo:
```js
0xXXXX: ({n:'MeuEfeito', c:'drive', t:null}),
```

Para renomear com referência real:
```js
// Editar apenas o campo 'n' — o comentário é informativo
0x2860: ({n:'CarbonCpy', c:'delay', t:'Time'}),  // MXR Carbon Copy
```

---

## 6. Sistema de Cache

### Arquitetura em 4 camadas

```
Camada 1: RAM (patchCache{}) — mais rápido, perdido ao recarregar
Camada 2: localStorage['fmc-cache'] — persiste entre sessões
Camada 3: localStorage['fmc-cache-bk'] — backup da camada 2
Camada 4: PATCH_CACHE_SEED — seed hardcoded com 100 patches do dump3
```

### Fluxo de leitura

1. `lerCachePatch(bank, patch)` → busca em RAM
2. Se não encontrar → carrega do localStorage
3. Se não encontrar → retorna do PATCH_CACHE_SEED
4. Se não existir → retorna `null`

### Fluxo de escrita

Quando um dump SysEx é recebido:
1. `parseDump()` extrai nome, volume, efeitos
2. `gravarCachePatch()` salva na RAM
3. A cada `MEM_CHECK_MS` (5s), os dados são persistidos no localStorage

### Botão ↺ CACHE

Reseta a RAM e localStorage, recarrega do seed. Útil após:
- Reconfiguar patches na pedaleira
- Após um fulldump com novos dados
- Se o cache estiver com dados inconsistentes

---

## 7. Tap Tempo — TAP_PARAM_MAP

### Como funciona

1. Usuário toca FS6 (tap) em ritmo
2. Engine calcula BPM com média das últimas 4 batidas (`TAP_AVG_N=4`)
3. Para cada efeito ativo com `t='Time'` ou `t='Rate'`, calcula o valor de parâmetro
4. Envia SysEx Param Set para o slot correspondente

### Fórmulas

```
Delays (Time):  val = round((60000 / bpm) / escala)
Mods   (Rate):  val = round(bpm / 60 * escala)
```

### Tabela TAP_PARAM_MAP

```js
const TAP_PARAM_MAP = {
  // Delays — rawIdx e escala confirmados por engenharia reversa
  0x1C00: ({raw:5, tipo:'ms', escala:8.0}),     // Delay (E5, 560ms→70)
  0x280B: ({raw:5, tipo:'ms', escala:8.0}),     // Delay II
  0x0052: ({raw:5, tipo:'ms', escala:10.0}),    // TapeEcho
  0x1880: ({raw:5, tipo:'ms', escala:10.0}),    // TapeEcho (RE-201)
  0x0877: ({raw:5, tipo:'ms', escala:20.0}),    // ReverseDL
  0x0807: ({raw:5, tipo:'ms', escala:3.495}),   // StompDly
  0x0829: ({raw:6, tipo:'ms', escala:5.208}),   // StereoDly
  0x287C: ({raw:5, tipo:'ms', escala:7.813}),   // FilterDly
  0x286D: ({raw:5, tipo:'ms', escala:46.875}),  // MultiTapD
  0x2816: ({raw:7, tipo:'ms', escala:9.0}),     // PitchDly
  0x2860: ({raw:5, tipo:'ms', escala:5.884}),   // CarbonDly ⚠ a confirmar
  // Mods — escala em Hz
  0x060A: ({raw:6, tipo:'hz', escala:25.0}),    // Chorus família
  0x0614: ({raw:2, tipo:'hz', escala:4.0}),     // Tremolo família
  0x2602: ({raw:2, tipo:'hz', escala:12.0}),    // Phaser
  0x260B: ({raw:3, tipo:'hz', escala:28.0}),    // Flanger
  0x2606: ({raw:2, tipo:'hz', escala:3.0}),     // RingMod/TheVibe
  0x2201: ({raw:9, tipo:'hz', escala:6.0}),     // fCycle
  0x060C: ({raw:6, tipo:'hz', escala:25.0}),    // SuperCho
  0x060B: ({raw:3, tipo:'hz', escala:20.0}),    // DuoPhase
};
```

**⚠️ CarbonDly (0x2860):** escala 5.884 é estimativa calculada de uma única amostra. Testar com valor conhecido e confirmar.

---

## 8. Boost de Volume

### Como funciona

```
toggleBoost():
  1. lê patchAtual.volume (dump ao vivo) ← fonte primária
  2. fallback: cache → VOL_DEFAULT (100)
  3. calcula volBoost = min(VOL_MAX, volBase + BOOST_DELTA)
  4. envia SysEx Param Set: CMD_PARAM, slot=0x0A, idx=0x02, val=volBoost
  5. ao desativar: reenvia com volBase
```

### Parâmetros

```js
const BOOST_DELTA = 10;   // +10 unidades
const VOL_DEFAULT = 100;  // fallback
const VOL_MAX     = 120;  // teto da G1On
const VOL_OFFSET  = 110;  // offset no dump SysEx
```

---

## 9. Footswitches e Navegação

### Layout (6 FS em grid 3×2)

```
[ FS1 ] [ FS2 ] [ FS3/TUNER ]
[ FS4 ] [ FS5 ] [ FS6/TAP   ]
```

### Comportamentos

| FS | Press | Hold (900ms) |
|---|---|---|
| FS1 | Patch par/ímpar toggle | — |
| FS2 | Patch par/ímpar toggle | — |
| FS3 | Patch | Tuner ON/OFF |
| FS4 | Patch | — |
| FS5 | Patch | — |
| FS6 | Tap Tempo | Bank Select |

### Bank Select (hold FS6)

1. FS6 hold → entra em modo bank select
2. FS1–FS5 mostram as 5 letras do grupo (A–E ou F–J)
3. Toque no FS da letra desejada → banco selecionado
4. Alterna automaticamente entre grupos A–E e F–J

### Toggle de patches

FS1–FS5 selecionam patches alternando entre dois slots:
- FS1: patches 0/5
- FS2: patches 1/6
- FS3: patches 2/7
- FS4: patches 3/8
- FS5: patches 4/9

---

## 10. Tuner

```
ON:  TX F0 52 00 63 03 42 F7  + CC74 127
OFF: TX F0 52 00 63 03 43 F7  + CC74 0
```

Ao ativar o tuner, a GUI muda para modo visual de tuner. Ao desativar, reenvia o último PC para estabilizar a G1On no patch correto.

---

## 11. LEDs NeoPixel (Pico)

### Hardware

```
Raspberry Pi Pico → GP0 → 330Ω → DIN LED1 → DOUT → DIN LED2 → DOUT → DIN LED3
VBUS (5V) → VCC todos os LEDs
GND → GND todos os LEDs
Capacitor 100µF entre VCC e GND (recomendado)
```

### Funções dos 3 LEDs

| LED | Função padrão | Modo |
|---|---|---|
| LED 0 | Metrônomo BPM | Flash (12% duty cycle) |
| LED 1 | Banco ativo | Sólido (cor do banco) |
| LED 2 | Patch ativo | Sólido (cor do banco) |

### Cores dos bancos (NeoPixel)

```python
BANK_COLORS = {
  'A': (0, 255, 100),   # verde
  'B': (255, 170, 0),   # laranja
  'C': (255, 0, 0),     # vermelho
  'D': (0, 220, 255),   # ciano
  'E': (255, 255, 255), # branco
  # F-J espelham A-E
}
```

### Modos disponíveis (Editor)

- `solid` — aceso fixo
- `flash` — pisca no BPM
- `pulse` — fade in/out suave
- `glow` — brilho pulsante (efeito halo)
- `off` — desligado

### Configurando via Editor

1. Abrir `fmc-editor.html` → painel "LEDs NeoPixel"
2. Definir brilho global, fonte de cor e modo de cada LED
3. Clicar "BAIXAR main.py" → copiar para o Pico via Thonny

---

## 12. Editor de Configuração

`fmc-editor.html` — editor visual para personalizar o projeto sem editar código.

### Painéis disponíveis

#### Banco de Efeitos
- Nome exibido na GUI (campo `n`)
- Referência real do produto emulado (campo `ref`, informativo)
- Categoria (define cor das tags)
- Comportamento de tap (Time/Rate/nenhum)
- Filtro por categoria e busca por nome

#### Cores dos Bancos
- Picker de cor para cada banco A–J
- Botão para espelhar A–E em F–J

#### Cores das Categorias
- Picker de cor para cada categoria
- Preview instantâneo das tags

#### LEDs NeoPixel
- Brilho global (0–100%)
- Fonte de cor: banco / categoria / personalizada
- Modo por LED: solid / flash / pulse / glow / off
- Função por LED: BPM / banco / patch / categoria / cor fixa
- Geração automática do código MicroPython para o Pico

#### Footswitches
- Rótulo personalizado para cada FS
- Ação de press: patch / tap / bank_sel / tuner / boost / patch_prev / patch_next
- Ação de hold
- HOLD_MS e DEBOUNCE_MS globais

#### MIDI / Timing
- SYSEX_DELAY, SYSEX_IDLE_MS, PC_TO_DUMP_MS
- Referência do protocolo G1On

#### Boost & Volume
- BOOST_DELTA, VOL_DEFAULT, VOL_MAX

#### Exportar
- Gera bloco JS completo para substituir no fmc-engine.js
- Download de fmc-engine-patch.js
- Copiar para área de transferência

### Persistência do Editor

O editor salva automaticamente em `localStorage['fmc-editor-config']`. Para exportar permanentemente: botão "EXPORT .JSON" gera `fmc-am6f-config.json`.

---

## 13. Ferramentas de Diagnóstico

### full-dump.html

Varre os 100 patches (A0–J9):
1. Abre modo editor uma vez antes do loop
2. Para cada patch: PC → aguarda 800ms → Dump Request → aguarda 0x28
3. Watchdog: 3 timeouts consecutivos → reabre editor
4. Exporta: JSON completo, log .txt, injeção no localStorage

**Resultado exportado:**
```json
{
  "patches": [
    {
      "patch": "A0",
      "nome": "CLEAN BOOST",
      "volume": 95,
      "efeitos": [{"slot": 1, "id": 515, "nome": "GraphicEQ", ...}]
    }
  ],
  "sysexBruto": [...]
}
```

### auto-dump.html

Dump rápido do banco A (patches A0–A9). Mesmo protocolo do full-dump mas só 10 patches.

### dump-e0e9.html

Dump profundo do banco E com:
- Visualização byte a byte com destaque de `byte[110]` (volume) em âmbar
- rawSlot de cada slot de efeito
- Exportação JSON com estrutura detalhada

### midi-sniffer.html

Monitor em tempo real de todo o tráfego MIDI:
- SysEx (hex + interpretação)
- Program Change
- Control Change
- Note On/Off

---

## 14. Como Contribuir / Continuar

### Para um novo assistente de IA

Este projeto usa **Web MIDI API** com protocolo SysEx **proprietário** da Zoom G1On (fw 1.21, model ID `0x63`). Todo o protocolo foi descoberto por engenharia reversa de dumps reais — não existe documentação oficial.

**Pontos de atenção:**
1. O offset `VOL_OFFSET = 110` foi descoberto por teste controlado (dump4 com valores anotados). **Não reverter para 14.**
2. O handshake sempre precisa dos 3 passos: Identity Request + Edit ON + Ping 0x33
3. O editor de modo abre uma vez e nunca fecha entre patches
4. O `PATCH_CACHE_SEED` foi gerado do dump3 (100 patches com efeitos nomeados)
5. IDs compartilhados (SHARED) discriminados pelo `raw[2]` são confirmados pelo dump3

**O que ainda precisa ser confirmado:**
- CarbonDly (0x2860): escala de tap = 5.884 (estimativa de uma amostra)
- VinFLNGR vs Flanger: mesmo ID 0x260B, raw[2] idêntico (0x38) — indistinguíveis
- TapeEcho: dois IDs (0x0052 e 0x1880) — ainda não confirmado qual contexto usa cada um

### Para adicionar um novo tema

1. Copiar `theme-boss.html` como base
2. Mudar os CSS variables em `:root`
3. Mudar `const THEME_NAME`
4. O engine `fmc-engine.js` é incluído sem modificação
5. Adicionar card no `index.html`

### Para testar tap tempo

1. Abrir qualquer GUI
2. Conectar G1On via USB
3. Navegar para um patch com delay (ex: I3 = Delay)
4. Tocar FS6 em ritmo de 120 BPM (4 batidas)
5. O LED da tag "delay" no display deve piscar
6. Verificar o delay na pedaleira

### Para fazer um fulldump

1. Abrir `full-dump.html`
2. Selecionar a G1On no seletor MIDI
3. Clicar "INICIAR VARREDURA"
4. Aguardar 100 patches (≈ 3 minutos)
5. Exportar JSON e usar como base do seed

---

## 15. Histórico de Descobertas

### Protocolo MIDI
- **Identity Response** confirmou model ID = `0x63` (não `0x61` como docs informais sugeriam)
- **Ping 0x33** descoberto ao observar timeouts: sem ele a G1On não responde ao `0x29`
- **Editor por patch** era o bug principal do full-dump — fechar o editor (`0x51`) faz a G1On regravar no flash, gerando latência de 800ms+

### Parser
- **id2 = (raw[0]<<7)|raw[1]** — formato de 2 bytes (não 3 como tentativas iniciais)
- **enabled = (raw[0] & 0x01)** — bit 0 do primeiro byte do rawSlot
- **raw[2]** é o byte de MSBs dos parâmetros (usado pelo SHARED para discriminar)

### Volume
- **byte[14]** = Level do efeito no slot 1 — capturado erroneamente como Patch Volume
- **byte[110]** = Patch Output Volume real — descoberto por teste controlado com dump4 e volumes anotados manualmente

### IDs dos Efeitos
- **ReverseDL** e **StompDly** tinham ID compartilhado `0x0010` nos dumps antigos — dump3 revelou IDs distintos: `0x0877` e `0x0807`
- **StereoDly** = `0x0829` (antes `0x0990`)
- **CarbonDly** = `0x2860` (antes `0x0050`)
- SHARED map completamente reconstruído com 9 grupos confirmados pelo dump3

---

*Documentação gerada em 16/03/2026 | FMC-AM 6F v4.2-b20260316-final*
