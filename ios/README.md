# CustomerReport NFC - iOS App

App nativa iOS con Core NFC para login via tarjeta NFC al dashboard de Customer Report.

## Requisitos
- Xcode 15+
- iOS 16+
- iPhone 7 o superior (NFC hardware)
- Apple Developer Account (para entitlement NFC)

## Setup en Xcode

1. **Abrir Xcode** → File → New → Project → iOS App
2. Product Name: `CustomerReportNFC`
3. Interface: **SwiftUI** | Language: **Swift**
4. Copiar los archivos `.swift` de esta carpeta al proyecto
5. Copiar `Info.plist` y `CustomerReportNFC.entitlements`

### Configurar Capabilities
1. Click en el target → **Signing & Capabilities**
2. Click **+ Capability**
3. Agregar **Near Field Communication Tag Reading**
4. Asegurar que el entitlement `com.apple.developer.nfc.readersession.formats` incluya `TAG`

### Configurar URL del servidor
Editar `Config.swift`:
```swift
static let baseURL = "http://TU-IP:3600"  // desarrollo local
// o
static let baseURL = "https://tu-app.vercel.app"  // produccion
```

## Archivos

| Archivo | Descripcion |
|---------|-------------|
| `CustomerReportNFCApp.swift` | Entry point — navega entre login y dashboard |
| `Config.swift` | URLs del backend |
| `AuthManager.swift` | Estado de auth, login/logout, persistencia |
| `NFCReader.swift` | Core NFC — lee UID de tarjetas (MIFARE, ISO7816, ISO15693, FeliCa) |
| `NFCLoginView.swift` | UI de login (misma estetica que login.html) |
| `DashboardWebView.swift` | WKWebView que carga el dashboard e inyecta sesion |
| `Info.plist` | Permisos NFC + config |
| `CustomerReportNFC.entitlements` | Entitlement NFC Tag Reading |

## Flujo

```
App iOS abre
    ↓
¿Sesion guardada en UserDefaults?
    ├─ SI → DashboardWebView (WKWebView + dashboard web)
    └─ NO → NFCLoginView
              ↓
        Usuario toca "ESCANEAR"
              ↓
        Core NFC abre sesion de lectura
              ↓
        Detecta tarjeta → extrae UID (XX:XX:XX:XX)
              ↓
        POST /api/auth/login { cardUID: "XX:XX:XX:XX" }
              ↓
        Backend valida en MongoDB
              ↓
        ✓ → Guarda sesion + abre WKWebView
              (inyecta sessionStorage para que el web dashboard reconozca al usuario)
        ✗ → Muestra error "Tarjeta no registrada"
```

## Notas
- La app usa el **mismo backend** que la version web (Node.js + MongoDB)
- El UID se formatea como `XX:XX:XX:XX` para coincidir con Web NFC `serialNumber`
- Soporta: MIFARE (mas comun), ISO 7816, ISO 15693, FeliCa
- La sesion se persiste en UserDefaults (sobrevive cierres de app)
- El WKWebView inyecta `sessionStorage.cr_user` para que el auth guard del dashboard no redirija a login
