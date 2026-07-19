// Test fixtures built from the theory of the format, not from the library
// under test: a synthetic memory file shaped like a real pedal dump, and a
// hand-assembled RIFF/WAVE buffer.

export function buildSlotBody(name = 'Memory 00') {
  const padded = (name + ' '.repeat(12)).slice(0, 12);
  let s = '\n<NAME>\n';
  for (let i = 0; i < 12; i++) {
    const tag = 'C' + String(i + 1).padStart(2, '0');
    s += `\t<${tag}>${padded.charCodeAt(i)}</${tag}>\n`;
  }
  s += '</NAME>\n<TRACK1>\n';
  const track = [['Rev', 0], ['PlyLvl', 100], ['Pan', 50], ['One', 0], ['StrtMod', 0], ['StpMod', 0],
    ['Measure', 0], ['MeasMod', 1], ['MeasLen', 0], ['MeasBtLp', 0], ['RecTmp', 1200], ['WavStat', 0], ['WavLen', 0]];
  for (const [t, v] of track) s += `\t<${t}>${v}</${t}>\n`;
  s += '</TRACK1>\n<MASTER>\n';
  const master = [['Tempo', 1200], ['DubMode', 0], ['RecAction', 1], ['AutoRec', 0], ['FadeTime', 5],
    ['Level', 100], ['LpMod', 0], ['LpLen', 0], ['TrkMod', 1], ['Sync', 0]];
  for (const [t, v] of master) s += `\t<${t}>${v}</${t}>\n`;
  s += '</MASTER>\n<RHYTHM>\n';
  const rhythm = [['Level', 100], ['Reverb', 0], ['Pattern', 0], ['Variation', 0], ['VariationChange', 0],
    ['Kit', 0], ['Beat', 2], ['Fill', 0], ['Part1', 1], ['Part2', 1], ['Part3', 1], ['Part4', 1],
    ['RecCount', 0], ['PlayCount', 0], ['Start', 0], ['Stop', 0], ['ToneLow', 10], ['ToneHigh', 10], ['State', 0]];
  for (const [t, v] of rhythm) s += `\t<${t}>${v}</${t}>\n`;
  s += '</RHYTHM>\n';
  return s;
}

export function buildMemoryText({ tailMarker = 0x38, slots = 99 } = {}) {
  let xml = '<?xml version="1.0" encoding="utf-8"?>\n<database name="RC-5" revision="0">\n';
  for (let i = 0; i < slots; i++)
    xml += `<mem id="${i}">${buildSlotBody(`Memory ${String(i + 1).padStart(2, '0')}`)}</mem>\n`;
  xml += '</database>';
  return xml + '\n' + String.fromCharCode(tailMarker) + '\0\0\0';
}

export function makeWav({ tag = 1, channels = 2, sampleRate = 44100, bits = 16, frames = 1000,
                          extraChunk = false, truncateBy = 0 } = {}) {
  const blockAlign = channels * (bits / 8);
  const dataSize = frames * blockAlign;
  const extra = extraChunk ? 8 + 26 : 0;
  const buf = Buffer.alloc(12 + 8 + 16 + extra + 8 + dataSize);
  let off = 0;
  buf.write('RIFF', off); buf.writeUInt32LE(buf.length - 8, off + 4); buf.write('WAVE', off + 8); off += 12;
  buf.write('fmt ', off); buf.writeUInt32LE(16, off + 4);
  buf.writeUInt16LE(tag, off + 8); buf.writeUInt16LE(channels, off + 10);
  buf.writeUInt32LE(sampleRate, off + 12); buf.writeUInt32LE(sampleRate * blockAlign, off + 16);
  buf.writeUInt16LE(blockAlign, off + 20); buf.writeUInt16LE(bits, off + 22); off += 24;
  if (extraChunk) { buf.write('LIST', off); buf.writeUInt32LE(26, off + 4); off += 8 + 26; }
  buf.write('data', off); buf.writeUInt32LE(dataSize, off + 4);
  return truncateBy ? buf.subarray(0, buf.length - truncateBy) : buf;
}
