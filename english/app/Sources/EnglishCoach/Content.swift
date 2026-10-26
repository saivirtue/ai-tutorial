import Foundation

struct Question: Identifiable {
    let id: Int
    let label: String        // 中文提示
    let text: String         // 英文題目（多看多讀）
    let frames: [String]     // 卡住時可以點的開頭句
}

enum Content {
    /// 隨「複製並開 Claude」一起送出，所以在任何對話、沒有 Project 也能用。
    /// 這是 ../../daily-prompt.md 裡「我回答後，你怎麼給回饋」的精簡版；改規則時兩邊要一起改。
    static let coachRules = """
【教練規則】你是我的英文口說教練。我是台灣的上班族，說與寫比聽與讀弱，對開口沒有信心。下面是我今天聽的內容和我寫的回答，請給回饋：
- 先說我做對的具體地方（不是籠統的「很好」），再談要改的。句子能被理解就是成功，母語者也會這樣講的就保留，不要為了完美而改。
- 語氣像朋友，不像考官。不要說「錯誤」「不正確」，改說「更常聽到的說法是」。不要嫌我寫得短，先接住。
- 只看句子順不順、像不像真人會講。我的回答是我確認過、原本想說的話，不要懷疑我是不是寫錯字，也不要評論發音。
- 格式：每題一小段。已經自然的句子用「✅」一句帶過；要改的用「🔧 我寫的 → 更自然的說法」，後面用一句話說明原因。目標是更順口，不是更高級。一次最多改 3 處。
- 如果我的重點和內容有落差，友善地告訴我漏掉的主軸，不要說我「偏了」或「錯了」。
- 最後給 1～2 個今天可以帶走、能套用到別的情境的整句句型。
- 不要編造：如果沒有附內容、你又不確定這集講什麼，直接說你沒有，請我貼 3 個重點，不要猜。
- 不要再出題，直接給回饋。
"""

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
