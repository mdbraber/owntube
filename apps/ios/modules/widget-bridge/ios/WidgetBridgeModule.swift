import ExpoModulesCore
import WidgetKit

/// Shares data with the home-screen widget (targets/widget) through the App
/// Group both are entitled to. The group's name comes from Info.plist
/// (`OwnTubeAppGroup`, written by plugins/with-widget), so nothing here
/// hard-codes it.
public class WidgetBridgeModule: Module {
  private static let queueKey = "watchQueue"

  private var defaults: UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "OwnTubeAppGroup") as? String
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    /// The web app's watch queue as its raw JSON ([{ href, title }]). Only a
    /// change reloads the widget, so repeated pushes of the same queue are free.
    Function("setWatchQueue") { (raw: String) -> Bool in
      guard let defaults = self.defaults else { return false }
      if defaults.string(forKey: Self.queueKey) == raw { return true }
      defaults.set(raw, forKey: Self.queueKey)
      WidgetCenter.shared.reloadAllTimelines()
      return true
    }
  }
}
