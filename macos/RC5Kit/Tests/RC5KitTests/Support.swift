import Foundation

// Shared golden values captured from real hardware — the same file the JS
// suite reads. One truth, two runners.
struct Golden: Decodable {
    struct Constants: Decodable {
        let samplesPerMinute, maxTempoTenths, minTempoTenths: Int
        let measureFieldOffset, nameLength, slotCount: Int
    }
    struct SlotParam: Decodable { let frames, measures, tempoTenths: Int; let source: String }
    struct OutOfRange: Decodable { let tooShortFrames, tooLongFrames: Int }
    struct TechnicalName: Decodable { let name: String; let technical: Bool }
    struct NameEncoding: Decodable { let name: String; let codes: [Int] }
    struct CanonicalHeader: Decodable { let base64: String; let sizeFieldOffsets: [Int] }
    let constants: Constants
    let tailMarkers: [String: Int]
    let slotParams: [SlotParam]
    let outOfRange: OutOfRange
    let technicalNames: [TechnicalName]
    let nameEncoding: NameEncoding
    let canonicalFloat32Header: CanonicalHeader?
    let factorySlot: [String: [String: Int]]

    static let shared: Golden = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // Support.swift → RC5KitTests
            .deletingLastPathComponent()  // → Tests
            .deletingLastPathComponent()  // → RC5Kit
            .deletingLastPathComponent()  // → macos
            .deletingLastPathComponent()  // → repo root
            .appendingPathComponent("fixtures/golden.json")
        let decoder = JSONDecoder()
        // factorySlot sections carry a "_comment" string key — strip via JSONSerialization first
        var object = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        if var factory = object["factorySlot"] as? [String: Any] {
            factory.removeValue(forKey: "_comment")
            object["factorySlot"] = factory
        }
        object.removeValue(forKey: "_comment")
        let cleaned = try! JSONSerialization.data(withJSONObject: object)
        return try! decoder.decode(Golden.self, from: cleaned)
    }()
}

// Synthetic fixtures built from the theory of the format, mirroring test/helpers.js.
enum Synthetic {
    static func slotBody(name: String = "Memory 00") -> String {
        let padded = String((name + String(repeating: " ", count: 12)).prefix(12))
        var s = "\n<NAME>\n"
        for (i, char) in padded.unicodeScalars.enumerated() {
            let tag = String(format: "C%02d", i + 1)
            s += "\t<\(tag)>\(char.value)</\(tag)>\n"
        }
        s += "</NAME>\n<TRACK1>\n"
        let track: [(String, Int)] = [("Rev", 0), ("PlyLvl", 100), ("Pan", 50), ("One", 0),
            ("StrtMod", 0), ("StpMod", 0), ("Measure", 0), ("MeasMod", 1), ("MeasLen", 0),
            ("MeasBtLp", 0), ("RecTmp", 1200), ("WavStat", 0), ("WavLen", 0)]
        for (t, v) in track { s += "\t<\(t)>\(v)</\(t)>\n" }
        s += "</TRACK1>\n<MASTER>\n"
        let master: [(String, Int)] = [("Tempo", 1200), ("DubMode", 0), ("RecAction", 1),
            ("AutoRec", 0), ("FadeTime", 5), ("Level", 100), ("LpMod", 0), ("LpLen", 0),
            ("TrkMod", 1), ("Sync", 0)]
        for (t, v) in master { s += "\t<\(t)>\(v)</\(t)>\n" }
        s += "</MASTER>\n<RHYTHM>\n"
        let rhythm: [(String, Int)] = [("Level", 100), ("Reverb", 0), ("Pattern", 0),
            ("Variation", 0), ("VariationChange", 0), ("Kit", 0), ("Beat", 2), ("Fill", 0),
            ("Part1", 1), ("Part2", 1), ("Part3", 1), ("Part4", 1), ("RecCount", 0),
            ("PlayCount", 0), ("Start", 0), ("Stop", 0), ("ToneLow", 10), ("ToneHigh", 10),
            ("State", 0)]
        for (t, v) in rhythm { s += "\t<\(t)>\(v)</\(t)>\n" }
        s += "</RHYTHM>\n"
        return s
    }

    static func memoryText(tailMarker: UInt8 = 0x38, slots: Int = 99) -> String {
        var xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<database name=\"RC-5\" revision=\"0\">\n"
        for i in 0..<slots {
            xml += "<mem id=\"\(i)\">" + slotBody(name: String(format: "Memory %02d", i + 1)) + "</mem>\n"
        }
        xml += "</database>"
        return xml + "\n" + String(UnicodeScalar(tailMarker)) + "\0\0\0"
    }

    static func wav(tag: Int = 1, channels: Int = 2, sampleRate: Int = 44100, bits: Int = 16,
                    frames: Int = 1000, extraChunk: Bool = false, truncateBy: Int = 0) -> Data {
        let blockAlign = channels * (bits / 8)
        let dataSize = frames * blockAlign
        var buf = Data()
        func putASCII(_ s: String) { buf.append(contentsOf: s.utf8) }
        func put16(_ v: Int) { buf.append(UInt8(v & 0xff)); buf.append(UInt8((v >> 8) & 0xff)) }
        func put32(_ v: Int) { put16(v & 0xffff); put16((v >> 16) & 0xffff) }
        let extra = extraChunk ? 8 + 26 : 0
        putASCII("RIFF"); put32(12 + 24 + extra + 8 + dataSize - 8); putASCII("WAVE")
        putASCII("fmt "); put32(16)
        put16(tag); put16(channels); put32(sampleRate); put32(sampleRate * blockAlign)
        put16(blockAlign); put16(bits)
        if extraChunk { putASCII("LIST"); put32(26); buf.append(Data(count: 26)) }
        putASCII("data"); put32(dataSize)
        buf.append(Data(count: dataSize))
        return truncateBy > 0 ? buf.prefix(buf.count - truncateBy) : buf
    }
}
