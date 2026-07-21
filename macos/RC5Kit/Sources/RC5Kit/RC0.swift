import Foundation

/// MEMORY*.RC0 model — byte-safe surgical editing.
///
/// The RC-5's parser is strict and every memory file carries a per-file
/// trailer after `</database>` (MEMORY1 ends with `8\0\0\0`, MEMORY2 with
/// `9\0\0\0`; a wrong trailer triggers "LOOPER DATA READ ERR" on boot).
/// The invariant of this module: any byte we were not explicitly asked to
/// change is reproduced exactly. Files are handled as Latin-1 strings so
/// every byte round-trips unharmed.
public enum RC0 {
    public static let slotCount = 99
    public static let nameLength = 12
    public static let tailMarkers: [Int: UInt8] = [1: 0x38, 2: 0x39]

    public struct Error: Swift.Error, CustomStringConvertible {
        public let description: String
        init(_ message: String) { description = message }
    }

    private static let closingTag = "</database>"

    public static func splitFile(_ text: String) throws -> (document: String, tail: String) {
        guard let range = text.range(of: closingTag) else {
            throw Error("not an RC0 memory file: missing </database>")
        }
        return (String(text[..<range.upperBound]), String(text[range.upperBound...]))
    }

    public static func assertMemoryFile(_ text: String) throws {
        let document = try splitFile(text).document
        var seen = Set<Int>()
        for match in document.matches(of: /<mem id="(\d+)">/) {
            seen.insert(Int(match.1)!)
        }
        guard seen.count == slotCount else {
            throw Error("expected \(slotCount) <mem> entries, found \(seen.count)")
        }
        for id in 0..<slotCount where !seen.contains(id) {
            throw Error("missing <mem id=\"\(id)\">")
        }
    }

    private static func memRegion(_ text: String, slot: Int) throws -> Range<String.Index> {
        guard (1...slotCount).contains(slot) else {
            throw Error("slot out of range 1..\(slotCount): \(slot)")
        }
        let open = "<mem id=\"\(slot - 1)\">"
        guard let openRange = text.range(of: open) else {
            throw Error("missing <mem id=\"\(slot - 1)\">")
        }
        guard let closeRange = text.range(of: "</mem>", range: openRange.upperBound..<text.endIndex) else {
            throw Error("unterminated <mem id=\"\(slot - 1)\">")
        }
        return openRange.upperBound..<closeRange.lowerBound
    }

    public static func slotBody(_ text: String, slot: Int) throws -> String {
        String(text[try memRegion(text, slot: slot)])
    }

    public static func replaceSlotBody(_ text: String, slot: Int, with newBody: String) throws -> String {
        var copy = text
        copy.replaceSubrange(try memRegion(text, slot: slot), with: newBody)
        return copy
    }

    public static func field(_ body: String, _ tag: String) throws -> Int {
        let regex = try Regex("<\(tag)>(-?\\d+)</\(tag)>")
        let matches = body.matches(of: regex)
        guard matches.count == 1 else {
            throw Error("<\(tag)> occurs \(matches.count) times, expected exactly 1")
        }
        return Int(matches[0].output[1].substring!)!
    }

    public static func setField(_ body: String, _ tag: String, _ value: Int) throws -> String {
        _ = try field(body, tag) // enforces exactly-one occurrence
        let regex = try Regex("<\(tag)>-?\\d+</\(tag)>")
        return body.replacing(regex, with: "<\(tag)>\(value)</\(tag)>", maxReplacements: 1)
    }

    // MARK: - Slot names: 12 chars stored as decimal char codes in <C01>..<C12>

    public static func encodeName(_ name: String) throws -> String {
        guard !name.isEmpty else { throw Error("name must be a non-empty string") }
        guard name.count <= nameLength else {
            throw Error("name longer than \(nameLength) characters: \"\(name)\"")
        }
        guard name.allSatisfy({ $0.isASCII && ("\u{20}"..."\u{7e}").contains($0) }) else {
            throw Error("name must be printable ASCII (the pedal display cannot show anything else): \"\(name)\"")
        }
        return name.padding(toLength: nameLength, withPad: " ", startingAt: 0)
    }

