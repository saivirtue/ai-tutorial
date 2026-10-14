import Foundation

struct Question: Identifiable {
    let id: Int
    let label: String        // 中文提示
    let text: String         // 英文題目（多看多讀）
    let frames: [String]     // 卡住時可以點的開頭句
}

enum Content {
    // 來自 daily-prompt.md 的三題結構：複述 / 表態 / 搬到自己身上
    static let questions: [Question] = [
        Question(
            id: 0,
            label: "① 說重點",
            text: "What was it about? Say it in two or three sentences.",
            frames: ["It was about…", "The main point was…", "One thing that stood out to me was…"]
        ),
        Question(
            id: 1,
            label: "② 說看法",
            text: "Pick one idea from it. Do you agree or disagree? Give one reason.",
            frames: ["I kind of agree, because…", "I'm not sure about that, because…", "That makes sense to me, since…"]
        ),
        Question(
            id: 2,
            label: "③ 放到自己身上",
            text: "Could this happen in your work or your life? How?",
            frames: ["This reminds me of…", "At work, something similar is…", "I can see this happening when…"]
        )
    ]
}
