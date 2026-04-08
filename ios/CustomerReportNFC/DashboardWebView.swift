// DashboardWebView.swift
// Carga el dashboard web en un WKWebView despues de autenticar con NFC
// Inyecta la sesion del usuario via JavaScript para que el dashboard lo reconozca

import SwiftUI
import WebKit

struct DashboardWebView: View {
    @ObservedObject var authManager: AuthManager

    var body: some View {
        ZStack(alignment: .top) {
            WebView(
                url: AppConfig.dashboardURL,
                user: authManager.currentUser
            )
            .ignoresSafeArea(edges: .bottom)

            // Top bar con info de usuario y logout
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 14))
                        .foregroundColor(Color(hex: "81c995"))
                    Text(authManager.currentUser?.name ?? "Usuario")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white)
                    Text("(\(authManager.currentUser?.role ?? "viewer"))")
                        .font(.system(size: 10))
                        .foregroundColor(Color(hex: "9aa0a6"))
                }

                Spacer()

                Button(action: { authManager.logout() }) {
                    HStack(spacing: 4) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 11))
                        Text("Salir")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundColor(Color(hex: "f28b82"))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color(hex: "f28b82").opacity(0.1))
                    .cornerRadius(12)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color(hex: "111318").opacity(0.95))
        }
    }
}

// MARK: - WKWebView Wrapper

struct WebView: UIViewRepresentable {
    let url: String
    let user: AuthUser?

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.067, green: 0.075, blue: 0.094, alpha: 1) // #111318
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.navigationDelegate = context.coordinator

        // Cargar la pagina
        if let pageURL = URL(string: url) {
            webView.load(URLRequest(url: pageURL))
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(user: user)
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let user: AuthUser?

        init(user: AuthUser?) {
            self.user = user
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Inyectar sesion de usuario en sessionStorage
            // Esto permite que el dashboard web reconozca al usuario logueado via iOS
            guard let user = user else { return }

            let userJSON = """
            {"id":"\(user.id)","name":"\(user.name)","role":"\(user.role)"}
            """
            let js = "sessionStorage.setItem('cr_user', '\(userJSON)');"
            webView.evaluateJavaScript(js)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Interceptar redirect a login.html — ya estamos autenticados via NFC
            if let url = navigationAction.request.url?.absoluteString,
               url.contains("login.html") {
                // Re-inyectar sesion y volver al dashboard
                guard let user = user else {
                    decisionHandler(.allow)
                    return
                }
                let userJSON = """
                {"id":"\(user.id)","name":"\(user.name)","role":"\(user.role)"}
                """
                let js = "sessionStorage.setItem('cr_user', '\(userJSON)'); window.location.href = '/';"
                webView.evaluateJavaScript(js)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
