import Foundation

enum Store {
    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("EnglishCoach", isDirectory: true)
    }
    private static var jsonURL: URL { directory.appendingPathComponent("entries.json") }
    private static var exportDir: URL { directory.appendingPathComponent("export", isDirectory: true) }

    static func load() -> [Entry] {
        guard let data = try? Data(contentsOf: jsonURL) else { return importLegacy() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let entries = try? decoder.decode([Entry].self, from: data) {
            return entries.isEmpty ? importLegacy() : entries
        }
        // 讀不懂時先備份，避免下次存檔把原檔蓋掉
        let backup = directory.appendingPathComponent("entries.broken-\(Int(Date().timeIntervalSince1970)).json")
        try? FileManager.default.copyItem(at: jsonURL, to: backup)
        return []
    }

    /// 舊版把紀錄存成 ~/EnglishCoach/yyyy-MM.md；第一次載入時讀進來（只讀，不改動舊檔）
    private static func importLegacy() -> [Entry] {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil) else { return [] }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd HH:mm"

        var result: [Entry] = []
        for url in files where url.pathExtension == "md" {
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            for section in ("\n" + text).components(separatedBy: "\n## ").dropFirst() {
                let parts = section.components(separatedBy: "\n\n")
                guard let header = parts.first,
                      let sep = header.range(of: " — "),
                      let date = fmt.date(from: String(header[..<sep.lowerBound])) else { continue }
                let topic = String(header[sep.upperBound...])

                var items: [Item] = []
                var pending: (label: String, question: String)?
                for block in parts.dropFirst() {
                    if block.hasPrefix("**") {
                        let rest = block.dropFirst(2)
                        if let end = rest.range(of: "** ") {
                            pending = (String(rest[..<end.lowerBound]),
                                       String(rest[end.upperBound...])
                                        .trimmingCharacters(in: .whitespacesAndNewlines))
                        }
                    } else if block.hasPrefix(">"), let p = pending {
                        let answer = block.components(separatedBy: "\n")
                            .map { $0.hasPrefix("> ") ? String($0.dropFirst(2)) : $0 }
                            .joined(separator: "\n")
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        items.append(Item(label: p.label, question: p.question, answer: answer))
                        pending = nil
                    }
                }
                if !items.isEmpty {
                    result.append(Entry(id: UUID(), date: date, topic: topic, items: items, feedback: ""))
                }
            }
        }
        return result.sorted { $0.date > $1.date }
    }

    /// entries.json 是主要資料；同時輸出 export/yyyy-MM.md 方便閱讀與週回顧
    static func save(_ entries: [Entry]) throws {
        try FileManager.default.createDirectory(at: exportDir, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(entries).write(to: jsonURL, options: .atomic)

        let monthFmt = DateFormatter()
        monthFmt.dateFormat = "yyyy-MM"
        let stampFmt = DateFormatter()
        stampFmt.dateFormat = "yyyy-MM-dd HH:mm"

        let byMonth = Dictionary(grouping: entries) { monthFmt.string(from: $0.date) }
        for (month, list) in byMonth {
            var text = ""
            for e in list.sorted(by: { $0.date < $1.date }) {
                text += "## \(stampFmt.string(from: e.date)) — \(e.topic)\n\n"
                for item in e.items {
                    text += "**\(item.label)** \(item.question)\n\n\(quote(item.answer))\n\n"
                }
                if !e.feedback.isEmpty {
                    text += "**Claude 回饋**\n\n\(quote(e.feedback))\n\n"
                }
            }
            try text.write(to: exportDir.appendingPathComponent("\(month).md"),
                           atomically: true, encoding: .utf8)
        }
    }

    private static func quote(_ s: String) -> String {
        "> " + s.replacingOccurrences(of: "\n", with: "\n> ")
    }
}
