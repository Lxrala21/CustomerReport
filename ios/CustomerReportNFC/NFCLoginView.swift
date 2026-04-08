// NFCLoginView.swift
// Pantalla de login con NFC — misma estetica que login.html

import SwiftUI

struct NFCLoginView: View {
    @ObservedObject var authManager: AuthManager
    @StateObject private var nfcReader = NFCReader()
    @State private var showPulse = false
    @State private var scanState: ScanState = .idle

    enum ScanState {
        case idle, scanning, success, error
    }

    var body: some View {
        ZStack {
            Color(hex: "111318").ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Titulo
                Text("Customer Report")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.bottom, 6)

                Text("Escanea tu tarjeta de acceso")
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "9aa0a6"))
                    .padding(.bottom, 40)

                // NFC Button
                ZStack {
                    // Pulse rings (scanning)
                    if scanState == .scanning {
                        Circle()
                            .stroke(scanColor.opacity(0.3), lineWidth: 2)
                            .frame(width: 190, height: 190)
                            .scaleEffect(showPulse ? 1.15 : 0.9)
                            .opacity(showPulse ? 0 : 0.5)
                            .animation(.easeOut(duration: 2).repeatForever(autoreverses: false), value: showPulse)

                        Circle()
                            .stroke(scanColor.opacity(0.2), lineWidth: 2)
                            .frame(width: 220, height: 220)
                            .scaleEffect(showPulse ? 1.15 : 0.9)
                            .opacity(showPulse ? 0 : 0.4)
                            .animation(.easeOut(duration: 2).repeatForever(autoreverses: false).delay(0.5), value: showPulse)
                    }

                    // Main button
                    Circle()
                        .fill(scanBackground)
                        .frame(width: 160, height: 160)
                        .overlay(
                            Circle()
                                .stroke(scanBorderColor, lineWidth: 3)
                        )
                        .overlay(
                            VStack(spacing: 8) {
                                scanIcon
                                    .font(.system(size: 11, weight: .bold))
                                    .tracking(1.5)

                                Text(scanLabel)
                                    .font(.system(size: 11, weight: .bold))
                                    .tracking(1.5)
                                    .foregroundColor(scanColor)
                            }
                        )
                        .onTapGesture {
                            startScan()
                        }
                        .modifier(ShakeModifier(shake: scanState == .error))
                }
                .padding(.bottom, 24)

                // Status message
                Text(statusMessage)
                    .font(.system(size: 14))
                    .foregroundColor(scanColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .animation(.easeInOut(duration: 0.3), value: statusMessage)

                Spacer()

                // Version
                Text("v1.0 — Core NFC")
                    .font(.system(size: 10))
                    .foregroundColor(Color(hex: "3d4149"))
                    .padding(.bottom, 20)
            }
        }
        .onAppear {
            nfcReader.onUIDRead = { uid in
                handleNFCRead(uid: uid)
            }
        }
    }

    // MARK: - Actions

    private func startScan() {
        guard scanState != .scanning else { return }
        scanState = .scanning
        showPulse = true
        nfcReader.scan()

        // Si Core NFC cierra la sesion sin lectura
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            if nfcReader.error != nil && scanState == .scanning {
                scanState = .error
                showPulse = false
                resetAfterDelay()
            }
        }
    }

    private func handleNFCRead(uid: String) {
        scanState = .success
        showPulse = false

        // Haptic feedback
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)

        // Enviar al backend
        Task {
            await authManager.login(cardUID: uid)

            if authManager.errorMessage != nil {
                scanState = .error
                resetAfterDelay()
            }
            // Si login exitoso, authManager.isAuthenticated = true
            // y la app navega automaticamente al dashboard
        }
    }

    private func resetAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            if scanState == .error {
                scanState = .idle
                authManager.errorMessage = nil
            }
        }
    }

    // MARK: - UI Computed Properties

    private var scanColor: Color {
        switch scanState {
        case .idle: return Color(hex: "5f6368")
        case .scanning: return Color(hex: "8ab4f8")
        case .success: return Color(hex: "81c995")
        case .error: return Color(hex: "f28b82")
        }
    }

    private var scanBorderColor: Color {
        switch scanState {
        case .idle: return Color(hex: "2d3039")
        case .scanning: return Color(hex: "8ab4f8")
        case .success: return Color(hex: "81c995")
        case .error: return Color(hex: "f28b82")
        }
    }

    private var scanBackground: Color {
        switch scanState {
        case .idle: return Color(hex: "1a1d23")
        case .scanning: return Color(hex: "8ab4f8").opacity(0.06)
        case .success: return Color(hex: "81c995").opacity(0.08)
        case .error: return Color(hex: "f28b82").opacity(0.06)
        }
    }

    private var scanLabel: String {
        switch scanState {
        case .idle: return "ESCANEAR"
        case .scanning: return "LEYENDO..."
        case .success: return nfcReader.scannedUID ?? "LEIDO"
        case .error: return "ERROR"
        }
    }

    @ViewBuilder
    private var scanIcon: some View {
        switch scanState {
        case .success:
            Image(systemName: "checkmark")
                .font(.system(size: 48, weight: .light))
                .foregroundColor(scanColor)
        default:
            Image(systemName: "wave.3.right")
                .font(.system(size: 48, weight: .light))
                .foregroundColor(scanColor)
                .opacity(scanState == .scanning ? 1 : 0.6)
        }
    }

    private var statusMessage: String {
        if let error = authManager.errorMessage { return error }
        if let success = authManager.successMessage { return success }
        if authManager.isLoading { return "Verificando..." }

        switch scanState {
        case .idle: return "Toca el boton para leer tu tarjeta"
        case .scanning: return "Acerca tu tarjeta al iPhone"
        case .success: return "Verificando..."
        case .error: return nfcReader.error ?? "Error al leer tarjeta"
        }
    }
}

// MARK: - Shake Animation Modifier

struct ShakeModifier: ViewModifier {
    let shake: Bool
    @State private var shakeOffset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .offset(x: shakeOffset)
            .onChange(of: shake) { _, newValue in
                if newValue {
                    withAnimation(.default) {
                        shakeSequence()
                    }
                }
            }
    }

    private func shakeSequence() {
        let sequence: [(CGFloat, Double)] = [
            (-6, 0.05), (6, 0.1), (-4, 0.15), (4, 0.2), (0, 0.25)
        ]
        for (offset, delay) in sequence {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                withAnimation(.linear(duration: 0.05)) {
                    shakeOffset = offset
                }
            }
        }
    }
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = ((int >> 24) & 0xFF, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
