import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RestTimerWidgetBundle: WidgetBundle {
    var body: some Widget {
        RestTimerLiveActivity()
    }
}

struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            HStack(spacing: 14) {
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.title2)
                    .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.42))
                VStack(alignment: .leading, spacing: 3) {
                    Text(context.attributes.title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(timerInterval: context.state.startedAt...context.state.endsAt, countsDown: true, showsHours: false)
                        .font(.system(.title, design: .rounded, weight: .bold))
                        .monospacedDigit()
                }
                Spacer()
                Text("结束后\n开始下一组")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
            .padding(.horizontal)
            .activityBackgroundTint(Color(red: 0.06, green: 0.10, blue: 0.07))
            .activitySystemActionForegroundColor(.white)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("组间休息剩余时间")
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("休息", systemImage: "figure.strengthtraining.traditional")
                        .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.42))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    timer(context)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("倒计时结束后开始下一组")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                Image(systemName: "figure.strengthtraining.traditional")
                    .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.42))
            } compactTrailing: {
                timer(context)
                    .frame(width: 48)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(Color(red: 0.72, green: 0.95, blue: 0.42))
            }
            .keylineTint(Color(red: 0.72, green: 0.95, blue: 0.42))
        }
    }

    private func timer(_ context: ActivityViewContext<RestTimerAttributes>) -> some View {
        Text(timerInterval: context.state.startedAt...context.state.endsAt, countsDown: true, showsHours: false)
            .font(.system(.body, design: .rounded, weight: .bold))
            .monospacedDigit()
            .accessibilityLabel("剩余休息时间")
    }
}
