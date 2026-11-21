import UIKit
import WebKit
import UniformTypeIdentifiers

/// iOS 主容器页面：全屏 Edge-to-Edge WKWebView + 状态栏联动 + 安全区注入 + 文件选择器
final class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate {
    private let services: AppServices
    private var webView: WKWebView!
    private var jsBridge: IOSJsBridge!
    private var isDarkStatusBar: Bool = false
    private var pendingFilePickCallback: (([String: Any]?) -> Void)?

    init(services: AppServices) {
        self.services = services
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return isDarkStatusBar ? .lightContent : .darkContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 246 / 255.0, green: 250 / 255.0, blue: 253 / 255.0, alpha: 1.0)
        setupWebView()
        wireNativeEvents()
        loadLocalApp()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        injectSafeAreaCssVars()
    }

    private func setupWebView() {
        let userContentController = WKUserContentController()
        jsBridge = IOSJsBridge(
            prefs: services.prefs,
            ncmClient: services.ncmClient,
            unblockEngine: services.unblockEngine,
            httpServer: services.httpServer,
            audioManager: services.audioManager,
            storageManager: services.storageManager,
            onStatusBarStyle: { [weak self] isDark in
                self?.applyStatusBarStyle(isDark: isDark)
            },
            onOpenExternalUrl: { urlStr in
                guard let url = URL(string: urlStr) else { return }
                UIApplication.shared.open(url)
            },
            onShowToast: { [weak self] msg in
                self?.showToast(msg)
            },
            onPickTextFile: { [weak self] cb in
                self?.presentFilePicker(completion: cb)
            },
            callbackDispatcher: { [weak self] callbackId, success, resultJson in
                self?.dispatchAsyncCallbackToJs(callbackId: callbackId, success: success, resultJson: resultJson)
            }
        )

        userContentController.addUserScript(jsBridge.makeInjectionScript())
        userContentController.add(jsBridge, name: "AlgerIOS")

        let config = WKWebViewConfiguration()
        config.userContentController = userContentController
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        let appVer = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "5.1.3"
        webView.customUserAgent =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) AlgerAndroid/\(appVer) AlgerIOS/\(appVer) Mobile Safari/604.1"

        view.addSubview(webView)
    }

    private func wireNativeEvents() {
        services.audioManager.eventEmitter = { [weak self] channel, payloadJson in
            self?.pushEventToJs(channel: channel, payloadJson: payloadJson)
        }
        services.onStorageEvent = { [weak self] channel, payloadJson in
            self?.pushEventToJs(channel: channel, payloadJson: payloadJson)
        }
    }

    private func loadLocalApp() {
        if !services.httpServer.isRunning {
            services.httpServer.ensureAlive()
        }
        guard services.httpServer.isRunning else {
            showToast("本地播放服务启动失败，请重启应用重试")
            return
        }
        let port = services.httpServer.port
        let ver = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "1"
        if let url = URL(string: "http://127.0.0.1:\(port)/__app/index.html?v=\(ver)") {
            var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            webView.load(req)
        }
    }

    func reloadIfBlank() {
        if webView.url == nil {
            loadLocalApp()
        }
    }

    private func applyStatusBarStyle(isDark: Bool) {
        isDarkStatusBar = isDark
        let bg = isDark
            ? UIColor(red: 15 / 255.0, green: 20 / 255.0, blue: 28 / 255.0, alpha: 1.0)
            : UIColor(red: 246 / 255.0, green: 250 / 255.0, blue: 253 / 255.0, alpha: 1.0)
        view.backgroundColor = bg
        webView.backgroundColor = bg
        webView.scrollView.backgroundColor = bg
        setNeedsStatusBarAppearanceUpdate()
    }

    private func injectSafeAreaCssVars() {
        guard webView != nil else { return }
        let top = Int(view.safeAreaInsets.top)
        let bottom = Int(view.safeAreaInsets.bottom)
        let js = """
        (function() {
          document.documentElement.style.setProperty('--safe-area-inset-top', '\(top)px');
          document.documentElement.style.setProperty('--safe-area-inset-bottom', '\(bottom)px');
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - WKNavigationDelegate & WKUIDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        injectSafeAreaCssVars()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url {
            let s = url.absoluteString
            if s.hasPrefix("http://127.0.0.1:") || s.hasPrefix("about:") {
                decisionHandler(.allow)
                return
            }
            if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        return nil
    }

    // MARK: - Native -> JS Dispatchers

    private func dispatchAsyncCallbackToJs(callbackId: String, success: Bool, resultJson: String) {
        let qId = jsQuote(callbackId)
        let qRes = jsQuote(resultJson)
        let js = "window.__algerNativeCallback && window.__algerNativeCallback(\(qId), \(success ? "true" : "false"), \(qRes));"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func pushEventToJs(channel: String, payloadJson: String) {
        let qCh = jsQuote(channel)
        let qPayload = jsQuote(payloadJson)
        let js = "window.__algerNativeEvent && window.__algerNativeEvent(\(qCh), \(qPayload));"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func jsQuote(_ str: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [str]),
              let arr = String(data: d, encoding: .utf8),
              arr.count >= 2 else { return "\"\"" }
        return String(arr.dropFirst().dropLast())
    }

    // MARK: - Document Picker (.js / .json 音源插件导入)

    private func presentFilePicker(completion: @escaping ([String: Any]?) -> Void) {
        pendingFilePickCallback = completion
        let types: [UTType] = [.plainText, .json, .javaScript, .data]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let cb = pendingFilePickCallback
        pendingFilePickCallback = nil
        guard let url = urls.first,
              let content = try? String(contentsOf: url, encoding: .utf8) else {
            cb?(nil)
            return
        }
        cb?(["name": url.lastPathComponent, "content": content])
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let cb = pendingFilePickCallback
        pendingFilePickCallback = nil
        cb?(nil)
    }

    // MARK: - Lightweight Native Toast

    private func showToast(_ text: String) {
        guard !text.isEmpty else { return }
        let label = UILabel()
        label.text = "  \(text)  "
        label.textColor = .white
        label.font = UIFont.systemFont(ofSize: 13.5, weight: .semibold)
        label.backgroundColor = UIColor(red: 17 / 255.0, green: 24 / 255.0, blue: 39 / 255.0, alpha: 0.92)
        label.textAlignment = .center
        label.numberOfLines = 2
        label.layer.cornerRadius = 18
        label.clipsToBounds = true
        label.alpha = 0
        label.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -92),
            label.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.85),
            label.heightAnchor.constraint(greaterThanOrEqualToConstant: 36)
        ])

        UIView.animate(withDuration: 0.22, animations: {
            label.alpha = 1
        }) { _ in
            UIView.animate(withDuration: 0.25, delay: 1.8, options: [], animations: {
                label.alpha = 0
            }) { _ in
                label.removeFromSuperview()
            }
        }
    }
}
