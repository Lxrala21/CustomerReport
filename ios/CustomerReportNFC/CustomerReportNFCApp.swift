// CustomerReportNFCApp.swift
// Customer Report - iOS NFC Login
// Conecta con el backend existente via POST /api/auth/login

import SwiftUI

@main
struct CustomerReportNFCApp: App {
    @StateObject private var authManager = AuthManager()

    var body: some Scene {
        WindowGroup {
            if authManager.isAuthenticated {
                DashboardWebView(authManager: authManager)
            } else {
                NFCLoginView(authManager: authManager)
            }
        }
    }
}
