// AuthManager.swift
// Maneja estado de autenticacion y comunicacion con el backend

import Foundation
import Combine

struct AuthUser: Codable {
    let id: String
    let name: String
    let role: String
}

struct LoginResponse: Codable {
    let ok: Bool
    let user: AuthUser?
    let error: String?
}

@MainActor
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: AuthUser?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var successMessage: String?

    init() {
        // Restaurar sesion guardada
        if let data = UserDefaults.standard.data(forKey: "cr_user"),
           let user = try? JSONDecoder().decode(AuthUser.self, from: data) {
            self.currentUser = user
            self.isAuthenticated = true
        }
    }

    /// Autenticar con UID de tarjeta NFC
    func login(cardUID: String) async {
        isLoading = true
        errorMessage = nil
        successMessage = nil

        let normalized = cardUID.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()

        guard let url = URL(string: AppConfig.loginEndpoint) else {
            errorMessage = "URL invalida"
            isLoading = false
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        let body = ["cardUID": normalized]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                errorMessage = "Respuesta invalida del servidor"
                isLoading = false
                return
            }

            let loginResponse = try JSONDecoder().decode(LoginResponse.self, from: data)

            if httpResponse.statusCode == 200, loginResponse.ok, let user = loginResponse.user {
                // Login exitoso
                self.currentUser = user
                self.isAuthenticated = true
                self.successMessage = "Bienvenido, \(user.name)"

                // Guardar sesion
                if let encoded = try? JSONEncoder().encode(user) {
                    UserDefaults.standard.set(encoded, forKey: "cr_user")
                }
            } else {
                errorMessage = loginResponse.error ?? "Tarjeta no registrada"
            }
        } catch {
            errorMessage = "Error de conexion: \(error.localizedDescription)"
        }

        isLoading = false
    }

    /// Cerrar sesion
    func logout() {
        currentUser = nil
        isAuthenticated = false
        successMessage = nil
        errorMessage = nil
        UserDefaults.standard.removeObject(forKey: "cr_user")
    }
}
