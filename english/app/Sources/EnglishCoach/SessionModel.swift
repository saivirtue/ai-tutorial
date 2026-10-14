import SwiftUI
import AppKit

final class SessionModel: ObservableObject {
    @Published var topic = ""
    @Published var started = false
    @Published var index = 0
    @Published var answers = ["", "", ""]
    @Published var notice = ""

    var question: Question { Content.questions[index] }
    var hasNext: Bool { index < Content.questions.count - 1 }

    private var answered: [(Question, String)] {
        zip(Content.questions, answers)
            .map { ($0, $1.trimmingCharacters(in: .whitespacesAndNewlines)) }
            .filter { !$0.1.isEmpty }
    }

    func start() {
        guard !topic.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        started = true
        notice = ""
    }

    func next() {
        if hasNext { index += 1 }
    }

    func addFrame(_ frame: String) {
        let current = answers[index]
        if current.isEmpty {
            answers[index] = frame + " "
        } else {
            answers[index] = current + (current.hasSuffix(" ") ? "" : " ") + frame + " "
        }
    }

    func resetSession() {
        topic = ""
        started = false
        index = 0
        answers = ["", "", ""]
    }

    func save() {
        let items = answered
        guard !items.isEmpty else {
            notice = "還沒寫任何東西——寫一句就好。"
            return
        }
        do {
            let url = try Store.append(topic: topic, items: items)
            resetSession()
            notice = "已存到 \(url.path)"
        } catch {
            notice = "存檔失敗：\(error.localizedDescription)"
        }
    }

    /// 複製成可以直接貼給 Claude 的格式，並開啟 claude.ai
    func copyForClaude() {
        let items = answered
        guard !items.isEmpty else {
            notice = "還沒寫任何東西——寫一句就好。"
            return
        }
        var s = "今天聽的是：\(topic)\n"
        for (q, a) in items {
            s += "\n題目（\(q.label)）：\(q.text)\n我的回答：\(a)\n"
        }
        s += "\n請依教練規則給回饋。"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        if let url = URL(string: "https://claude.ai/new") {
            NSWorkspace.shared.open(url)
        }
        notice = "已複製，貼到 Claude 就好（記得 Project 裡要有教練提示詞）。"
    }
}
