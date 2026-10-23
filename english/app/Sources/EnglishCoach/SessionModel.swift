import SwiftUI
import AppKit

final class SessionModel: ObservableObject {
    enum Tab { case practice, history }

    @Published var tab: Tab = .practice { didSet { notice = "" } }
    @Published var entries: [Entry] = Store.load()
    @Published var selectedID: UUID?

    @Published var topic = ""
    @Published var started = false
    @Published var index = 0
    @Published var answers = ["", "", ""]
    @Published var notice = ""

    var question: Question { Content.questions[index] }
    var hasNext: Bool { index < Content.questions.count - 1 }
    var selectedEntry: Entry? { entries.first { $0.id == selectedID } }

    private var answeredItems: [Item] {
        zip(Content.questions, answers).compactMap { q, a in
            let t = a.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : Item(label: q.label, question: q.text, answer: t)
        }
    }

    // MARK: 練習

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

    /// 存起來；copy 為 true 時同時複製給 Claude 並開啟 claude.ai
    func commit(copy: Bool) {
        let items = answeredItems
        guard !items.isEmpty else {
            notice = "還沒寫任何東西——寫一句就好。"
            return
        }
        let entry = Entry(
            id: UUID(),
            date: Date(),
            topic: topic.trimmingCharacters(in: .whitespaces),
            items: items,
            feedback: ""
        )
        entries.insert(entry, at: 0)
        persist()
        resetSession()
        selectedID = entry.id
        tab = .history
        if copy {
            copyForClaude(entry)
        } else {
            notice = "已存起來，之後可以回來貼 Claude 的回饋。"
        }
    }

    // MARK: 紀錄

    func feedbackBinding(_ id: UUID) -> Binding<String> {
        Binding(
            get: { self.entries.first { $0.id == id }?.feedback ?? "" },
            set: { newValue in
                guard let i = self.entries.firstIndex(where: { $0.id == id }) else { return }
                self.entries[i].feedback = newValue
                self.persist()
            }
        )
    }

    /// 複製成可以直接貼給 Claude 的格式，並開啟 claude.ai
    func copyForClaude(_ entry: Entry) {
        var s = "今天聽的是：\(entry.topic)\n"
        for item in entry.items {
            s += "\n題目（\(item.label)）：\(item.question)\n我的回答：\(item.answer)\n"
        }
        s += "\n請依教練規則給回饋。"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        if let url = URL(string: "https://claude.ai/new") {
            NSWorkspace.shared.open(url)
        }
        notice = "已複製，貼到 Claude 就好（Project 裡要有教練提示詞）。"
    }

    private func persist() {
        do {
            try Store.save(entries)
        } catch {
            notice = "存檔失敗：\(error.localizedDescription)"
        }
    }
}
