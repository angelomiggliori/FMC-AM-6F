# ARQUITETURA MODULAR — G1on Editor ToneLib Web

> Documento técnico completo da estrutura de módulos, responsabilidades,
> dependências, fluxo de dados e decisões de design.

---

## Visão Geral

O editor é uma **Single Page Application** construída com **ES Modules nativos**
(sem bundler, sem framework). Cada arquivo tem uma única responsabilidade e
se comunica via importações explícitas ou via o sistema de eventos do `StateManager`.

```
┌─────────────────────────────────────────────────────────────────┐
│                          index.html                             │
│            (estrutura HTML + CSS — zero lógica)                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ <script type="module">
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                           app.js                                │
│   Bootstrap · Orquestrador · Atalhos · window._ui globals       │
└───┬──────────┬──────────┬──────────┬──────────┬────────────────┘
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
 engine/    midi/      storage/    ui/*       data/
```

---

## Camadas da Aplicação

```
┌─────────────────────────────────────────────┐
│                  UI Layer                   │  ← Renderiza, captura eventos
│  patch_list · signal_chain · param_editor   │
│  effect_browser · notifications · sysex_log │
└──────────────────────┬──────────────────────┘
                       │ lê state.* / emite window._ui.*
                       ▼
┌─────────────────────────────────────────────┐
│              Engine / State Layer           │  ← Lógica de negócio
│  state_manager · patch_codec · tap_tempo    │
│  sysex_packer                               │
└───────────┬─────────────────────┬───────────┘
            │                     │
            ▼                     ▼
┌───────────────────┐   ┌─────────────────────┐
│   Storage Layer   │   │     MIDI Layer       │
│  patch_storage    │   │   midi_manager       │
│  settings_storage │   │                      │
└───────────────────┘   └──────────┬───────────┘
                                   │
                         ┌─────────▼──────────┐
                         │     Data Layer      │
                         │  effects_catalog    │
                         │  sysex_constants    │
                         │  default_patches    │
                         └─────────────────────┘
```

---

## Módulos — Descrição Completa

---

### `index.html`
**Tipo:** Entrada · **Depende de:** `app.js` (via `<script type="module">`)

Responsabilidade única: **estrutura HTML e CSS**.
Não contém nenhuma lógica JavaScript inline além dos atributos `onclick`
que delegam para `window._ui.*` (ponte para o `app.js`).

O CSS está embutido para eliminar dependência de arquivos externos além
das fontes do Google Fonts (carregadas via `@import`).

Elementos HTML importantes e seus IDs:
| ID | Descrição |
|---|---|
| `patchList` | Container da lista de patches (preenchido por `patch_list.js`) |
| `signalChain` | Container do rack de efeitos (preenchido por `signal_chain.js`) |
| `paramPanel` | Container do editor de parâmetros (preenchido por `param_editor.js`) |
| `effectBrowser` | Grid de cards de efeitos dentro do modal |
| `catFilters` | Linha de botões de filtro por categoria |
| `sysexLogBody` | Container das linhas do monitor SysEx |
| `midiInputSel` / `midiOutputSel` | Selects de porta MIDI |
| `statusDot` / `statusText` | Indicador de conexão no header |
| `patchNameInput` | Input do nome do patch atual |
| `slotBadge` | Badge "P00" do slot atual |
| `notif` | Toast de notificações |

---

### `app.js`
**Tipo:** Bootstrap / Orquestrador · **Depende de:** todos os outros módulos

Ponto de entrada da aplicação. Executa na ordem:

1. **Storage** → `hasStoredData()` decide entre carregar do LittleFS ou usar defaults
2. **State** → `state.loadPatchBank()` inicializa o estado global
3. **MIDI** → `initMidi()` solicita acesso Web MIDI
4. **UI** → chama `init*()` de cada módulo de interface
5. **Events** → registra atalhos de teclado e listeners de estado
6. **Globals** → expõe `window._ui` para os `onclick` do HTML

**Por que `window._ui`?**
ES Modules têm escopo isolado — funções definidas em módulos não são acessíveis
no escopo global. O objeto `window._ui` é a ponte controlada entre o HTML
declarativo (`onclick="window._ui.selectPatch(0)"`) e as funções dos módulos.
Isso evita `eval`, evita poluir o escopo global com dezenas de funções, e
centraliza todos os pontos de entrada da UI em um único objeto auditável.

---

### `data/effects_catalog.js`
**Tipo:** Dados estáticos · **Depende de:** nada

O catálogo dos **222 efeitos** extraídos dos arquivos `.ZDL` binários da série
G1on (DSP Zoom). É um módulo de dados puro — sem lógica, apenas a estrutura.

