import SwiftUI

struct CoachView: View {
    @ObservedObject var model: SessionModel
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("", selection: $model.tab) {
                Text("練習").tag(SessionModel.Tab.practice)
                Text("紀錄（\(model.entries.count)）").tag(SessionModel.Tab.history)
                Text("設定").tag(SessionModel.Tab.settings)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            switch model.tab {
            case .practice:
                if model.started { questionView } else { startView }
            case .history:
                HistoryView(model: model)
            case .settings:
                SettingsView(model: model)
            }

            if !model.notice.isEmpty {
                Text(model.notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .frame(width: 480, height: 560, alignment: .topLeading)
        .onExitCommand { onClose() }
    }

    // MARK: 第一步：今天聽／讀了什麼

    private var startView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("今天聽／讀了什麼？")
                .font(.title3.bold())
            Text("先去聽，聽完回來說一句就好，中文英文都可以。想不起來就隨便寫個主題。")
                .font(.callout)
                .foregroundStyle(.secondary)

            if let ep = model.episode { episodeCard(ep) }

            TextField("例如：BBC 6 Minute English，戒酒一個月", text: $model.topic)
                .textFieldStyle(.roundedBorder)
                .onSubmit { model.start() }

            Text("有逐字稿或記得的重點，可以貼在這裡（選填）。用上面那集不用貼，會自動附上。")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextEditor(text: $model.topicNotes)
                .font(.callout)
                .frame(height: 60)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.secondary.opacity(0.3))
                )

            HStack {
                Spacer()
                Button("開始") { model.start() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.topic.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Spacer()
        }
    }

    private func episodeCard(_ ep: Episode) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("最新一集 · BBC 6 Minute English · 約 \(ep.minutes) 分鐘")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(ep.title).font(.headline)
            Text(ep.summary)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("▶ 打開這集（影片／逐字稿）") { NSWorkspace.shared.open(ep.pageURL) }
                Button(ep.transcript == nil ? "聽完了，用這集當主題（沒抓到逐字稿）" : "聽完了，用這集當主題") {
                    model.useEpisodeAsTopic()
                }
            }
            .controlSize(.small)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.1)))
    }

    // MARK: 第二步：一次一題

    private var questionView: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(model.topic)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                Button("換主題") { model.resetSession() }
                    .buttonStyle(.link)
                    .font(.footnote)
            }

            Text(model.question.label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(model.question.text)
                .font(.title3)
                .fixedSize(horizontal: false, vertical: true)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.question.frames, id: \.self) { frame in
                        Button(frame) { model.addFrame(frame) }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
            }

            TextEditor(text: $model.answers[model.index])
                .font(.body)
                .frame(minHeight: 120)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.secondary.opacity(0.3))
                )

            HStack {
                if model.hasNext {
                    Button("再來一題") { model.next() }
                }
                Spacer()
                Button("存起來") { model.commit(copy: false) }
                Button("存起來並開 Claude") { model.commit(copy: true) }
                    .keyboardShortcut(.defaultAction)
            }
        }
    }
}

// MARK: 紀錄

struct HistoryView: View {
    @ObservedObject var model: SessionModel

    var body: some View {
        if let entry = model.selectedEntry {
            detail(entry)
        } else {
            list
        }
    }

    private var list: some View {
        Group {
            if model.entries.isEmpty {
                VStack {
                    Text("還沒有紀錄。在「練習」寫完按「存起來」就會出現在這裡。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            } else {
                List(model.entries) { entry in
                    Button { model.selectedID = entry.id } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.topic).lineLimit(1)
                            HStack(spacing: 4) {
                                Text(entry.date.formatted(date: .abbreviated, time: .shortened))
                                if !entry.feedback.isEmpty { Text("· 已有回饋") }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func detail(_ entry: Entry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button("← 返回") { model.selectedID = nil }
                    .buttonStyle(.link)
                Spacer()
                Text(entry.date.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(entry.topic).font(.headline)
            if let link = entry.link, let url = URL(string: link) {
                Link("打開這集的頁面", destination: url).font(.caption)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(entry.items, id: \.label) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(item.label)  \(item.question)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(item.answer)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }

                    Divider()
                    Text("Claude 的回饋（貼在這裡留存，可以分次補充）")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextEditor(text: model.feedbackBinding(entry.id))
                        .font(.body)
                        .frame(minHeight: 120)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.secondary.opacity(0.3))
                        )
                }
            }

            HStack {
                Spacer()
                Button("複製並開 Claude") { model.copyForClaude(entry) }
            }
        }
    }
}


// MARK: 設定

struct SettingsView: View {
    @ObservedObject var model: SessionModel

    private var timeBinding: Binding<Date> {
        Binding(
            get: {
                Calendar.current.date(bySettingHour: model.reminderMinutes / 60,
                                      minute: model.reminderMinutes % 60,
                                      second: 0, of: Date()) ?? Date()
            },
            set: { date in
                let c = Calendar.current.dateComponents([.hour, .minute], from: date)
                model.reminderMinutes = (c.hour ?? 12) * 60 + (c.minute ?? 0)
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("每日提醒").font(.title3.bold())

            Toggle("跳系統通知提醒我", isOn: $model.reminderEnabled)
            DatePicker("提醒時間", selection: timeBinding, displayedComponents: .hourAndMinute)
                .disabled(!model.reminderEnabled)
            Toggle("週末也提醒", isOn: $model.reminderWeekends)
                .disabled(!model.reminderEnabled)

            if !model.reminderStatus.isEmpty {
                Text(model.reminderStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Button("傳一則測試通知") { model.sendTestNotification() }
                .controlSize(.small)

            Divider()

            Toggle("登入 Mac 時自動啟動", isOn: Binding(
                get: { model.launchAtLogin },
                set: { model.setLaunchAtLogin($0) }
            ))
            Text("提醒由系統負責，App 沒開著也會跳；點通知會打開練習視窗。自動啟動是為了 ⌃⌥E 隨時能用。")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()
        }
    }
}
