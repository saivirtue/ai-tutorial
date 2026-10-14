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
}