    static func nameBlock(_ name: String) throws -> String {
        let padded = try encodeName(name)
        var out = "<NAME>\n"
        for (index, char) in padded.unicodeScalars.enumerated() {
            let tag = String(format: "C%02d", index + 1)
            out += "\t<\(tag)>\(char.value)</\(tag)>\n"
        }
        return out + "</NAME>"
    }

    public static func decodeName(_ body: String) throws -> String {
        let codes = body.matches(of: /<C\d\d>(\d+)<\/C\d\d>/)
        guard codes.count == nameLength else {
            throw Error("expected \(nameLength) <Cxx> name entries, found \(codes.count)")
        }
        return String(codes.map { Character(UnicodeScalar(UInt32($0.1)!)!) })
    }

    public static func setName(_ body: String, _ name: String) throws -> String {
        guard let block = body.firstRange(of: /<NAME>[\s\S]*?<\/NAME>/) else {
            throw Error("missing <NAME> block")
        }
        var copy = body
        copy.replaceSubrange(block, with: try nameBlock(name))
        return copy
    }

    public static func defaultSlotName(_ slot: Int) -> String {
        String(format: "Memory%02d", slot)
    }

    /// The body of a never-touched slot, exactly as the pedal formats it —
    /// captured from real hardware, where every virgin slot is byte-identical
    /// (note the non-obvious factory values: Measure=1, Reverb=30, Fill=1,
    /// Part4=0, rhythm Stop=1). This is what MEMORY CLEAR on the device leaves.
    public static func factorySlotBody(_ slot: Int) throws -> String {
        guard (1...slotCount).contains(slot) else {
            throw Error("slot out of range 1..\(slotCount): \(slot)")
        }
        let track1: [(String, Int)] = [
            ("Rev", 0), ("PlyLvl", 100), ("Pan", 50), ("One", 0), ("StrtMod", 0), ("StpMod", 0),
            ("Measure", 1), ("MeasMod", 1), ("MeasLen", 0), ("MeasBtLp", 0), ("RecTmp", 1200),
            ("WavStat", 0), ("WavLen", 0),
        ]
        let master: [(String, Int)] = [
            ("Tempo", 1200), ("DubMode", 0), ("RecAction", 1), ("AutoRec", 0), ("FadeTime", 5),
            ("Level", 100), ("LpMod", 0), ("LpLen", 0), ("TrkMod", 1), ("Sync", 0),
        ]
        let rhythm: [(String, Int)] = [
            ("Level", 100), ("Reverb", 30), ("Pattern", 0), ("Variation", 0), ("VariationChange", 0),
            ("Kit", 0), ("Beat", 2), ("Fill", 1), ("Part1", 1), ("Part2", 1), ("Part3", 1), ("Part4", 0),
            ("RecCount", 0), ("PlayCount", 0), ("Start", 0), ("Stop", 1), ("ToneLow", 10),
            ("ToneHigh", 10), ("State", 0),
        ]
        func section(_ tag: String, _ fields: [(String, Int)]) -> String {
            "<\(tag)>\n" + fields.map { "\t<\($0.0)>\($0.1)</\($0.0)>\n" }.joined() + "</\(tag)>\n"
        }
        return "\n" + (try nameBlock(defaultSlotName(slot))) + "\n"
            + section("TRACK1", track1) + section("MASTER", master) + section("RHYTHM", rhythm)
    }

    // MARK: - Trailer

    public static func tailMarker(_ text: String) throws -> UInt8? {
        let tail = try splitFile(text).tail
        let scalars = Array(tail.unicodeScalars)
        guard scalars.count >= 4 else { return nil }
        let last4 = scalars.suffix(4)
        guard last4.dropFirst().allSatisfy({ $0.value == 0 }), let first = last4.first,
              first.value <= 0xff else { return nil }
        return UInt8(first.value)
    }

    public static func setTailMarker(_ text: String, fileNo: Int) throws -> String {
        guard let marker = tailMarkers[fileNo] else {
            throw Error("fileNo must be 1 or 2, got \(fileNo)")
        }
        guard try tailMarker(text) != nil else {
            throw Error("unrecognized trailer after </database>; refusing to rewrite it")
        }
        return String(text.unicodeScalars.dropLast(4))
            + String(UnicodeScalar(marker)) + "\0\0\0"
    }
}
