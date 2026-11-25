import TVServices

/// The Apple TV Top Shelf: OwnTube's Continue watching row, the counterpart of
/// Android TV's Watch Next. The app keeps the list in the shared App Group
/// (modules/watch-next/ios/WatchNextModule.swift); choosing an item opens
/// `owntube://watch?v=<id>`, which resumes it from the saved position.
final class ContentProvider: TVTopShelfContentProvider {
  override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "OwnTubeAppGroup") as? String,
      let entries = UserDefaults(suiteName: group)?.array(forKey: "continueWatching")
        as? [[String: Any]]
    else {
      completionHandler(nil)
      return
    }
    let items = entries.compactMap(Self.item)
    guard !items.isEmpty else {
      completionHandler(nil)
      return
    }
    let section = TVTopShelfItemCollection(items: items)
    section.title = NSLocalizedString("Continue watching", comment: "Top Shelf row title")
    completionHandler(TVTopShelfSectionedContent(sections: [section]))
  }

  private static func item(_ entry: [String: Any]) -> TVTopShelfSectionedItem? {
    guard
      let videoId = entry["videoId"] as? String,
      var components = URLComponents(string: "owntube://watch")
    else { return nil }
    components.queryItems = [URLQueryItem(name: "v", value: videoId)]
    guard let url = components.url else { return nil }

    let item = TVTopShelfSectionedItem(identifier: videoId)
    item.title = entry["title"] as? String
    item.imageShape = .hdtv
    if let poster = (entry["posterUrl"] as? String).flatMap(URL.init(string:)) {
      item.setImageURL(poster, for: [.screenScale1x, .screenScale2x])
    }
    let position = entry["positionMs"] as? Double ?? 0
    let duration = entry["durationMs"] as? Double ?? 0
    if duration > 0 { item.playbackProgress = min(1, max(0, position / duration)) }
    item.playAction = TVTopShelfAction(url: url)
    item.displayAction = TVTopShelfAction(url: url)
    return item
  }
}