Exporta:
- `FX_CATALOG` — objeto indexado por nome do efeito
- `CATEGORIES` — array com as 10 categorias disponíveis
- `fxNameById(id)` — busca nome pelo ID numérico (usado no decoder de patch)

Estrutura de cada entrada:
```js
"Chorus": {
  id: 35,                        // índice interno ZDL (0–221)
  params: ["Depth","Rate","Tone","Level"], // nomes dos parâmetros DSP
  tap: "Rate",                   // nome do parâmetro de tap tempo (ou null)
  tapParamIdx: 2,                // índice 1-based do param alvo do tap (ou null)
  category: "Modulation"         // categoria de display
}
```

**Sobre os IDs:** Os IDs numéricos correspondem à ordem de extração dos blocos
ZDL. São usados no byte 1–2 de cada slot no dump de patch da pedaleira.

---

### `data/sysex_constants.js`
**Tipo:** Dados estáticos + builders puros · **Depende de:** nada

Define todas as constantes do protocolo MIDI/SysEx da G1on e funções
**puras** (sem efeitos colaterais) que montam os bytes das mensagens.

Exporta constantes:
- `ZOOM_MFR_ID` = `0x52`
- `G1ON_DEVICE_ID` = `0x64`
- `ZOOM_HEADER` = `[0xF0, 0x52, 0x00, 0x64]`
- `CMD_BYTE` — objeto com todos os bytes de comando

Exporta builders (retornam `number[]`):
- `buildEditorOn()` / `buildEditorOff()`
- `buildPatchDumpRequest()`
- `buildPatchUpload(packedData)`
- `buildPatchSave(slotIndex)`
- `buildParamChange(fxSlot, paramIdx, value)`
- `buildProgramChange(slotIndex)`
- `buildIdentityRequest()`

Exporta parsers:
- `isZoomG1onSysex(data)` — verifica se bytes são do G1on
- `isIdentityResponse(data)` — verifica resposta de identidade
- `extractCommandByte(data)` — extrai o CMD byte da mensagem

---

### `data/default_patches.js`
**Tipo:** Dados estáticos · **Depende de:** nada

8 patches de fábrica usados na primeira execução (antes de qualquer dado
salvo no LittleFS). Inclui patches como "CLEAN BOOST", "METAL ZONE",
"SHOEGAZE", "FUNK WAH", "AMBIENT PAD" etc.

Exporta:
- `DEFAULT_PATCHES` — array de 8 patches completos
- `createEmptyPatch(slot)` — cria patch vazio com nome "INITxx"
- `buildInitialPatchBank()` — gera banco de 100 patches (8 defaults + 92 vazios)

---

### `engine/sysex_packer.js`
**Tipo:** Engine pura · **Depende de:** nada

Implementa o algoritmo de **7-bit packing** do protocolo SysEx MIDI.

O MIDI limita bytes SysEx a 7 bits (0x00–0x7F). Para transmitir bytes
de 8 bits (dados reais do patch), a Zoom usa o esquema:

```
Para cada grupo de 7 bytes de dados reais:
  Byte 0 (MSB): contém o bit 7 de cada um dos 7 bytes seguintes
  Bytes 1–7:    os 7 bits inferiores de cada byte de dado
```

Exporta:
- `packTo7Bit(data[])` → bytes packed prontos para SysEx
- `unpackFrom7Bit(packed[])` → bytes de dados reais
- `packedSize(n)` → tamanho packed para n bytes reais
- `unpackedSize(n)` → tamanho real para n bytes packed

---

### `engine/patch_codec.js`
**Tipo:** Engine · **Depende de:** `sysex_packer.js`, `effects_catalog.js`

Serializa objetos patch JavaScript ↔ bytes SysEx da pedaleira.

**Formato do patch (bytes reais, após unpack):**
```
Bytes 00–54 : 5 slots × 11 bytes
  [base + 0]   : on/off  (0x00 = off, 0x01 = on)
  [base + 1]   : effectId bits 0–6
  [base + 2]   : effectId bit 7
  [base + 3–10]: parâmetros p0–p7 (0–127)
Bytes 55–64 : nome (10 chars ASCII, padded com 0x20)
```

Exporta:
- `encodePatch(patch)` → `number[]` packed (para `buildPatchUpload()`)
- `decodePatch(packedBytes, slotIndex)` → objeto patch
- `createEffect(fxName, on)` → objeto efeito com params default (64)
- `clonePatch(patch)` → cópia profunda (usado pelo undo stack)

---

