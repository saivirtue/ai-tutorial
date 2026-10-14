import Foundation

enum Store {
    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("EnglishCoach", isDirectory: true)
    }

    /// 附加到 ~/EnglishCoach/yyyy-MM.md，回傳檔案位置
    static func append(topic: String, items: [(Question, String)]) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let monthFmt = DateFormatter()
        monthFmt.dateFormat = "yyyy-MM"
        let stampFmt = DateFormatter()
        stampFmt.dateFormat = "yyyy-MM-dd HH:mm"
        let now = Date()

        let file = directory.appendingPathComponent("\(monthFmt.string(from: now)).md")

        var text = "## \(stampFmt.string(from: now)) — \(topic)\n\n"
        for (q, a) in items {
            let quoted = a.replacingOccurrences(of: "\n", with: "\n> ")
            text += "**\(q.label)** \(q.text)\n\n> \(quoted)\n\n"
        }
        let data = Data(text.utf8)

        if FileManager.default.fileExists(atPath: file.path) {
            let handle = try FileHandle(forWritingTo: file)
            defer { try? handle.close() }
            _ = try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } else {
            try data.write(to: file)
        }
        return file
    }
}
