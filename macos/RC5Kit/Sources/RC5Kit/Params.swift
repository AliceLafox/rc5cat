import Foundation

/// Slot parameters the RC-5 derives when it indexes a WAV at boot.
///
/// Observed behavior, verified against configs the pedal generated itself:
/// it picks the largest power-of-two measure count whose implied tempo stays
/// at or below 160 BPM, computes the tempo in tenths of BPM truncated (not
/// rounded), and stores Measure as the measure count plus a constant 7.
/// 2,646,000 is samples-per-minute at 44.1 kHz.
public enum Params {
    public static let samplesPerMinute = 2_646_000
    public static let maxTempoTenths = 1600
    public static let minTempoTenths = 200
    public static let measureFieldOffset = 7
    static let beatsPerMeasure = 4
    static let maxMeasures = 4096

    public struct SlotParams: Equatable {
        public let measures: Int
        public let tempoTenths: Int
        public var measureField: Int { measures + Params.measureFieldOffset }
    }

    public static func computeSlotParams(frames: Int) throws -> SlotParams {
        guard frames > 0 else {
            throw RC0.Error("frames must be a positive integer, got \(frames)")
        }
        var measures = maxMeasures
        while measures >= 1 {
            let beats = measures * beatsPerMeasure
            let tempoTenths = beats * samplesPerMinute * 10 / frames
            if tempoTenths <= maxTempoTenths {
                guard tempoTenths >= minTempoTenths else {
                    throw RC0.Error(
                        "sample of \(frames) frames implies \(Double(tempoTenths) / 10) BPM even at \(measures) measures — below the pedal's tempo range")
                }
                return SlotParams(measures: measures, tempoTenths: tempoTenths)
            }
            measures /= 2
        }
        throw RC0.Error(
            "sample of \(frames) frames is too short: tempo exceeds \(maxTempoTenths / 10) BPM even at 1 measure")
    }
}
