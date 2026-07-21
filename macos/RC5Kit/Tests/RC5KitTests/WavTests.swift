import Testing
import Foundation
@testable import RC5Kit

@Suite struct WavTests {
    @Test func parses16BitPCMStereo() throws {
        let info = try Wav.readWavInfo(Synthetic.wav(tag: 1, bits: 16, frames: 4321))
        #expect(info.format == "pcm16")
        #expect(info.channels == 2)
        #expect(info.sampleRate == 44100)
        #expect(info.frames == 4321)
        #expect(info.dataBytes == 4321 * 4)
    }

    @Test func parses32BitFloatStereo() throws {
        let info = try Wav.readWavInfo(Synthetic.wav(tag: 3, bits: 32, frames: 100))
        #expect(info.format == "float32")
        #expect(info.frames == 100)
    }

    @Test func extraChunksDoNotConfuseFrameCount() throws {
        #expect(try Wav.readWavInfo(Synthetic.wav(frames: 777, extraChunk: true)).frames == 777)
    }

    @Test func truncatedDataChunkThrows() {
        #expect(throws: RC0.Error.self) {
            try Wav.readWavInfo(Synthetic.wav(frames: 1000, truncateBy: 100))
        }
    }

    @Test func nonWaveInputThrows() {
        #expect(throws: RC0.Error.self) {
            try Wav.readWavInfo(Data("MP3 or whatever, sixty-four bytes of padding padding pad!!".utf8))
        }
        #expect(throws: RC0.Error.self) { try Wav.readWavInfo(Data(count: 10)) }
    }

    @Test func unsupportedCodecTagsThrow() {
        #expect(throws: RC0.Error.self) { try Wav.readWavInfo(Synthetic.wav(tag: 2)) }
    }

    @Test func uploadValidationRejectsWhatThePedalCannotPlay() throws {
        #expect(throws: RC0.Error.self) {
            try Wav.assertUploadable(Wav.readWavInfo(Synthetic.wav(channels: 1)))
        }
        #expect(throws: RC0.Error.self) {
            try Wav.assertUploadable(Wav.readWavInfo(Synthetic.wav(sampleRate: 48000)))
        }
        #expect(throws: RC0.Error.self) {
            try Wav.assertUploadable(Wav.readWavInfo(Synthetic.wav(tag: 1, bits: 8)))
        }
    }

    @Test func canonicalizeStripsMetadataAndKeepsAudio() throws {
        let messy = Synthetic.wav(tag: 1, bits: 16, frames: 500, extraChunk: true)
        let clean = try Wav.canonicalize(messy)
        #expect(clean.count == 44 + 500 * 4)
        let before = try Wav.readWavInfo(messy)
        let after = try Wav.readWavInfo(clean)
        #expect(after.frames == before.frames)
        #expect(after.format == before.format)
        #expect(messy.suffix(500 * 4) == clean.suffix(500 * 4))
    }

    @Test func canonicalizeGivesFloat32ThePedalStyleFmtBody() throws {
        let clean = try Wav.canonicalize(Synthetic.wav(tag: 3, bits: 32, frames: 100))
        #expect(clean.count == 56 + 100 * 8)
        #expect(clean[16] == 28)
        #expect(String(decoding: clean[48..<52], as: UTF8.self) == "data")
    }

    @Test func canonicalizeIsIdempotent() throws {
        let once = try Wav.canonicalize(Synthetic.wav(tag: 3, bits: 32, frames: 100, extraChunk: true))
        #expect(try Wav.canonicalize(once) == once)
    }

    @Test func technicalNamesMatchGoldenCases() {
        for entry in Golden.shared.technicalNames {
            #expect(Wav.isTechnicalWavName(entry.name) == entry.technical, "\(entry.name)")
        }
    }

    @Test func wavFileNameSanitizesHostileSlotNames() {
        #expect(Wav.wavFileName(slot: 7, name: "A/B:C*D\"    ") == "07 - A_B_C_D_.wav")
        #expect(Wav.wavFileName(slot: 13, name: "Test   Tubes") == "13 - Test Tubes.wav")
        #expect(Wav.wavFileName(slot: 3, name: "            ") == "03 - Memory03.wav")
    }

    @Test func pullNamingKeepsMeaningfulAndReplacesTechnical() {
        #expect(Wav.pullFileName(slot: 9, slotName: "Eleven LY", onPedalName: "FIFTH-~2.WAV")
            == "09 - Eleven LY.wav")
        #expect(Wav.pullFileName(slot: 9, slotName: "Eleven LY", onPedalName: "eleven-v01.wav")
            == "eleven-v01.wav")
    }
}
