import SwiftUI

struct CoachView: View {
    @ObservedObject var model: SessionModel
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.started { questionView } else { startView }

            if !model.notice.isEmpty {
                Text(model.notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .frame(width: 480, height: 440, alignment: .topLeading)
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
                Button("存起來") { model.save() }
                Button("複製並開 Claude") { model.copyForClaude() }
                    .keyboardShortcut(.defaultAction)
            }
        }
    }
}
