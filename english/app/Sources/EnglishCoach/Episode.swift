import Foundation

/// BBC 6 Minute English 最新一集（從公開的 podcast 訂閱源讀取）
struct Episode {
    let title: String
    let summary: String     // 說明文字的第一段
    let minutes: Int
    let pageURL: URL        // 集數頁面：影片、逐字稿、worksheet
    var transcript: String? = nil   // 從集數頁面抽出的逐字稿；抓不到就是 nil

    static let seriesURL = URL(string: "https://www.bbc.co.uk/learningenglish/english/features/6-minute-english")!
    private static let feedURL = URL(string: "https://podcasts.files.bbci.co.uk/p02pc9tn.rss")!

    /// 讀不到（沒網路、格式變了）就回傳 nil，畫面上不顯示建議，其他功能照常
    static func fetchLatest(_ done: @escaping (Episode?) -> Void) {
        var request = URLRequest(url: feedURL)
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data = data, var episode = FeedParser.firstEpisode(in: data) else { return done(nil) }
            // 再去集數頁面抽逐字稿；失敗也照樣回傳這一集，只是沒有逐字稿
            var pageRequest = URLRequest(url: episode.pageURL)
            pageRequest.timeoutInterval = 15
            URLSession.shared.dataTask(with: pageRequest) { page, _, _ in
                if let page = page {
                    episode.transcript = Transcript.extract(from: String(decoding: page, as: UTF8.self))
                }
                done(episode)
            }.resume()
        }.resume()
    }
}

/// 只認 BBC Learning English 集數頁面的格式（「TRANSCRIPT」標題之後，到「Next」之前）。
/// 格式變了就回傳 nil，由呼叫端照實說「沒有逐字稿」。
enum Transcript {
    static func extract(from html: String) -> String? {
        guard let start = html.range(of: "TRANSCRIPT</strong></p>") else { return nil }
        var body = String(html[start.upperBound...])
        // 取最早出現的結束標記
        let ends = ["<h3>Next</h3>", "What do you think of the new version"]
            .compactMap { body.range(of: $0)?.lowerBound }
        if let end = ends.min() { body = String(body[..<end]) }
        if body.count > 15000 { body = String(body.prefix(15000)) }

        body = body
            .replacingOccurrences(of: #"<strong>([^<]{1,30})</strong>\s*<br\s*/?>"#, with: "\n$1: ",
                                  options: .regularExpression)
            .replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "</p>", with: "\n\n")
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&#x27;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "[ \t]+\n", with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // 太短代表抓到的不是逐字稿
        return body.count > 300 ? body : nil
    }
}

/// 只讀第一個 <item>，讀到就停（整份訂閱源有 800KB 以上）
private final class FeedParser: NSObject, XMLParserDelegate {
    private var path: [String] = []
    private var fields: [String: String] = [:]
    private var found = false

    static func firstEpisode(in data: Data) -> Episode? {
        let delegate = FeedParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        return delegate.found ? delegate.build() : nil
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                qualifiedName: String?, attributes: [String: String] = [:]) {
        path.append(name)
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { append(string) }

    func parser(_ parser: XMLParser, foundCDATA data: Data) {
        append(String(decoding: data, as: UTF8.self))
    }

    private func append(_ s: String) {
        // 只收 item 的直接子元素：path 是 [rss, channel, item, <欄位>]
        guard path.count == 4, path[2] == "item" else { return }
        fields[path[3], default: ""] += s
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?,
                qualifiedName: String?) {
        if name == "item" {
            found = true
            parser.abortParsing()
            return
        }
        path.removeLast()
    }

    private func build() -> Episode? {
        let title = (fields["title"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let html = fields["description"] ?? ""
        guard !title.isEmpty else { return nil }

        // 說明文字裡通常有「ep-yymmdd」的集數頁面連結；找不到就退回節目頁
        var page = Episode.seriesURL
        if let r = html.range(of: #"https://www\.bbc\.co\.uk/learningenglish/[^"<\s]+"#,
                              options: .regularExpression),
           let u = URL(string: String(html[r])) {
            page = u
        }

        let firstParagraph = html.components(separatedBy: "</p>").first ?? html
        let summary = firstParagraph
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let seconds = Int((fields["itunes:duration"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        return Episode(title: title, summary: summary, minutes: max(1, Int((Double(seconds) / 60).rounded())), pageURL: page)
    }
}
