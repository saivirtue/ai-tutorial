import SwiftUI

struct CoachView: View {
    @ObservedObject var model: SessionModel
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("", selection: $model.tab) {
                Text("練習").tag(SessionModel.Tab.practice)
                Text("紀錄（\(model.entries.count)）").tag(SessionModel.Tab.history)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            switch model.tab {
            case .practice:
                if model.started { questionView } else { startView }
            case .history:
                HistoryView(model: model)
            }

            if !model.notice.isEmpty {
                Text(model.notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .frame(width: 480, height: 500, alignment: .topLeading)
        .onExitCommand { onClose() }
    }

    // MARK: 第一步：今天聽／讀了什麼

    private var startView: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("今天聽／讀了什麼？")
                .font(.title3.bold())
            Text("一句話就好，中文英文都可以。想不起來就隨便寫個主題。")
                .font(.callout)
                .foregroundStyle(.secondary)
            TextField("例如：BBC 6 Minute English，戒酒一個月", text: $model.topic)
                .textFieldStyle(.roundedBorder)
                .onSubmit { model.start() }
            HStack {
                Spacer()
                Button("開始") { model.start() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.topic.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Spacer()
        }
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
