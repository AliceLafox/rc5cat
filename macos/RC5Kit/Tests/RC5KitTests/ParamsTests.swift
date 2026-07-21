import Testing
@testable import RC5Kit

@Suite struct ParamsTests {
    @Test func matchesEveryGoldenValueFromRealHardware() throws {
        for entry in Golden.shared.slotParams {
            let p = try Params.computeSlotParams(frames: entry.frames)
            #expect(p.measures == entry.measures, "\(entry.source) \(entry.frames)")
            #expect(p.tempoTenths == entry.tempoTenths, "\(entry.source) \(entry.frames)")
            #expect(p.measureField == entry.measures + Golden.shared.constants.measureFieldOffset)
        }
    }

    @Test func constantsAgreeWithGolden() {
        #expect(Params.samplesPerMinute == Golden.shared.constants.samplesPerMinute)
        #expect(Params.maxTempoTenths == Golden.shared.constants.maxTempoTenths)
        #expect(Params.minTempoTenths == Golden.shared.constants.minTempoTenths)
        #expect(Params.measureFieldOffset == Golden.shared.constants.measureFieldOffset)
    }

    @Test func tooShortSampleThrows() {
        #expect(throws: RC0.Error.self) {
            try Params.computeSlotParams(frames: Golden.shared.outOfRange.tooShortFrames)
        }
    }

    @Test func tooLongSampleThrows() {
        #expect(throws: RC0.Error.self) {
            try Params.computeSlotParams(frames: Golden.shared.outOfRange.tooLongFrames)
        }
    }

    @Test func invalidFrameCountsThrow() {
        #expect(throws: RC0.Error.self) { try Params.computeSlotParams(frames: 0) }
        #expect(throws: RC0.Error.self) { try Params.computeSlotParams(frames: -1) }
    }
}
