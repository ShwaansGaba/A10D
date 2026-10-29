# DigiLocker Aadhaar Verification Gateway

A full-stack, consent-driven Aadhaar verification site integrating the official **Sandbox.co.in DigiLocker API**.

## Features
- **Official DigiLocker Consent Flow**: Initiates session with `POST /kyc/digilocker/sessions/init` (`doc_types: ["aadhaar"]`).
- **UIDAI Offline e-KYC Retrieval**: Retrieves and parses authenticated Aadhaar XML containing demographic data, masked UID (`XXXX XXXX 6712`), address, and photo.
- **Digital Aadhaar Card UI**: Renders a high-fidelity digital Aadhaar card with hologram accents, security seals, and UIDAI branding.
- **Dual Mode (Sandbox API + Interactive Simulator)**:
  - **Sandbox API Mode**: Connects directly to `test-api.sandbox.co.in` or `api.sandbox.co.in`.
  - **Interactive Simulator**: Allows testing complete end-to-end OTP consent and verification flows even before production permissions are enabled in the Sandbox console.
- **Audit & Export**: 1-click JSON export of verified identity records for KYC compliance archives.

---

## Quick Start

### 1. Launch the Server
Double-click `start.bat` or run:
```bash
dart server.dart
```

### 2. Open in Browser
Visit [http://localhost:8080](http://localhost:8080)

---

## API Credentials Setup

Click the **Settings (Gear)** icon on the top right:
- **Test Mode**: Uses `https://test-api.sandbox.co.in`
  - Pre-configured with your test key: `key_test_76b8b507d3e94a038fc3733cea38d501`
- **Live Mode**: Uses `https://api.sandbox.co.in`
  - Pre-configured with your live key: `key_live_264a17bcafd74c6d869c9525427b091b`
  - Provide your `secret_live_...` in Settings.

### Note on "403 Insufficient privilege"
If Sandbox returns `403 Insufficient privilege`, make sure the **DigiLocker / KYC** product is activated under your workspace in the [Sandbox Console](https://developer.sandbox.co.in/). In the meantime, the **Interactive Simulator** is provided for instant testing.
