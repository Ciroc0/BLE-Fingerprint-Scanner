# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in BLE Fingerprint Scanner, please do NOT open a public GitHub issue. Instead, contact the maintainers through your repository security contact channel and include:

- Description of the vulnerability
- Steps to reproduce (if possible)
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and work with you to develop a fix.

## Security Architecture

### Design Principles

BLE Fingerprint Scanner is designed with the following security-first principles:

1. **Passive-Only Observation**: All scanning is passive. The application never connects to, pairs with, or controls BLE devices.
2. **Local-First Data**: All data is stored locally in SQLite. No cloud uploads or remote transmissions.
3. **No Personal Data Capture**: The application fingerprints advertisement structures (public broadcast data), not personal identifiers.
4. **Policy Enforcement**: Backend enforces passive-only mode via compile-time checks and runtime validation.

### What the Application Does

- Captures BLE advertisements (passive observation)
- Parses standard AD structure fields (flags, local names, TX power, manufacturer data, service UUIDs)
- Fingerprints devices using SHA256 hashing (MAC-independent)
- Stores history locally in SQLite
- Emits RSSI measurements and metadata

### What the Application Does NOT Do

- **No connections**: Never calls `connect()`, `pair()`, or `discover_services()`
- **No spoofing**: Never transmits BLE frames or manipulates device behavior
- **No data sharing**: Never uploads scan results to remote servers
- **No MAC tracking**: MAC addresses are ephemeral; fingerprints are derived from stable advertisement patterns
- **No personal identification**: Fingerprints do not link to user identity (unless manufacturer implements that in advertisement data)

### Policy Enforcement

**Backend**: The Rust backend (`src-tauri/src/main.rs`) rejects active scanning:

```rust
if matches!(scan_mode, ScanMode::Active) {
    return Err("Active scanning is disabled by policy...".to_string());
}
```

**CI**: The safety check script (`scripts/no-connect-guard.mjs`) scans code for forbidden Bluetooth APIs:
- `connect()`
- `pair()`
- `discover_services()`
- `read_characteristic()`
- `write_characteristic()`

If any forbidden API is detected, CI fails and the PR is blocked.

## Privacy Considerations

### What Data is Collected?

- **Advertisement Payloads**: Raw BLE advertisement data (same data any Bluetooth scanner can observe)
- **RSSI Measurements**: Signal strength at receive time (ephemeral)
- **Timestamps**: When devices were seen (stored locally)
- **User Aliases**: Custom names for devices (local storage only)

### What Data is NOT Collected?

- MAC addresses are NOT persisted by policy (fingerprints are MAC-independent)
- Personal device information (iOS device model, contact info, etc.)
- Location history (though RSSI can infer proximity)
- Network credentials or Bluetooth passwords

### GDPR & Privacy Compliance

When deploying BLE Fingerprint Scanner in production:

1. **Disclose Scanning**: Update your privacy policy to state that BLE scanning occurs
2. **Obtain Consent**: In jurisdictions requiring it (GDPR, CCPA), obtain user consent before scanning
3. **Data Retention**: Implement automatic deletion of old scan history (off by default; user can configure)
4. **Data Access**: Users can export all stored data via the export function
5. **Right to Deletion**: Users can clear all stored history in-app

Example privacy policy snippet:

> "BLE Fingerprint Scanner locally captures Bluetooth Low Energy advertisements in passive mode. This data is not shared with third parties and is stored only on your device. Scanning does not connect to or pair with any devices."

## Known Limitations

- **MAC Address Spoofing**: Devices can randomize MAC addresses; fingerprinting partially mitigates this but is not foolproof
- **Advertisement Timing**: Devices can vary advertisement frequency; RSSI measurements may not represent true signal strength
- **Platform Differences**: BLE behavior varies by OS (Windows WinBLE, Linux BlueZ, macOS native Bluetooth)
- **Interference**: Physical obstacles, distance, and channel congestion affect scan reliability

## Testing & Verification

### Security Tests

Run the safety check locally before committing:

```bash
npm run safety:no-connect
```

This verifies no forbidden Bluetooth APIs are used in code.

### Fuzzing

To test advertisement parser robustness:

```bash
cd src-tauri
cargo fuzz run fuzzer_target
```

(Requires `cargo-fuzz` setup)

## Dependencies

### Supply Chain Security

BLE Fingerprint Scanner uses vetted, widely-used dependencies:

| Crate | Purpose | Status |
|-------|---------|--------|
| `btleplug` | Cross-platform BLE | Well-maintained, 500k+ downloads |
| `tauri` | Desktop framework | Production-ready, widely used |
| `sqlx` | Async database | Actively maintained |
| `serde` | Serialization | Ecosystem standard |
| `tokio` | Async runtime | Industry standard |

All dependencies are pinned in `Cargo.lock` to prevent unexpected updates.

### Vulnerability Scanning

Run periodic dependency audits:

```bash
cargo audit
npm audit
```

## Incident Response

If a security issue is discovered:

1. Acknowledge receipt within 48 hours
2. Develop a fix in private (protected branch)
3. Coordinate disclosure with discoverer
4. Release patched version (0.1.x bump for security fixes)
5. Announce issue and credit discoverer

## Security Update Policy

- **Critical**: Released immediately as 0.x.1 patch
- **High**: Released within 1 week
- **Medium**: Released in next scheduled release (monthly)
- **Low**: Released with other improvements

## Questions?

Contact: repository security contact (configure in GitHub Security tab)

---

**This is a research/educational project. Use responsibly.**