### `engine/tap_tempo.js`
**Tipo:** Engine · **Depende de:** nada

Calcula BPM a partir de taps do usuário usando **média móvel** dos últimos
N intervalos. Reseta automaticamente após 3 segundos sem tap.

```
BPM range: 40–300
Janela padrão: últimos 8 taps
Reset: > 3000ms sem tap
```

Exporta a classe `TapTempo`:
- `.onTap()` → registra tap, retorna BPM calculado
- `.bpm` → getter do BPM atual
- `.toMidi()` → converte BPM para valor 0–127 (linear no range 40–300)
- `TapTempo.fromMidi(val)` → converte 0–127 de volta para BPM
- `.reset()` → limpa histórico

---

### `engine/state_manager.js`
**Tipo:** Engine / Estado global · **Depende de:** `patch_codec.js`, `default_patches.js`

**Fonte única de verdade** da aplicação. Padrão **Observer** via `EventTarget`.
Todos os módulos de UI escutam eventos emitidos aqui e nunca modificam
o estado diretamente — apenas chamam métodos do `state`.

Singleton exportado: `state` (instância única de `StateManager`).

**Eventos emitidos (via `CustomEvent` no próprio objeto):**
| Evento | `detail` | Disparado quando |
|---|---|---|
| `state:patch-bank-loaded` | `{ patches }` | Banco carregado do storage |
| `state:patch-changed` | `{ patchIndex, patch }` | Patch selecionado ou modificado |
| `state:slot-selected` | `{ slotIndex }` | Slot selecionado/deselecionado |
| `state:param-changed` | `{ patchIndex, slotIndex, paramIndex, value }` | Parâmetro alterado |
| `state:fx-toggled` | `{ patchIndex, slotIndex, on }` | Efeito ligado/desligado |
| `state:fx-added` | `{ patchIndex, slotIndex, fxName }` | Efeito adicionado |
| `state:fx-removed` | `{ patchIndex, slotIndex }` | Efeito removido |
| `state:fx-reordered` | `{ patchIndex, fromSlot, toSlot }` | Efeitos reordenados |
| `state:midi-status` | `{ connected, portName }` | Status MIDI mudou |

**Undo stack:** cada mutação salva um `clonePatch()` por patch (máx 20).
`state.undo()` restaura o último snapshot.

---

### `midi/midi_manager.js`
**Tipo:** MIDI · **Depende de:** `state_manager`, `sysex_constants`, `patch_codec`, `sysex_log`, `notifications`

Gerencia toda a comunicação com a pedaleira via **Web MIDI API**.

Fluxo de conexão:
```
initMidi()
  └─ navigator.requestMIDIAccess({ sysex: true })
       └─ refreshPorts()  ← popula selects, auto-seleciona Zoom
            └─ connectMidi()  ← chamado pelo botão CONECTAR
                 ├─ input.onmidimessage = _onMidiMessage
                 ├─ sendRaw(buildEditorOn())
                 └─ sendRaw(buildIdentityRequest())
```

Fluxo de recebimento:
```
_onMidiMessage(e)
  ├─ isIdentityResponse? → notify('G1on identificado')
  └─ isZoomG1onSysex?
       ├─ CMD 0x28 (patch dump) → decodePatch() → state.setPatch()
       └─ CMD 0x31 (param change) → state.setParam() ou state.toggleEffect()
```

Exporta funções públicas:
- `initMidi()` — inicializar (chamado no boot)
- `connectMidi()` / `disconnectMidi()`
- `refreshPorts()` — re-popular selects
- `sendRaw(bytes[])` — enviar bytes brutos
- `requestCurrentPatch()` — solicitar dump
- `sendPatch(patch)` — enviar patch completo
- `savePatchToSlot(slotIndex)` — gravar na pedaleira
- `sendParamChange(fxSlot, paramIdx, value)` — edição em tempo real
- `selectPatchOnDevice(slotIndex)` — Program Change

---

### `storage/patch_storage.js`
**Tipo:** Storage · **Depende de:** nada

Camada de persistência que simula **LittleFS** usando `localStorage` como backend.

**Estrutura de arquivos no "LittleFS":**
```
g1on/meta.json          ← metadados (schema, timestamps, count)
g1on/patch_000.json     ← slot 0
g1on/patch_001.json     ← slot 1
...
g1on/patch_099.json     ← slot 99
```

Cada `patch_NNN.json`:
```json
{
  "slot": 0,
  "name": "CLEAN BOOST",
  "savedAt": "2025-03-19T12:00:00.000Z",
  "effects": [
    { "name": "GrayComp", "on": true, "params": [80, 100] },
    ...
  ]
}
```

