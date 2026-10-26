import Foundation

struct Item: Codable {
    var label: String     // 例如「① 說重點」
    var question: String
    var answer: String
}

struct Entry: Codable, Identifiable {
    var id: UUID
    var date: Date
    var topic: String
    var items: [Item]
    var feedback: String  // 貼回來的 Claude 回饋，可多次補充
    var link: String? = nil  // 這集的集數頁面，舊紀錄沒有
    var transcript: String? = nil  // 逐字稿或自己貼的重點，複製給 Claude 時一起帶上
}
