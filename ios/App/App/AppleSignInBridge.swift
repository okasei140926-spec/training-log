import WebKit
import AuthenticationServices
import Foundation

/// WKScriptMessageHandler-based Apple Sign In bridge.
/// JS calls: window.webkit.messageHandlers.appleSignIn.postMessage({ nonce: "<sha256-nonce>" })
/// Result:   window.dispatchEvent(new CustomEvent('appleSignInResult', { detail: {...} }))
class AppleSignInBridge: NSObject {
    private let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        webView.configuration.userContentController.add(self, name: "appleSignIn")
    }

    private func dispatchResult(_ detail: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "window.dispatchEvent(new CustomEvent('appleSignInResult', { detail: \(json) }));"
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}

// MARK: - WKScriptMessageHandler
extension AppleSignInBridge: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "appleSignIn",
              let body = message.body as? [String: String],
              let nonce = body["nonce"] else { return }

        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonce

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }
}

// MARK: - ASAuthorizationControllerDelegate
extension AppleSignInBridge: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            dispatchResult(["error": "Failed to get identity token"])
            return
        }
        var detail: [String: Any] = ["identityToken": identityToken, "user": cred.user]
        if let email = cred.email { detail["email"] = email }
        if let given = cred.fullName?.givenName { detail["givenName"] = given }
        if let family = cred.fullName?.familyName { detail["familyName"] = family }
        dispatchResult(detail)
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithError error: Error) {
        let nsErr = error as NSError
        // code 1001 = user cancelled
        let msg = nsErr.code == 1001 ? "cancelled" : error.localizedDescription
        dispatchResult(["error": msg])
    }
}

// MARK: - ASAuthorizationControllerPresentationContextProviding
extension AppleSignInBridge: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // On iPad, UIWindow() (a new empty window) has no scene and will fail.
        // Always resolve to the app's foreground key window.
        if let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
           let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
            return keyWindow
        }
        return webView.window ?? UIApplication.shared.windows.first ?? UIWindow()
    }
}
