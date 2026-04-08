// Config.swift
// Configuracion del servidor backend

import Foundation

enum AppConfig {
    // MARK: - Cambiar estas URLs segun tu entorno

    /// URL del servidor local (desarrollo)
    static let localURL = "http://192.168.80.103:3600"

    /// URL de Vercel (produccion)
    static let vercelURL = "https://customer-report.vercel.app"

    /// URL activa — cambiar entre localURL y vercelURL
    static let baseURL = localURL

    /// Endpoints
    static let loginEndpoint = "\(baseURL)/api/auth/login"
    static let dashboardURL = baseURL
}
