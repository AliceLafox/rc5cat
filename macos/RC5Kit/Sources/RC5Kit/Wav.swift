import Foundation

/// Minimal RIFF/WAVE reader and the pedal-canonical rewriter.
public enum Wav {
    public struct Info: Equatable {
        public let formatTag: Int
        public let channels: Int
        public let sampleRate: Int
        public let bitsPerSample: Int
        public let blockAlign: Int
        public let frames: Int
        public let dataBytes: Int
        public var format: String {
            (formatTag == 3 ? "float" : "pcm") + String(bitsPerSample)
        }
    }

    public static let sampleRate = 44100

    private static func u16(_ data: Data, _ offset: Int) -> Int {
        Int(data[data.startIndex + offset]) | Int(data[data.startIndex + offset + 1]) << 8
    }
    private static func u32(_ data: Data, _ offset: Int) -> Int {
        u16(data, offset) | u16(data, offset + 2) << 16
    }
    private static func ascii(_ data: Data, _ offset: Int, _ length: Int) -> String {
        String(decoding: data[data.startIndex + offset..<data.startIndex + offset + length],
               as: UTF8.self)
    }

    public static func readWavInfo(_ data: Data) throws -> Info {
        guard data.count >= 44, ascii(data, 0, 4) == "RIFF", ascii(data, 8, 4) == "WAVE" else {
            throw RC0.Error("not a RIFF/WAVE file")
        }
        var fmt: (tag: Int, channels: Int, rate: Int, blockAlign: Int, bits: Int)?
        var dataBytes: Int?
        var dataOffset = -1
        var offset = 12
        while offset + 8 <= data.count {
            let id = ascii(data, offset, 4)
            let size = u32(data, offset + 4)
            if id == "fmt " {
                guard size >= 16 else { throw RC0.Error("malformed fmt chunk") }
                fmt = (u16(data, offset + 8), u16(data, offset + 10), u32(data, offset + 12),
                       u16(data, offset + 20), u16(data, offset + 22))
            } else if id == "data" {
                guard offset + 8 + size <= data.count else {
                    throw RC0.Error("truncated file: data chunk claims \(size) bytes, file has \(data.count - offset - 8)")
                }
                dataBytes = size
                dataOffset = offset + 8
            }
            offset += 8 + size + (size % 2)
        }
        guard let fmt else { throw RC0.Error("missing fmt chunk") }
        guard let dataBytes else { throw RC0.Error("missing data chunk") }
        guard fmt.tag == 1 || fmt.tag == 3 else {
            throw RC0.Error("unsupported WAVE format tag \(fmt.tag)")
        }
        guard fmt.blockAlign > 0 else { throw RC0.Error("malformed fmt chunk: blockAlign is 0") }
        _ = dataOffset
        return Info(formatTag: fmt.tag, channels: fmt.channels, sampleRate: fmt.rate,
                    bitsPerSample: fmt.bits, blockAlign: fmt.blockAlign,
                    frames: dataBytes / fmt.blockAlign, dataBytes: dataBytes)
    }

    /// Rewrite a WAV into the pedal's own canonical shape: RIFF + fmt + data,
    /// nothing else — byte-identical to what the pedal's boot-time indexer
    /// would produce, so it never touches the upload. Float gets the pedal's
    /// 28-byte fmt body (cbSize=10, extension zeroed), PCM the classic 16-byte one.
    public static func canonicalize(_ data: Data) throws -> Data {
        let info = try readWavInfo(data)

        var offset = 12
        var dataStart = -1
        while offset + 8 <= data.count {
            let id = ascii(data, offset, 4)
            let size = u32(data, offset + 4)
            if id == "data" { dataStart = offset + 8; break }
            offset += 8 + size + (size % 2)
        }

        let fmtBody = info.formatTag == 3 ? 28 : 16
        var out = Data(capacity: 12 + 8 + fmtBody + 8 + info.dataBytes)
        func putASCII(_ s: String) { out.append(contentsOf: s.utf8) }
        func put16(_ v: Int) { out.append(UInt8(v & 0xff)); out.append(UInt8((v >> 8) & 0xff)) }
        func put32(_ v: Int) { put16(v & 0xffff); put16((v >> 16) & 0xffff) }

        putASCII("RIFF"); put32(12 + 8 + fmtBody + 8 + info.dataBytes - 8); putASCII("WAVE")
        putASCII("fmt "); put32(fmtBody)
        put16(info.formatTag); put16(info.channels); put32(info.sampleRate)
        put32(info.sampleRate * info.blockAlign); put16(info.blockAlign); put16(info.bitsPerSample)
        if fmtBody == 28 { put16(10); for _ in 0..<10 { out.append(0) } }
        putASCII("data"); put32(info.dataBytes)
        out.append(data[data.startIndex + dataStart..<data.startIndex + dataStart + info.dataBytes])
        return out
    }

    /// What we accept for upload. Roland documents 44.1 kHz stereo WAV at
    /// 16-bit, 24-bit and 32-bit float — float being the pedal's own native
    /// recording format.
    public static func assertUploadable(_ info: Info) throws {
        guard info.sampleRate == sampleRate else {
            throw RC0.Error("sample rate must be \(sampleRate) Hz, got \(info.sampleRate)")
        }
        guard info.channels == 2 else {
            throw RC0.Error("file must be stereo, got \(info.channels) channel(s)")
        }
        guard ["pcm16", "pcm24", "float32"].contains(info.format) else {
            throw RC0.Error("format must be 16/24-bit PCM or 32-bit float, got \(info.format)")
        }
    }

    // MARK: - Pull naming (mirrors lib/commands.js)

    public static func wavFileName(slot: Int, name: String) -> String {
        var clean = name.trimmingCharacters(in: .whitespaces)
            .replacing(/\s+/, with: " ")
            .replacing(/[\\\/:*?"<>|]/, with: "_")
        if clean.isEmpty { clean = RC0.defaultSlotName(slot) }
        return String(format: "%02d - %@.wav", slot, clean)
    }

    /// A filename the pedal manufactured rather than a human chose: DOS 8.3
    /// leftovers from FAT directory rebuilds ("FIFTH-~2.WAV") or bare
    /// uppercase 8.3 names.
    public static func isTechnicalWavName(_ name: String) -> Bool {
        name.contains(/~\d/) || name.wholeMatch(of: /[A-Z0-9~_\-]{1,8}\.WAV/) != nil
    }

    public static func pullFileName(slot: Int, slotName: String, onPedalName: String) -> String {
        isTechnicalWavName(onPedalName) ? wavFileName(slot: slot, name: slotName) : onPedalName
    }
}
