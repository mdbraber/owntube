import SwiftUI
import WidgetKit

private let appGroup = "group.com.mdbraber.owntube"
private let queueKey = "watchQueue"

struct QueueItem: Identifiable {
  let id: String   // video id
  let title: String
}

struct QueueEntry: TimelineEntry {
  let date: Date
  let items: [QueueItem]
}

/// Read the queue the app mirrored into the shared App Group.
/// Stored as the raw JSON string of [{ href: "/watch/<id>", title }].
func loadQueueItems() -> [QueueItem] {
  guard
    let defaults = UserDefaults(suiteName: appGroup),
    let raw = defaults.string(forKey: queueKey),
    let data = raw.data(using: .utf8),
    let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
  else { return [] }

  return arr.compactMap { obj in
    guard
      let href = obj["href"] as? String,
      let title = obj["title"] as? String
    else { return nil }
    let id =
      href
      .components(separatedBy: "/watch/").last?
      .components(separatedBy: "?").first ?? href
    guard !id.isEmpty else { return nil }
    return QueueItem(id: id, title: title)
  }
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> QueueEntry {
    QueueEntry(date: Date(), items: [QueueItem(id: "_", title: "Your next video")])
  }

  func getSnapshot(in context: Context, completion: @escaping (QueueEntry) -> Void) {
    completion(QueueEntry(date: Date(), items: loadQueueItems()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QueueEntry>) -> Void) {
    let entry = QueueEntry(date: Date(), items: loadQueueItems())
    let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())
      ?? Date().addingTimeInterval(1800)
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

struct OwnTubeWidgetEntryView: View {
  var entry: QueueEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Continue watching")
        .font(.caption2).bold()
        .foregroundStyle(.secondary)

      if entry.items.isEmpty {
        Spacer()
        Text("Your queue is empty")
          .font(.footnote)
          .foregroundStyle(.secondary)
        Spacer()
      } else {
        ForEach(entry.items.prefix(4)) { item in
          Link(destination: URL(string: "owntube://watch/\(item.id)")!) {
            HStack(spacing: 8) {
              Image(systemName: "play.circle.fill")
                .foregroundStyle(.pink)
              Text(item.title)
                .font(.footnote)
                .lineLimit(1)
              Spacer(minLength: 0)
            }
          }
        }
        Spacer(minLength: 0)
      }
    }
  }
}

@main
struct OwnTubeWidget: Widget {
  let kind = "OwnTubeWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      if #available(iOS 17.0, *) {
        OwnTubeWidgetEntryView(entry: entry)
          .containerBackground(.background, for: .widget)
      } else {
        OwnTubeWidgetEntryView(entry: entry)
          .padding()
      }
    }
    .configurationDisplayName("Continue Watching")
    .description("Pick up where you left off in your OwnTube queue.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}
