/**
 * effects-catalog.js
 * Effect IDs and metadata extracted from ToneLib-Zoom.exe binary analysis
 *
 * Each entry maps an effect ID (as found in patch data) to its metadata.
 * Parameters are inferred from the 6-byte param structure per effect slot.
 */

export const EFFECT_CATEGORIES = {
  COMP:    'Compressor / Dynamics',
  DRIVE:   'Drive / Distortion / Boost',
  MOD:     'Modulation',
  DELAY:   'Delay',
  REVERB:  'Reverb',
  FILTER:  'Filter / Wah / Pitch',
  EQ:      'EQ',
  BASS:    'Bass Specific',
  CAB:     'Cabinet / Amp Sim',
  SPECIAL: 'Special / Multi',
};

/**
 * Effects catalog
 * id: as found in fx_id byte of patch data
 * Note: IDs are indicative — exact mapping requires live USB capture for confirmation
 */
export const EFFECTS = {
  // ── Compressors ──────────────────────────────────────────────────────────
  0x00: { name: 'Empty',    category: null,          file: null,             params: [] },
  0x01: { name: 'OptComp',  category: 'COMP',  file: 'OPTCOMP.ZD2SD',  params: ['Level', 'Sensitivity', 'Tone', 'Attack'] },
  0x02: { name: 'D Comp',   category: 'COMP',  file: 'DCOMP.ZD2SD',    params: ['Sustain', 'Level', 'Attack', 'Tone'] },
  0x03: { name: 'M Comp',   category: 'COMP',  file: 'MB_COMP.ZD2SD',  params: ['Low Ratio', 'High Ratio', 'Attack', 'Release', 'Level'] },
  0x04: { name: '160 Comp', category: 'COMP',  file: '160_COMP.ZD2SD', params: ['Threshold', 'Ratio', 'Attack', 'Release', 'Level'] },
  0x05: { name: 'GrayComp', category: 'COMP',  file: 'GRAYCOMP.ZD2SD', params: ['Sustain', 'Level'] },
  0x06: { name: 'GlamComp', category: 'COMP',  file: 'GLAMCOMP.ZD2SD', params: ['Threshold', 'Attack', 'Release', 'Level'] },
  0x07: { name: 'RackComp', category: 'COMP',  file: 'RACKCOMP.ZD2SD', params: ['Threshold', 'Ratio', 'Attack', 'Release', 'Level'] },
  0x08: { name: 'DualComp', category: 'COMP',  file: null,             params: ['Sensitivity', 'Level', 'Tone'] },
  0x09: { name: 'Limiter',  category: 'COMP',  file: null,             params: ['Threshold', 'Release', 'Level'] },
  0x0A: { name: 'Exciter',  category: 'COMP',  file: null,             params: ['Frequency', 'Mix', 'Level'] },

  // ── Drive / Distortion ───────────────────────────────────────────────────
  0x10: { name: 'Booster',    category: 'DRIVE', file: null,              params: ['Gain', 'Tone', 'Level'] },
  0x11: { name: 'OverDrive',  category: 'DRIVE', file: null,              params: ['Drive', 'Tone', 'Level'] },
  0x12: { name: 'Dist 1',     category: 'DRIVE', file: 'DIST_1.ZD2SD',   params: ['Gain', 'Tone', 'Level'] },
  0x13: { name: 'Dist+',      category: 'DRIVE', file: 'DISTPLUS.ZD2SD', params: ['Gain', 'Tone', 'Output'] },
  0x14: { name: 'TS Drive',   category: 'DRIVE', file: 'TS_DRIVE.ZD2SD', params: ['Drive', 'Tone', 'Level'] },
  0x15: { name: 'TS Boost',   category: 'DRIVE', file: 'TS_BOOST.ZD2SD', params: ['Drive', 'Tone', 'Level'] },
  0x16: { name: 'RC Boost',   category: 'DRIVE', file: 'RCBOOST.ZD2SD',  params: ['Volume', 'Bass', 'Treble', 'Bright'] },
  0x17: { name: 'Spt Boost',  category: 'DRIVE', file: 'SPTBOOST.ZD2SD', params: ['Gain', 'Tone', 'Level'] },
  0x18: { name: 'FuzzSmile',  category: 'DRIVE', file: null,              params: ['Fuzz', 'Volume', 'Tone'] },
  0x19: { name: 'OctFuzz',    category: 'DRIVE', file: 'OCTFUZZ.ZD2SD',  params: ['Fuzz', 'Volume', 'Oct Mix'] },
  0x1A: { name: 'DynDrive',   category: 'DRIVE', file: 'DYNDRIVE.ZD2SD', params: ['Gain', 'Tone', 'Level', 'Sensitivity'] },
  0x1B: { name: 'BassDrive',  category: 'DRIVE', file: null,              params: ['Gain', 'Bass', 'Treble', 'Level'] },

  // ── Modulation ───────────────────────────────────────────────────────────
  0x20: { name: 'Chorus',    category: 'MOD', file: 'CHORUS.ZD2SD',   params: ['Rate', 'Depth', 'Pre Delay', 'Level'] },
  0x21: { name: 'Flanger',   category: 'MOD', file: null,             params: ['Rate', 'Depth', 'Resonance', 'Level'] },
  0x22: { name: 'Phaser',    category: 'MOD', file: 'PHASER.ZD2SD',  params: ['Rate', 'Depth', 'Resonance', 'Level'] },
  0x23: { name: '4-Phaser',  category: 'MOD', file: null,             params: ['Rate', 'Depth', 'Resonance', 'Level'] },
  0x24: { name: '8-Phaser',  category: 'MOD', file: null,             params: ['Rate', 'Depth', 'Resonance', 'Level'] },
  0x25: { name: 'Tremolo',   category: 'MOD', file: 'TREMOLO.ZD2SD', params: ['Rate', 'Depth', 'Wave', 'Level'] },
  0x26: { name: 'Vibrato',   category: 'MOD', file: 'VIBRATO.ZD2SD', params: ['Rate', 'Depth', 'Level'] },

  // ── Delay ─────────────────────────────────────────────────────────────────
  0x30: { name: 'Delay',     category: 'DELAY', file: 'DELAY.ZD2SD',     params: ['Time', 'Feedback', 'Mix', 'Level'] },
  0x31: { name: 'Delay 3S',  category: 'DELAY', file: 'DELAY_3S.ZD2SD',  params: ['Time', 'Feedback', 'Mix', 'Level'] },
  0x32: { name: 'ModDelay',  category: 'DELAY', file: 'MODDELAY.ZD2SD',  params: ['Time', 'Feedback', 'Rate', 'Depth', 'Mix'] },
  0x33: { name: 'PitchDly',  category: 'DELAY', file: 'PITCHDLY.ZD2SD',  params: ['Time', 'Feedback', 'Pitch', 'Mix'] },
  0x34: { name: 'DynaDelay', category: 'DELAY', file: null,               params: ['Time', 'Feedback', 'Sensitivity', 'Mix'] },
  0x35: { name: 'FilterDly', category: 'DELAY', file: null,               params: ['Time', 'Feedback', 'Filter', 'Mix'] },

  // ── Reverb ────────────────────────────────────────────────────────────────
  0x38: { name: 'HD Reverb',  category: 'REVERB', file: null, params: ['Time', 'Pre Delay', 'Mix', 'Level'] },
  0x39: { name: 'ModReverb',  category: 'REVERB', file: null, params: ['Time', 'Rate', 'Depth', 'Mix'] },

  // ── Filter / Wah / Pitch ──────────────────────────────────────────────────
  0x40: { name: 'AutoWah',   category: 'FILTER', file: 'AUTOWAH.ZD2SD',  params: ['Sensitivity', 'Frequency', 'Resonance', 'Mix'] },
  0x41: { name: 'PedalWah',  category: 'FILTER', file: null,             params: ['Frequency', 'Resonance', 'Mix'] },
  0x42: { name: 'A-Filter',  category: 'FILTER', file: 'A_FILTER.ZD2SD', params: ['Sensitivity', 'Frequency', 'Resonance', 'Level'] },
  0x43: { name: 'M-Filter',  category: 'FILTER', file: null,             params: ['Frequency', 'Resonance', 'Mix', 'Level'] },
  0x44: { name: 'EgFilter',  category: 'FILTER', file: 'EGFILTER.ZD2SD', params: ['Sensitivity', 'Frequency', 'Attack', 'Mix'] },
  0x45: { name: 'SeqFLTR',   category: 'FILTER', file: 'SEQFLTR.ZD2SD',  params: ['Rate', 'Depth', 'Resonance', 'Step', 'Level'] },
  0x46: { name: 'Step',      category: 'FILTER', file: null,             params: ['Rate', 'Depth', 'Level'] },
  0x47: { name: 'Z Tron',    category: 'FILTER', file: null,             params: ['Sensitivity', 'Frequency', 'Mix'] },
  0x48: { name: 'Cry',       category: 'FILTER', file: null,             params: ['Frequency', 'Resonance', 'Mix'] },
  0x50: { name: 'Octave',    category: 'FILTER', file: 'OCTAVE.ZD2SD',   params: ['Oct1', 'Oct2', 'Direct', 'Level'] },
  0x51: { name: 'MonoPitch', category: 'FILTER', file: null,             params: ['Shift', 'Fine', 'Level'] },
  0x52: { name: 'PitchSHFT', category: 'FILTER', file: 'PITCHSHF.ZD2SD', params: ['Shift', 'Fine', 'Level'] },
  0x53: { name: 'PDL Pitch', category: 'FILTER', file: null,             params: ['Range', 'Level'] },

  // ── EQ ───────────────────────────────────────────────────────────────────
  0x60: { name: 'ParaEQ',    category: 'EQ', file: 'PARAEQ.ZD2SD',     params: ['Low', 'Mid', 'High', 'Level'] },
  0x61: { name: 'GraphicEQ', category: 'EQ', file: null,               params: ['80Hz', '250Hz', '800Hz', '2.5kHz', '8kHz', 'Level'] },
  0x62: { name: 'GT GEQ',    category: 'EQ', file: 'GT_GEQ.ZD2SD',    params: ['100Hz', '400Hz', '1kHz', '4kHz', '8kHz', 'Level'] },
  0x63: { name: 'GT GEQ 7',  category: 'EQ', file: 'GT_GEQ_7.ZD2SD',  params: ['100Hz', '200Hz', '400Hz', '1kHz', '2kHz', '4kHz', 'Level'] },
  0x64: { name: 'High EQ',   category: 'EQ', file: 'HIGH_EQ.ZD2SD',   params: ['Frequency', 'Gain', 'Level'] },
  0x65: { name: 'Low EQ',    category: 'EQ', file: 'LOW_EQ.ZD2SD',    params: ['Frequency', 'Gain', 'Level'] },

  // ── Bass Specific ─────────────────────────────────────────────────────────
  0x70: { name: 'BassWah',   category: 'BASS', file: 'BASSWAH.ZD2SD',  params: ['Sensitivity', 'Frequency', 'Mix'] },
  0x71: { name: 'Ba AutoWah',category: 'BASS', file: 'B_ATWAH.ZD2SD',  params: ['Sensitivity', 'Frequency', 'Resonance', 'Mix'] },
  0x72: { name: 'Ba Octave', category: 'BASS', file: 'B_OCTAVE.ZD2SD', params: ['Oct1', 'Oct2', 'Direct', 'Level'] },
  0x73: { name: 'Ba Pitch',  category: 'BASS', file: 'B_PITCH.ZD2SD',  params: ['Shift', 'Fine', 'Level'] },
  0x74: { name: 'Black Wah', category: 'BASS', file: 'BLCK_WAH.ZD2SD', params: ['Sensitivity', 'Frequency', 'Mix'] },
  0x75: { name: 'Chrome Wah',category: 'BASS', file: 'CHRM_WAH.ZD2SD', params: ['Sensitivity', 'Frequency', 'Mix'] },
  0x76: { name: 'Ba GEQ',    category: 'BASS', file: 'BA_GEQ.ZD2SD',   params: ['60Hz', '250Hz', '800Hz', '3.2kHz', '8kHz', 'Level'] },
  0x77: { name: 'Ba PEQ',    category: 'BASS', file: 'BA_PEQ.ZD2SD',   params: ['Low', 'Mid', 'High', 'Level'] },

  // ── Cabinet / Amp Sims ────────────────────────────────────────────────────
  0x80: { name: 'MS 1959',    category: 'CAB', file: 'MS1959.ZD2SD',    params: ['Level'] },
  0x81: { name: 'MS 4x12',    category: 'CAB', file: 'MS4X12.ZD2SD',    params: ['Level'] },
  0x82: { name: 'MS 4x12 AL', category: 'CAB', file: 'MS4X12AL.ZD2SD',  params: ['Level'] },
  0x83: { name: 'MS 4x12 GB', category: 'CAB', file: 'MS4X12GB.ZD2SD',  params: ['Level'] },
  0x84: { name: 'MS 800',     category: 'CAB', file: 'MS800.ZD2SD',     params: ['Level'] },
  0x85: { name: 'Ampeg SVT',  category: 'CAB', file: 'AG750.ZD2SD',     params: ['Level'] },
  0x86: { name: 'Ampeg B-15', category: 'CAB', file: 'B15N.ZD2SD',      params: ['Level'] },
  0x87: { name: 'Fender 4x10',category: 'CAB', file: 'FDB4X10.ZD2SD',   params: ['Level'] },
  0x88: { name: 'Fender 4x12',category: 'CAB', file: 'FD_B4X12.ZD2SD',  params: ['Level'] },
  0x89: { name: 'Eden 4x10',  category: 'CAB', file: 'EB4X10TW.ZD2SD',  params: ['Level'] },
  0x8A: { name: 'Orange 120', category: 'CAB', file: 'ORG1201U.ZD2SD',  params: ['Level'] },
  0x8B: { name: 'Markbass 2x8',category:'CAB', file: 'MKB2X8TW.ZD2SD',  params: ['Level'] },
};

/** Get effect metadata by ID, with fallback for unknown effects */
export function getEffect(fxId) {
  return EFFECTS[fxId] ?? { name: `Unknown (0x${fxId.toString(16).toUpperCase()})`, category: null, file: null, params: [] };
}

/** Get all effects grouped by category */
export function getEffectsByCategory() {
  const grouped = {};
  for (const [idStr, effect] of Object.entries(EFFECTS)) {
    const id  = parseInt(idStr);
    const cat = effect.category ?? 'SPECIAL';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ id, ...effect });
  }
  return grouped;
}

/** Get effects available for a specific device category */
export function getEffectsForDevice(deviceCategory) {
  return Object.entries(EFFECTS)
    .filter(([, fx]) => {
      if (!fx.category) return false;
      if (deviceCategory === 'bass') return true; // bass can use all
      if (deviceCategory === 'guitar') return fx.category !== 'BASS'; // guitar skips bass-specific
      return true;
    })
    .map(([id, fx]) => ({ id: parseInt(id), ...fx }));
}
