import ActivityKit
import Capacitor
import Foundation

@objc(RestTimerPlugin)
public class RestTimerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestTimerPlugin"
    public let jsName = "RestTimer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    @objc public func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["displayed": false])
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["displayed": false])
            return
        }

        let seconds = max(1, call.getDouble("seconds", 0))
        let startedAt = Date()
        let state = RestTimerAttributes.ContentState(
            startedAt: startedAt,
            endsAt: startedAt.addingTimeInterval(seconds)
        )

        Task {
            await endAll(state: state)
            do {
                let attributes = RestTimerAttributes(title: "组间休息")
                if #available(iOS 16.2, *) {
                    let content = ActivityContent(state: state, staleDate: state.endsAt)
                    _ = try Activity.request(attributes: attributes, content: content, pushType: nil)
                } else {
                    _ = try Activity.request(attributes: attributes, contentState: state, pushType: nil)
                }
                call.resolve(["displayed": true])
            } catch {
                call.resolve(["displayed": false])
            }
        }
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve()
            return
        }
        let now = Date()
        let state = RestTimerAttributes.ContentState(startedAt: now, endsAt: now)
        Task {
            await endAll(state: state)
            call.resolve()
        }
    }

    @available(iOS 16.1, *)
    private func endAll(state: RestTimerAttributes.ContentState) async {
        for activity in Activity<RestTimerAttributes>.activities {
            if #available(iOS 16.2, *) {
                await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .immediate)
            } else {
                await activity.end(using: state, dismissalPolicy: .immediate)
            }
        }
    }
}
