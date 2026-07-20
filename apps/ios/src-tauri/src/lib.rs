use tauri::{Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

const APP_GROUP: &str = "group.com.mdbraber.owntube";
const QUEUE_KEY: &str = "watchQueue";

/// Evaluated on every page load. Mirrors the web app's watch queue
/// (localStorage["ot:watch-queue"]) into native storage so the widget can read
/// it. Pushes immediately and whenever the app fires `ot:watch-queue-updated`
/// (see video-player.tsx) or a cross-tab storage event.
const QUEUE_SYNC_SCRIPT: &str = r#"
(function () {
  if (window.__otQueueSyncInstalled) { return; }
  window.__otQueueSyncInstalled = true;
  function push() {
    try {
      var raw = localStorage.getItem('ot:watch-queue') || '[]';
      var t = window.__TAURI_INTERNALS__;
      if (t && t.invoke) t.invoke('sync_watch_queue', { raw: raw });
    } catch (e) {}
  }
  window.addEventListener('ot:watch-queue-updated', push);
  window.addEventListener('storage', function (e) {
    if (!e.key || e.key === 'ot:watch-queue') push();
  });
  push();
  setTimeout(push, 1500);
})();
"#;

/// Map an incoming deep link to the OwnTube URL to load.
///
/// `origin` is whatever the main window is currently showing, so the server
/// address lives only in configuration (see `OWNTUBE_URL`) and is never
/// compiled in.
fn resolve_target(url: &Url, origin: &Url) -> Option<String> {
    match url.scheme() {
        "owntube" => {
            let host = url.host_str().unwrap_or("");
            let path = url.path();
            let combined = if host.is_empty() || Some(host) == origin.host_str() {
                path.to_string()
            } else {
                format!("/{host}{path}")
            };
            let mut target = format!("{}{combined}", origin.origin().ascii_serialization());
            if let Some(q) = url.query() {
                target.push('?');
                target.push_str(q);
            }
            Some(target)
        }
        "https" | "http" => Some(url.as_str().to_string()),
        _ => None,
    }
}

/// Receives the raw JSON queue from the web app and stores it in the App Group
/// so the widget extension can read it.
#[tauri::command]
fn sync_watch_queue(raw: String) {
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    app_group::store_queue(&raw);
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    let _ = raw;
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
mod app_group {
    use super::{APP_GROUP, QUEUE_KEY};
    use objc2::AnyThread;
    use objc2_foundation::{NSString, NSUserDefaults};

    /// Write the raw queue JSON into the shared App Group UserDefaults suite.
    pub fn store_queue(raw: &str) {
        let suite = NSString::from_str(APP_GROUP);
        let key = NSString::from_str(QUEUE_KEY);
        let val = NSString::from_str(raw);
        // Safety: standard NSUserDefaults suite write; args are valid NSStrings.
        unsafe {
            if let Some(defaults) =
                NSUserDefaults::initWithSuiteName(NSUserDefaults::alloc(), Some(&suite))
            {
                defaults.setObject_forKey(Some(&val), &key);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![sync_watch_queue])
        .on_page_load(|webview, _payload| {
            let _ = webview.eval(QUEUE_SYNC_SCRIPT);
        })
        .setup(|app| {
            // Deep links: fires for both cold-start launch URL and warm opens.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let Some(url) = event.urls().into_iter().next() else {
                    return;
                };
                let Some(win) = handle.get_webview_window("main") else {
                    return;
                };
                let Ok(origin) = win.url() else { return };
                if let Some(target) = resolve_target(&url, &origin) {
                    if let Ok(u) = target.parse::<Url>() {
                        let _ = win.navigate(u);
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
