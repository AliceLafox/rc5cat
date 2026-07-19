// Minimal RIFF/WAVE header reader — just enough to validate a file for the
// RC-5 and count its frames. No decoding.

export const SAMPLE_RATE = 44100;

const FORMAT_NAMES = { 1: 'pcm', 3: 'float' };

export function readWavInfo(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a RIFF/WAVE file');

  let fmt = null;
  let dataBytes = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('malformed fmt chunk');
      fmt = {
        tag: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        blockAlign: buf.readUInt16LE(off + 20),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      if (off + 8 + size > buf.length)
        throw new Error(`truncated file: data chunk claims ${size} bytes, file has ${buf.length - off - 8}`);
      dataBytes = size;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error('missing fmt chunk');
  if (dataBytes === null) throw new Error('missing data chunk');

  const formatName = FORMAT_NAMES[fmt.tag];
  if (!formatName) throw new Error(`unsupported WAVE format tag ${fmt.tag}`);
  if (fmt.blockAlign === 0) throw new Error('malformed fmt chunk: blockAlign is 0');

  return {
    format: `${formatName}${fmt.bitsPerSample}`,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    frames: Math.floor(dataBytes / fmt.blockAlign),
    dataBytes,
  };
}

// What we accept for upload. Roland documents 44.1 kHz stereo WAV at 16-bit,
// 24-bit and 32-bit float — float being the pedal's own native recording
// format; 16-bit and float32 are additionally verified on real hardware.
const ACCEPTED_FORMATS = new Set(['pcm16', 'pcm24', 'float32']);

export function assertUploadable(info) {
  if (info.sampleRate !== SAMPLE_RATE)
    throw new Error(`sample rate must be ${SAMPLE_RATE} Hz, got ${info.sampleRate}`);
  if (info.channels !== 2)
    throw new Error(`file must be stereo, got ${info.channels} channel(s)`);
  if (!ACCEPTED_FORMATS.has(info.format))
    throw new Error(`format must be 16-bit PCM or 32-bit float, got ${info.format}`);
  return info;
}
