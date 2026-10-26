import SwiftUI
import AppKit
import ServiceManagement

final class SessionModel: ObservableObject {
    enum Tab { case practice, history, settings }

    @Published var tab: Tab = .practice { didSet { notice = "" } }
    @Published var entries: [Entry] = Store.load()
    @Published var selectedID: UUID?

    @Published var topic = ""
    @Published var started = false
    @Published var index = 0
    @Published var answers = ["", "", ""]
    @Published var notice = ""
    @Published var topicLink: String?
    @Published var topicNotes = ""          // 自己貼的逐字稿或重點（選填）
    private var episodeTranscript: String?  // 選了建議的那一集時，App 抓到的逐字稿
    @Published var episode: Episode?

    // 提醒設定（存在 UserDefaults，改了就重新排程）
    @Published var reminderEnabled = UserDefaults.standard.object(forKey: "reminderEnabled") as? Bool ?? true {
        didSet { applyReminder() }
    }
    @Published var reminderMinutes = UserDefaults.standard.object(forKey: "reminderMinutes") as? Int ?? 12 * 60 + 15 {
        didSet { applyReminder() }
    }
    @Published var reminderWeekends = UserDefaults.standard.object(forKey: "reminderWeekends") as? Bool ?? false {
        didSet { applyReminder() }
    }
    @Published var reminderStatus = ""

    /// 自己貼的內容優先；沒貼就用 App 抓到的逐字稿
    private var pastedOrEpisodeTranscript: String? {
        let pasted = topicNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        return pasted.isEmpty ? episodeTranscript : pasted
    }

    var question: Question { Content.questions[index] }
    var hasNext: Bool { index < Content.questions.count - 1 }
    var selectedEntry: Entry? { entries.first { $0.id == selectedID } }

    private var answeredItems: [Item] {
        zip(Content.questions, answers).compactMap { q, a in
            let t = a.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : Item(label: q.label, question: q.text, answer: t)
        }
    }

    // MARK: 提醒與建議的那一集

    func applyReminder() {
        let d = UserDefaults.standard
        d.set(reminderEnabled, forKey: "reminderEnabled")
        d.set(reminderMinutes, forKey: "reminderMinutes")
        d.set(reminderWeekends, forKey: "reminderWeekends")
        Reminder.schedule(enabled: reminderEnabled, minutes: reminderMinutes, weekends: reminderWeekends) { text in
            DispatchQueue.main.async { self.reminderStatus = text }
        }
    }

    func sendTestNotification() {
        Reminder.sendTest { text in
            DispatchQueue.main.async { self.reminderStatus = text }
        }
    }

    var launchAtLogin: Bool { SMAppService.mainApp.status == .enabled }

    func setLaunchAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            notice = ""
        } catch {
            notice = "設定開機啟動失敗：\(error.localizedDescription)（可以試著把 App 放進「應用程式」資料夾）"
        }
        objectWillChange.send()
    }

    func refreshEpisode() {
        Episode.fetchLatest { ep in
            DispatchQueue.main.async { if let ep = ep { self.episode = ep } }
        }
    }

    func useEpisodeAsTopic() {
        guard let ep = episode else { return }
        topic = "BBC 6 Minute English：\(ep.title)"
        topicLink = ep.pageURL.absoluteString
        episodeTranscript = ep.transcript
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
        topicLink = nil
        topicNotes = ""
        episodeTranscript = nil
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
            feedback: "",
            link: topicLink,
            transcript: pastedOrEpisodeTranscript
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
        var s = Content.coachRules + "\n\n今天聽的是：\(entry.topic)\n"
        if let link = entry.link { s += "集數頁面：\(link)\n" }
        if let text = entry.transcript {
            s += "\n【這集的內容（BBC 說明這份不是逐字一模一樣的逐字稿）】\n\(text)\n"
        } else {
            s += "\n（這次沒有附內容。）\n"
        }
        for item in entry.items {
            s += "\n題目（\(item.label)）：\(item.question)\n我的回答：\(item.answer)\n"
        }
        s += "\n請依上面的規則給回饋。"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        if let url = URL(string: "https://claude.ai/new") {
            NSWorkspace.shared.open(url)
        }
        notice = entry.transcript == nil
            ? "已複製（沒有附內容，Claude 可能會請你貼重點），貼到 Claude 就好。"
            : "已複製（含規則與內容），貼到 Claude 就好。"
    }

    private func persist() {
        do {
            try Store.save(entries)
        } catch {
            notice = "存檔失敗：\(error.localizedDescription)"
        }
    }
}
