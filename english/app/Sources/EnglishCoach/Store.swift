import Foundation

enum Store {
    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("EnglishCoach", isDirectory: true)
    }
    private static var jsonURL: URL { directory.appendingPathComponent("entries.json") }
    private static var exportDir: URL { directory.appendingPathComponent("export", isDirectory: true) }

    static func load() -> [Entry] {
        guard let data = try? Data(contentsOf: jsonURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let entries = try? decoder.decode([Entry].self, from: data) {
            return entries
        }
        // 讀不懂時先備份，避免下次存檔把原檔蓋掉
        let backup = directory.appendingPathComponent("entries.broken-\(Int(Date().timeIntervalSince1970)).json")
        try? FileManager.default.copyItem(at: jsonURL, to: backup)
        return []
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
