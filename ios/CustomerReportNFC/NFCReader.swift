// NFCReader.swift
// Core NFC - Lee el UID de tarjetas NFC en iOS

import CoreNFC

class NFCReader: NSObject, ObservableObject, NFCTagReaderSessionDelegate {
    @Published var scannedUID: String?
    @Published var isScanning = false
    @Published var error: String?

    private var session: NFCTagReaderSession?
    var onUIDRead: ((String) -> Void)?

    /// Iniciar escaneo NFC
    func scan() {
        guard NFCTagReaderSession.readingAvailable else {
            error = "NFC no disponible en este dispositivo"
            return
        }

        session = NFCTagReaderSession(
            pollingOption: [.iso14443, .iso15693],
            delegate: self,
            queue: nil
        )
        session?.alertMessage = "Acerca tu tarjeta de acceso al iPhone"
        session?.begin()
        isScanning = true
        error = nil
    }

    // MARK: - NFCTagReaderSessionDelegate

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {
        // Sesion activa, esperando tarjeta
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        DispatchQueue.main.async {
            self.isScanning = false
            // No mostrar error si el usuario cancelo manualmente
            if (error as NSError).code != NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue {
                self.error = error.localizedDescription
            }
        }
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let tag = tags.first else {
            session.invalidate(errorMessage: "No se detecto tarjeta")
            return
        }

        session.connect(to: tag) { [weak self] connectionError in
            if let connectionError = connectionError {
                session.invalidate(errorMessage: "Error de conexion: \(connectionError.localizedDescription)")
                return
            }

            var uid: Data?

            switch tag {
            case .miFare(let mifareTag):
                // Tarjetas MIFARE (NFC-A / ISO 14443-3A) — las mas comunes
                uid = mifareTag.identifier

            case .iso7816(let iso7816Tag):
                // Tarjetas ISO 7816 (contactless smart cards)
                uid = iso7816Tag.identifier

            case .iso15693(let iso15693Tag):
                // Tarjetas ISO 15693 (NFC-V)
                uid = iso15693Tag.identifier

            case .feliCa(let feliCaTag):
                // Tarjetas FeliCa (Sony, comun en Japon)
                uid = feliCaTag.currentIDm

            @unknown default:
                session.invalidate(errorMessage: "Tipo de tarjeta no soportado")
                return
            }

            guard let uidData = uid else {
                session.invalidate(errorMessage: "No se pudo leer el UID")
                return
            }

            // Convertir bytes a formato XX:XX:XX:XX (mismo formato que Web NFC serialNumber)
            let uidString = uidData.map { String(format: "%02X", $0) }.joined(separator: ":")

            DispatchQueue.main.async {
                self?.scannedUID = uidString
                self?.isScanning = false
                self?.onUIDRead?(uidString)
            }

            session.alertMessage = "Tarjeta leida: \(uidString)"
            session.invalidate()
        }
    }
}
