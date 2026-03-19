# G1on Editor

Editor de patches open-source para pedaleiras Zoom, desenvolvido com Web MIDI API.

## Dispositivos Suportados

| Modelo    | DevID  | Categoria       |
|-----------|--------|-----------------|
| G1on      | 0x61   | Guitar Multi-FX |
| G1on-AK   | 0x61   | Guitar Multi-FX |
| G1Xon     | 0x62   | Guitar + Exp    |
| G1Xon-K   | 0x63   | Guitar + Exp    |
| G1four    | 0x64   | Guitar FOUR     |
| G1Xfour   | 0x65   | Guitar FOUR+Exp |
| G3n/G3Xn  | 0x6E   | Guitar Pro      |
| G5n       | 0x73   | Guitar Flagship |
| B1on      | 0x5F   | Bass Multi-FX   |
| B1Xon     | 0x66   | Bass + Exp      |
| B1four    | 0x71   | Bass FOUR       |
| MS-50G    | 0x58   | Guitar Stomp    |

## Como Rodar

```bash
npm install
npm run dev
```

Abra no **Chrome** ou **Edge** (únicos browsers com Web MIDI API).
Conecte a pedaleira via USB, clique em **Connect Pedal** e autorize o acesso MIDI quando solicitado.

## Estrutura do Projeto

```
src/
  protocol/
    zoom-protocol.js      # SysEx message builders + parsers
    effects-catalog.js    # Catálogo de efeitos com IDs e parâmetros
  midi/
    midi-manager.js       # Web MIDI API wrapper + device detection
  store/
    device-controller.js  # Operações de alto nível (read/write/backup/restore)
  main.js                 # Entry point — conecta UI ao controller
index.html                # Shell da aplicação
```

## Protocolo SysEx

```
F0  52  00  [DevID]  [Cmd]  [Data...]  F7

Handshake:
  PC → Pedal: F0 7E 00 06 01 F7              (Universal Identity Request)
  Pedal → PC: F0 7E 00 06 02 52 00 [DevID] [fw_major] [fw_minor] ... F7

Patch read:
  PC → Pedal: F0 52 00 61 28 [slot_lo] [slot_hi] F7
  Pedal → PC: F0 52 00 61 28 [slot_lo] [slot_hi] [fx_data] [name_10] F7

Patch frame structure:
  [fx1_id] [fx1_p1..p6]  (7 bytes per FX slot)
  [fx2_id] [fx2_p1..p6]
  ...
  [name_10bytes]          (ASCII, space-padded)
```

## Próximos Passos

- [ ] Captura USB com USBPcap/Wireshark para confirmar IDs de efeitos exatos
- [ ] UI drag-and-drop para reordenar efeitos na chain
- [ ] Suporte a export/import de patches individuais (.json)
- [ ] Tuner display (ativar/desativar tuner via SysEx)
- [ ] Mapeamento completo de parâmetros via sniffing ao vivo

## Fontes do Protocolo

- Análise estática de strings/binários do `ToneLib-Zoom.exe`
- Projetos open-source da comunidade: `zoominfo`, `zoom-mst`
- Documentação MIDI Universal Identity Request (MIDI 1.0 Spec)
