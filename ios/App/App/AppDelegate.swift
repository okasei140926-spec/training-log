import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var appleSignInBridge: AppleSignInBridge?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // スプラッシュ消去後に UIWindow の地が白/黒で見えないよう teal に設定する。
        // 戻し方: この1行を削除する。
        window?.backgroundColor = UIColor(red: 14/255, green: 158/255, blue: 136/255, alpha: 1)
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        setupAppleSignInBridgeIfNeeded()
    }

    private func setupAppleSignInBridgeIfNeeded() {
        guard appleSignInBridge == nil else { return }
        guard let capVC = window?.rootViewController as? CAPBridgeViewController,
              let webView = capVC.webView else { return }
        appleSignInBridge = AppleSignInBridge(webView: webView)
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
