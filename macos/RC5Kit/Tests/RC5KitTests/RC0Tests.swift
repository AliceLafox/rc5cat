import Testing
@testable import RC5Kit

@Suite struct RC0Tests {
    let file = Synthetic.memoryText()

    @Test func rejectsFileWithMissingSlot() {
        #expect(throws: RC0.Error.self) {
            try RC0.assertMemoryFile(Synthetic.memoryText(slots: 98))
        }
    }

    @Test func rejectsTextWithoutClosingTag() {
        #expect(throws: RC0.Error.self) { try RC0.assertMemoryFile("<database>") }
    }

    @Test func slotNumbersOutsideRangeThrow() {
        #expect(throws: RC0.Error.self) { try RC0.slotBody(file, slot: 0) }
        #expect(throws: RC0.Error.self) { try RC0.slotBody(file, slot: 100) }
    }

    @Test func fieldDemandsExactlyOneOccurrence() throws {
        #expect(throws: RC0.Error.self) { try RC0.field("<a>1</a>", "b") }
        #expect(throws: RC0.Error.self) { try RC0.field("<Level>1</Level><Level>2</Level>", "Level") }
        #expect(try RC0.field(RC0.slotBody(file, slot: 1), "Pan") == 50)
    }

    @Test func fieldMatchingIsExactNotPrefix() throws {
        let body = try RC0.setField(RC0.slotBody(file, slot: 1), "Measure", 263)
        #expect(try RC0.field(body, "Measure") == 263)
        #expect(try RC0.field(body, "MeasLen") == 0)
    }

    @Test func longNamesAreRejectedNotTruncated() {
        #expect(throws: RC0.Error.self) { try RC0.encodeName("ThirteenChars") }
    }

    @Test func nonASCIINamesAreRejected() {
        #expect(throws: RC0.Error.self) { try RC0.encodeName("КОТИК") }
        #expect(throws: RC0.Error.self) { try RC0.encodeName("café") }
        #expect(throws: RC0.Error.self) { try RC0.encodeName("tab\there") }
        #expect(throws: RC0.Error.self) { try RC0.encodeName("") }
    }

    @Test func shortNamesArePaddedTo12() throws {
        #expect(try RC0.encodeName("Cold Gaze") == "Cold Gaze   ")
    }

    @Test func nameRoundTripsAndMatchesGoldenEncoding() throws {
        let golden = Golden.shared.nameEncoding
        let body = try RC0.setName(RC0.slotBody(file, slot: 7), golden.name)
        #expect(try RC0.decodeName(body) == golden.name)
        let codes = body.matches(of: /<C\d\d>(\d+)<\/C\d\d>/).map { Int($0.1)! }
        #expect(codes == golden.codes)
    }

    @Test func renamingOneSlotLeavesEveryOtherByteUntouched() throws {
        let renamed = try RC0.replaceSlotBody(file, slot: 42,
            with: RC0.setName(RC0.slotBody(file, slot: 42), "New Name"))
        #expect(renamed != file)
        for slot in 1...99 where slot != 42 {
            #expect(try RC0.slotBody(renamed, slot: slot) == RC0.slotBody(file, slot: slot))
        }
        #expect(try RC0.splitFile(renamed).tail == RC0.splitFile(file).tail)
    }

    @Test func trailerMarkersAreReadAndRewrittenPerFile() throws {
        #expect(try RC0.tailMarker(file) == UInt8(Golden.shared.tailMarkers["memory1"]!))
        let asMemory2 = try RC0.setTailMarker(file, fileNo: 2)
        #expect(try RC0.tailMarker(asMemory2) == UInt8(Golden.shared.tailMarkers["memory2"]!))
        #expect(try RC0.splitFile(asMemory2).document == RC0.splitFile(file).document)
    }

    @Test func unrecognizedTrailerIsRefusedNeverRewritten() throws {
        let odd = try RC0.splitFile(file).document + "\nGARBAGE"
        #expect(try RC0.tailMarker(odd) == nil)
        #expect(throws: RC0.Error.self) { try RC0.setTailMarker(odd, fileNo: 1) }
    }

    @Test func factoryTemplateMatchesGoldenFixtures() throws {
        let body = try RC0.factorySlotBody(42)
        #expect(try RC0.decodeName(body) == "Memory42    ")
        for (section, fields) in Golden.shared.factorySlot {
            let block = String(body.firstRange(of: try Regex("<\(section)>[\\s\\S]*?</\(section)>"))
                .map { String(body[$0]) } ?? "")
            for (tag, value) in fields {
                #expect(try RC0.field(block, tag) == value, "\(section)/\(tag)")
            }
        }
    }
}
