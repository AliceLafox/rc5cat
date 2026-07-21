import Testing
import Foundation
@testable import RC5Kit

// The golden fixture holds the first 56 bytes of a float32 WAV exactly as a
// real pedal normalized it. Outside the two file-specific size fields, our
// canonicalize() must reproduce it byte-for-byte — the hardware claim stays
// verifiable forever without lugging real audio around.
@Suite struct CanonicalHeaderTests {
    @Test func float32HeaderMatchesRealPedalOutput() throws {
        guard let fixture = Golden.shared.canonicalFloat32Header,
              let pedal = Data(base64Encoded: fixture.base64) else {
            Issue.record("canonicalFloat32Header fixture missing"); return
        }
        let ours = try Wav.canonicalize(Synthetic.wav(tag: 3, bits: 32, frames: 100)).prefix(56)
        let skip = Set(fixture.sizeFieldOffsets)
        for i in 0..<56 where !skip.contains(i) {
            #expect(ours[ours.startIndex + i] == pedal[pedal.startIndex + i], "header byte \(i)")
        }
    }
}
