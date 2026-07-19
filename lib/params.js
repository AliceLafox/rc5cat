// Slot parameters the RC-5 derives when it indexes a WAV at boot.
//
// Observed behavior, verified against configs the pedal generated itself:
// it picks the largest power-of-two measure count whose implied tempo stays
// at or below 160 BPM, computes the tempo in tenths of BPM truncated (not
// rounded), and stores Measure as the measure count plus a constant 7.
// 2646000 is samples-per-minute at 44.1 kHz.

export const SAMPLES_PER_MINUTE = 2646000;
export const MAX_TEMPO_TENTHS = 1600;
export const MIN_TEMPO_TENTHS = 200;
export const MEASURE_FIELD_OFFSET = 7;
const BEATS_PER_MEASURE = 4;
const MAX_MEASURES = 4096;

export function computeSlotParams(frames) {
  if (!Number.isInteger(frames) || frames <= 0)
    throw new Error(`frames must be a positive integer, got ${frames}`);
  for (let measures = MAX_MEASURES; measures >= 1; measures = Math.floor(measures / 2)) {
    const beats = measures * BEATS_PER_MEASURE;
    const tempoTenths = Math.floor((beats * SAMPLES_PER_MINUTE * 10) / frames);
    if (tempoTenths <= MAX_TEMPO_TENTHS) {
      if (tempoTenths < MIN_TEMPO_TENTHS)
        throw new Error(
          `sample of ${frames} frames implies ${tempoTenths / 10} BPM even at ${measures} measures — below the pedal's tempo range`);
      return { measures, tempoTenths, measureField: measures + MEASURE_FIELD_OFFSET };
    }
  }
  throw new Error(
    `sample of ${frames} frames is too short: tempo exceeds ${MAX_TEMPO_TENTHS / 10} BPM even at 1 measure`);
}
