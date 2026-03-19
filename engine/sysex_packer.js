/**
 * engine/sysex_packer.js
 * Compactação e descompactação 7-bit para protocolo SysEx Zoom G1on
 *
 * O protocolo SysEx MIDI limita cada byte a 7 bits (0x00–0x7F).
 * A Zoom usa o esquema "7-bit packing" onde grupos de 7 bytes de dados
 * reais são transmitidos como 8 bytes SysEx:
 *
 *   Byte 0 (MSB byte): contém os bits 7 de cada um dos 7 bytes seguintes
 *   Bytes 1–7:         os 7 bits inferiores de cada byte de dado
 *
 * Exemplo:
 *   Dados reais:    [0xA1, 0x02, 0xC3, 0x04, 0xE5, 0x06, 0xF7]
 *   bits7:           1      0     1     0     1     0     1    => MSB = 0x55
 *   Transmitido:    [0x55, 0x21, 0x02, 0x43, 0x04, 0x65, 0x06, 0x77]
 */

/**
 * Converte array de bytes normais (0–255) em formato 7-bit packed SysEx.
 * @param {number[]} data - bytes de dados reais
 * @returns {number[]} bytes prontos para envio SysEx
 */
export function packTo7Bit(data) {
  const result = [];
  let i = 0;

  while (i < data.length) {
    const chunk = data.slice(i, i + 7);
    // Byte MSB: bit 7 de cada byte do grupo (bit 0 = primeiro byte)
    let msb = 0;
    for (let j = 0; j < chunk.length; j++) {
      if (chunk[j] & 0x80) msb |= (1 << j);
    }
    result.push(msb);
    // 7 bits inferiores de cada byte
    for (const b of chunk) result.push(b & 0x7F);
    i += 7;
  }

  return result;
}

/**
 * Converte bytes 7-bit packed de volta para dados normais (0–255).
 * @param {number[]} packed - bytes recebidos via SysEx
 * @returns {number[]} bytes de dados reais
 */
export function unpackFrom7Bit(packed) {
  const result = [];
  let i = 0;

  while (i < packed.length) {
    const msb = packed[i++];
    for (let j = 0; j < 7 && i < packed.length; j++, i++) {
      const bit7 = (msb >> j) & 1;
      result.push(packed[i] | (bit7 << 7));
    }
  }

  return result;
}

/**
 * Calcula o tamanho packed resultante para N bytes de dados reais.
 * @param {number} dataLength
 * @returns {number}
 */
export function packedSize(dataLength) {
  return Math.ceil(dataLength / 7) * 8;
}

/**
 * Calcula o tamanho de dados reais para N bytes packed.
 * @param {number} packedLength
 * @returns {number}
 */
export function unpackedSize(packedLength) {
  return Math.floor(packedLength / 8) * 7;
}