**Migração para LittleFS real (ESP32/RP2040):**
Substitua apenas as funções internas `_fsRead(path)` e `_fsWrite(path, data)`
pelos equivalentes da API LittleFS do seu framework. A interface pública
e o formato JSON permanecem idênticos.

Exporta:
- `hasStoredData()` — verifica se há dados salvos
- `savePatch(patch)` / `loadPatch(slot)`
- `savePatchBank(patches[])` / `loadPatchBank(total)`
- `deletePatch(slot)` / `clearAllStorage()`
- `getStorageStats()` — contagem, tamanho em KB, timestamps
- `exportBankJSON(patches[])` → string JSON para download
- `importBankJSON(jsonStr)` → array de patches ou null

---

### `storage/settings_storage.js`
**Tipo:** Storage · **Depende de:** nada

Persiste as preferências do usuário em `g1on/settings.json`.

Configurações disponíveis (com defaults):
| Chave | Tipo | Default | Descrição |
|---|---|---|---|
| `realtimeSend` | bool | `true` | Envia parâmetros em tempo real via MIDI |
| `confirmDelete` | bool | `false` | Confirma antes de remover efeito |
| `autoSave` | bool | `false` | Salva automaticamente ao trocar de patch |
| `tapWindowSize` | int | `8` | Janela de taps para média do BPM |
| `lastPatchIndex` | int | `0` | Último patch selecionado (restaurado no boot) |
| `theme` | string | `'dark'` | Tema visual (`dark` \| `oled`) |
| `sysexLogMaxLines` | int | `200` | Máximo de linhas no log SysEx |

Exporta:
- `getSettings()` / `getSetting(key)`
- `setSettings(updates)` / `setSetting(key, value)`
- `resetSettings()`

---

### `ui/notifications.js`
**Tipo:** UI · **Depende de:** nada

Toast de notificações no canto superior direito. Desaparece automaticamente.

Exporta:
- `notify(message, type, duration)` — `type`: `'ok'` | `'err'` | `'info'`

---

### `ui/sysex_log.js`
**Tipo:** UI · **Depende de:** `settings_storage`

Monitor de tráfego SysEx em tempo real. Drawer deslizante na parte inferior.
Mostra TX (laranja) e RX (verde) com timestamp e bytes em hexadecimal.

Exporta o singleton `sysexLog`:
- `.addEntry(direction, bytes[])` — adiciona linha ao log
- `.toggle()` — abre/fecha o drawer
- `.clear()` — limpa o log

---

### `ui/patch_list.js`
**Tipo:** UI · **Depende de:** `state_manager`

Renderiza a sidebar esquerda com a lista de patches.
Escuta `state:patch-bank-loaded` e `state:patch-changed` para re-renderizar.
Suporta busca em tempo real por nome ou número de slot.

Exporta:
- `initPatchList()` — registra listeners e renderiza inicialmente
- `render()` — re-renderiza a lista completa

---

### `ui/signal_chain.js`
**Tipo:** UI · **Depende de:** `state_manager`, `effects_catalog`, `midi_manager`

Renderiza o rack central com os 5 slots de efeito.

Funcionalidades:
- **Re-render completo** em mudanças de patch/slot/efeito
- **Atualização parcial** de mini-knobs via `id="knob-S-P"` (sem re-render)
- **Drag & drop** HTML5 nativo para reordenação
- **Knob drag** via `mousedown`/`mousemove`/`mouseup` com delta vertical

Exporta:
- `initSignalChain()` — registra listeners e renderiza
- `render()` — re-renderiza a cadeia completa
- `startKnobDrag(e, slotIdx, paramIdx)` — inicia drag de knob
- `onDragStart/Over/Leave/Drop` — handlers de drag & drop

---

### `ui/param_editor.js`
**Tipo:** UI · **Depende de:** `state_manager`, `effects_catalog`, `midi_manager`, `tap_tempo`, `settings_storage`

Renderiza o painel direito com os sliders de parâmetros do efeito selecionado.

Funcionalidades:
- **Re-render completo** ao trocar de slot ou patch
- **Sync parcial** de sliders via `id="slider-S-P"` quando parâmetro muda externamente (ex: knob drag)
- **Gradiente live** do slider atualizado via `style.background` sem re-render
- **Tap Tempo** usa instância da classe `TapTempo` para calcular BPM

Exporta:
- `initParamEditor()`
- `onParamSlider(slotIdx, paramIdx, sliderEl)` — callback do `oninput`
- `onTapTempo(slotIdx, paramIdx)` — callback do botão TAP

---

