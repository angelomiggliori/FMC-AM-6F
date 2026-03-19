# G1on Editor — ToneLib Web

Editor web completo para a Zoom G1on / G1Xon, baseado nos arquivos ZDL da série.

---

## Estrutura de Arquivos

```
g1on-editor/
│
├── index.html              ← Entrada principal (abrir no browser)
├── app.js                  ← Bootstrap e orquestrador geral
│
├── data/
│   ├── effects_catalog.js  ← 222 efeitos ZDL: ID, params, tap, categoria
│   ├── sysex_constants.js  ← Builders de mensagens SysEx G1on (product 0x64)
│   └── default_patches.js  ← 8 patches de fábrica + createEmptyPatch()
│
├── engine/
│   ├── sysex_packer.js     ← 7-bit pack/unpack para protocolo SysEx MIDI
│   ├── patch_codec.js      ← encodePatch() / decodePatch() / clonePatch()
│   ├── tap_tempo.js        ← Classe TapTempo com média móvel (40–300 BPM)
│   └── state_manager.js    ← Singleton Observer — fonte única de verdade
│
├── midi/
│   └── midi_manager.js     ← Web MIDI API: connect, TX/RX, roteamento
│
├── storage/
│   ├── patch_storage.js    ← LittleFS shim: g1on/patch_NNN.json por slot
│   └── settings_storage.js ← Preferências em g1on/settings.json
│
└── ui/
    ├── notifications.js    ← Toast de notificações
    ├── sysex_log.js        ← Monitor SysEx TX/RX em tempo real
    ├── patch_list.js       ← Sidebar: lista de 100 patches com busca
    ├── signal_chain.js     ← Rack: 5 slots, drag&drop, mini-knobs
    ├── param_editor.js     ← Painel: sliders + tap tempo por efeito
    └── effect_browser.js   ← Modal: 222 efeitos, filtro por categoria
```

---

## Como Usar

### Requisitos
- Chrome 98+ ou Edge 98+ (suporte a **Web MIDI API com SysEx**)
- Zoom G1on ou G1Xon conectada via USB
- Servidor HTTP local (não funciona com `file://` por restrições de módulos ES6)

### Servidor local rápido
```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Ou VS Code Live Server
```

Acesse: `http://localhost:8080`

### Conexão MIDI
1. Conecte a G1on via USB
2. Abra no Chrome — o browser pedirá permissão para MIDI com SysEx: **Permitir**
3. Selecione as portas "Zoom G1on" no header (auto-detectado)
4. Clique **CONECTAR** — o editor envia `Editor Mode ON` automaticamente

### Editar Patches
- **Lista de patches** → clique para selecionar
- **Cadeia de efeitos** → clique no slot para ver parâmetros na direita
- **Mini-knobs** → arraste para cima/baixo para ajustar valor
- **⇄** → troca o efeito do slot (abre browser de 222 efeitos)
- **✕** → remove efeito do slot
- **LED verde** → liga/desliga efeito
- **Arrastar** → reordena slots na cadeia

### Salvar
- **▶ ENVIAR** → envia patch para buffer temporário da pedaleira
- **✦ SALVAR** → salva no slot permanente (pedaleira + LittleFS local)
- `Ctrl+S` → atalho de salvar
- `Ctrl+Z` → desfazer última ação

### Export/Import
- **↑ EXP** → exporta banco completo como JSON
- **↓ IMP** → importa banco de arquivo JSON
- **FS** → mostra estatísticas do LittleFS (localStorage)

---

## Protocolo SysEx G1on

| Comando | Bytes |
|---|---|
| Editor Mode ON | `F0 52 00 64 50 F7` |
| Editor Mode OFF | `F0 52 00 64 51 F7` |
| Patch Dump Request | `F0 52 00 64 29 F7` |
| Patch Upload | `F0 52 00 64 28 [dados 7-bit packed] F7` |
| Patch Save (slot N) | `F0 52 00 64 32 01 00 00 NN 00 00 00 00 00 F7` |
| Param Change | `F0 52 00 64 31 [slot] [param] [val_lo] [val_hi] F7` |
| Identity Request | `F0 7E 00 06 01 F7` |

### Formato do Patch (após unpack 7-bit)
```
Bytes 00–54 : 5 slots × 11 bytes
  [base+0]  : on/off (0x00 = off, 0x01 = on)
  [base+1]  : effectId bits 0–6
  [base+2]  : effectId bit 7
  [base+3–10]: params p0–p7 (0–127)

Bytes 55–64 : nome do patch (10 chars ASCII)
```

---

## Migrar para Hardware Real (ESP32 / RP2040 com LittleFS)

Substitua apenas as funções internas de `storage/patch_storage.js`:

```cpp
// Arduino / ESP32 — equivalente de _fsRead / _fsWrite
#include <LittleFS.h>

String fsRead(const char* path) {
  File f = LittleFS.open(path, "r");
  if (!f) return "";
  String s = f.readString();
  f.close();
  return s;
}

bool fsWrite(const char* path, const String& data) {
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  f.print(data);
  f.close();
  return true;
}
```

A estrutura de arquivos e o formato JSON permanecem idênticos.

---

## Catálogo de Efeitos

**222 efeitos** extraídos dos arquivos `.ZDL` binários (DSP da série G1on).

| Categoria | Quantidade |
|---|---|
| Drive/Distortion | 33 |
| Amp Sim | 21 |
| Filter/Wah | 19 |
| EQ/Utility | 18 |
| Modulation | 17 |
| Pitch/Synth | 17 |
| Delay | 16 |
| Reverb | 15 |
| Dynamics | 12 |
| Other | 54 |
| **Total** | **222** |

46 efeitos possuem **Tap Tempo** via parâmetro dedicado.

---

## Atalhos de Teclado

| Tecla | Ação |
|---|---|
| `↑ / ↓` | Navegar patches |
| `Ctrl+S` | Salvar patch atual |
| `Ctrl+Enter` | Enviar patch para pedaleira |
| `Ctrl+Z` | Desfazer |
| `Esc` | Fechar modal |

---

*G1on Editor — ToneLib Web · Projeto open source · Protocolo via análise reversa*
