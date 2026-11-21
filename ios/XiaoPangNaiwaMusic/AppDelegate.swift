import UIKit

/// 全局服务单例容器（对应 Android 的 AlgerApp.kt）
final class AppServices {
    static let shared = AppServices()

    let prefs: AppPrefs
    let ncmClient: NeteaseApiClient
    let unblockEngine: MusicUnblockEngine
    let httpServer: LocalHttpServer
    let audioManager: AudioPlayerManager
    private(set) var storageManager: LocalMusicAndDownloadManager!

    var onStorageEvent: ((String, String) -> Void)?

    private init() {
        self.prefs = AppPrefs()
        self.ncmClient = NeteaseApiClient(prefs: prefs)
        self.unblockEngine = MusicUnblockEngine()
        self.httpServer = LocalHttpServer(ncmClient: ncmClient, unblockEngine: unblockEngine)
        self.audioManager = AudioPlayerManager(ncmClient: ncmClient, unblockEngine: unblockEngine)
        self.storageManager = LocalMusicAndDownloadManager(
            portProvider: { [weak self] in self?.httpServer.port ?? 30488 },
            tokenProvider: { [weak self] in self?.httpServer.authToken ?? "" },
            eventEmitter: { [weak self] ch, payload in
                self?.onStorageEvent?(ch, payload)
            }
        )
    }

    func boot() {
        _ = httpServer.start(preferredPort: 30488)
        DispatchQueue.global(qos: .utility).async { [weak self] in
            self?.ncmClient.ensureAnonymousToken()
        }
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var mainVC: MainViewController?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        AppServices.shared.boot()
        application.beginReceivingRemoteControlEvents()

        let win = UIWindow(frame: UIScreen.main.bounds)
        let vc = MainViewController(services: AppServices.shared)
        win.rootViewController = vc
        win.makeKeyAndVisible()
        self.window = win
        self.mainVC = vc
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        AppServices.shared.httpServer.ensureAlive()
        AppServices.shared.audioManager.onAppForegroundChanged(true)
        mainVC?.reloadIfBlank()
    }

    func applicationWillResignActive(_ application: UIApplication) {
        AppServices.shared.audioManager.onAppForegroundChanged(false)
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        AppServices.shared.audioManager.onAppForegroundChanged(false)
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        AppServices.shared.httpServer.ensureAlive()
        AppServices.shared.audioManager.onAppForegroundChanged(true)
    }
}
