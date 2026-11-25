import ExpoModulesCore
import Foundation
#if os(tvOS)
import TVServices
#endif

struct WatchNextItem: Record {
  @Field var videoId: String = ""
  @Field var title: String = ""
  @Field var channelName: String?
  @Field var posterUrl: String?
  @Field var positionMs: Double = 0
  @Field var durationMs: Double = 0
}

/// Continue watching for the Apple TV Top Shelf, the counterpart of Android
/// TV's Watch Next row. Keeps the list, newest first, in the App Group shared
/// with the OwnTubeTopShelf extension (targets/top-shelf), which shows it and
/// opens `owntube://watch?v=<id>` when an item is chosen.
///
/// The group's name comes from the app's Info.plist (`OwnTubeAppGroup`, set by
/// plugins/with-top-shelf), so it follows the bundle identifier.
public class WatchNextModule: Module {
  private static let key = "continueWatching"
  private static let limit = 20

  public func definition() -> ModuleDefinition {
    Name("WatchNext")

    AsyncFunction("upsert") { (item: WatchNextItem) -> Bool in
      guard let defaults = Self.defaults() else { return false }
      var entry: [String: Any] = [
        "videoId": item.videoId,
        "title": item.title,
        "positionMs": item.positionMs,
        "durationMs": item.durationMs,
      ]
      if let channelName = item.channelName { entry["channelName"] = channelName }
      if let posterUrl = item.posterUrl { entry["posterUrl"] = posterUrl }
      let rest = Self.items(defaults).filter { $0["videoId"] as? String != item.videoId }
      defaults.set(Array(([entry] + rest).prefix(Self.limit)), forKey: Self.key)
      Self.notifyTopShelf()
      return true
    }

    AsyncFunction("remove") { (videoId: String) -> Bool in
      guard let defaults = Self.defaults() else { return false }
      let before = Self.items(defaults)
      let after = before.filter { $0["videoId"] as? String != videoId }
      guard after.count != before.count else { return false }
      defaults.set(after, forKey: Self.key)
      Self.notifyTopShelf()
      return true
    }
  }

  private static func defaults() -> UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "OwnTubeAppGroup") as? String
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  private static func items(_ defaults: UserDefaults) -> [[String: Any]] {
    defaults.array(forKey: key) as? [[String: Any]] ?? []
  }

  private static func notifyTopShelf() {
    #if os(tvOS)
    TVTopShelfContentProvider.topShelfContentDidChange()
    #endif
  }
}
