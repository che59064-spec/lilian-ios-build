import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct RestTimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let startedAt: Date
        let endsAt: Date
    }

    let title: String
}