### `ui/effect_browser.js`
**Tipo:** UI · **Depende de:** `state_manager`, `effects_catalog`, `notifications`

Modal de seleção de efeitos com busca de texto e filtro por categoria.
Filtra em tempo real os 222 efeitos do catálogo.

Exporta:
- `initEffectBrowser()`
- `openBrowser(slotIndex)` — abre modal para o slot especificado
- `closeBrowser()`
- `pickEffect(fxName)` — confirma seleção, chama `state.addEffect()`
- `setCat(category)` — muda filtro de categoria ativo

---

## Fluxo de Dados Completo

### Usuário ajusta um parâmetro (slider)

```
[HTML slider oninput]
  → window._ui.onParamSlider(slotIdx, paramIdx, el)
    → param_editor.js :: onParamSlider()
      → state.setParam(slotIdx, paramIdx, value)          [mutação]
        → emite 'state:param-changed'
          ├─ param_editor.js ouve → sincroniza slider/display
          └─ signal_chain.js ouve → atualiza mini-knob
      → sendParamChange(slotIdx, paramIdx+1, value)        [MIDI TX]
        → midi_manager.js :: sendRaw(buildParamChange(...))
          → sysex_log.addEntry('TX', bytes)
```

### Pedaleira envia mudança de parâmetro (knob girado no hardware)

```
[Web MIDI API onmidimessage]
  → midi_manager.js :: _onMidiMessage()
    → sysex_log.addEntry('RX', bytes)
    → isZoomG1onSysex() → true
      → _handleZoomSysex()
        → CMD_BYTE.PARAM_CHANGE
          → state.setParam(slot, param-1, val)             [mutação]
            → emite 'state:param-changed'
              ├─ param_editor.js ouve → atualiza slider
              └─ signal_chain.js ouve → atualiza mini-knob
```

### Salvar patch

```
[Botão SALVAR / Ctrl+S]
  → window._ui.savePatch()
    → app.js :: _doSavePatch()
      → patch.dirty = false
      → savePatch(patch)                                   [LittleFS TX]
        → storage/patch_storage.js :: savePatch()
          → _fsWrite('patch_000.json', data)
            → localStorage.setItem('g1on/patch_000.json', JSON)
      → savePatchToSlot(idx)                               [MIDI TX, se conectado]
        → midi_manager.js :: sendRaw(buildPatchSave(idx))
      → state.dispatchEvent('state:patch-changed')
        → patch_list.js ouve → remove marcador dirty (*)
```

---

## Dependências entre Módulos (grafo)

```
index.html
  └── app.js
        ├── engine/state_manager      ← patch_codec, default_patches
        ├── engine/patch_codec        ← sysex_packer, effects_catalog
        ├── engine/sysex_packer       (sem deps)
        ├── engine/tap_tempo          (sem deps)
        ├── data/effects_catalog      (sem deps)
        ├── data/sysex_constants      (sem deps)
        ├── data/default_patches      (sem deps)
        ├── midi/midi_manager         ← state_manager, sysex_constants,
        │                               patch_codec, sysex_log, notifications
        ├── storage/patch_storage     (sem deps)
        ├── storage/settings_storage  (sem deps)
        ├── ui/notifications          (sem deps)
        ├── ui/sysex_log              ← settings_storage
        ├── ui/patch_list             ← state_manager
        ├── ui/signal_chain           ← state_manager, effects_catalog, midi_manager
        ├── ui/param_editor           ← state_manager, effects_catalog,
        │                               midi_manager, tap_tempo, settings_storage
        └── ui/effect_browser         ← state_manager, effects_catalog, notifications
```

**Módulos sem dependências externas** (folhas do grafo):
`sysex_packer`, `tap_tempo`, `effects_catalog`, `sysex_constants`,
`default_patches`, `patch_storage`, `settings_storage`, `notifications`

---

## Convenções de Código

| Convenção | Descrição |
|---|---|
| ES Modules | `import`/`export` nativos — sem CommonJS, sem bundler |
| Singletons | `state`, `sysexLog`, `tapEngine` — instâncias únicas exportadas |
| Eventos | `CustomEvent` no `state` EventTarget — desacopla UI do engine |
| IDs HTML | `id="knob-S-P"` e `id="slider-S-P"` para updates parciais sem re-render |
| `window._ui` | Ponte controlada entre HTML inline e módulos ES |
| Imutabilidade | `clonePatch()` para undo — nunca mutação direta de snapshots |
| Nomenclatura | `camelCase` para funções, `UPPER_CASE` para constantes, `PascalCase` para classes |
| Comentários | JSDoc em todas as funções públicas exportadas |
