import Foundation
import UserNotifications

/// 每日提醒：用系統通知。排程交給系統，App 沒開著也會跳；點通知會把 App 叫起來。
enum Reminder {
    private static let ids = (1...7).map { "daily-\($0)" }

    static func timeText(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    /// 重新排程；done 回傳一句給使用者看的狀態
    static func schedule(enabled: Bool, minutes: Int, weekends: Bool, done: @escaping (String) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        guard enabled else { return done("提醒已關閉。") }

        center.requestAuthorization(options: [.alert]) { granted, _ in
            guard granted else {
                return done("通知沒有開：到「系統設定 → 通知 → EnglishCoach」打開。")
            }
            let content = UNMutableNotificationContent()
            content.title = "English Coach"
            content.body = "這週的 6 Minute English 聽了嗎？聽完回來寫兩句就好，沒空就略過。"

            // Calendar 的 weekday：1 = 週日、2 = 週一 … 7 = 週六
            let days = weekends ? Array(1...7) : Array(2...6)
            for day in days {
                var when = DateComponents()
                when.weekday = day
                when.hour = minutes / 60
                when.minute = minutes % 60
                let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: true)
                center.add(UNNotificationRequest(identifier: "daily-\(day)", content: content, trigger: trigger))
            }
            done("會在\(weekends ? "每天" : "週一到週五") \(timeText(minutes)) 跳通知。")
        }
    }

    static func sendTest(done: @escaping (String) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert]) { granted, _ in
            guard granted else {
                return done("通知沒有開：到「系統設定 → 通知 → EnglishCoach」打開。")
            }
            let content = UNMutableNotificationContent()
            content.title = "English Coach"
            content.body = "這是測試通知，點一下會打開練習視窗。"
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            center.add(UNNotificationRequest(identifier: "test", content: content, trigger: trigger))
            done("已送出測試通知。")
        }
    }
}
