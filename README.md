# BLE Fingerprint Scanner

A **passive** Bluetooth Low Energy (BLE) advertisement scanner and analyzer. Fingerprints nearby BLE devices, tracks their advertisement patterns over time, and provides real-time RSSI monitoring with persistent history storage.

Built with React, TypeScript, Tauri, and Rust for cross-platform desktop analysis.

## What It Does

**BLE Fingerprint Scanner** captures and analyzes BLE advertisements (passive observation only, no connections or pairing). It:

- **Scans** nearby BLE devices in passive mode on Windows, Linux, and macOS
- **Fingerprints** devices using cryptographic hashing (SHA256) of manufacturer data, service UUIDs, and TX power
- **Decodes** BLE advertisement structures (flags, local names, TX power, manufacturer-specific data, service UUIDs)
- **Tracks** ghost devices (devices that go offline) and maintains persistent history
- **Analyzes** RSSI signal strength over time with real-time graphing
- **Filters** by RSSI threshold, manufacturer ID, or service UUID
- **Exports** scan results for further analysis

### What It Does NOT Do

- No device connections or pairing (purely passive)
- No active scanning, service discovery, or characteristic reads
- No spoofing, hijacking, or manipulation of device behavior
- No tracking of personal data beyond anonymized advertisement structures
- Privacy-first: all scanning is local; no cloud uploads

## Installation

### Prerequisites

- **Windows 10+** / **Linux** (with BlueZ) / **macOS 10.13+**
- **Bluetooth adapter** (built-in or USB dongle)
- **Node.js 16+** and npm
- **Rust 1.77+** (for building from source)

### From Source

```bash
# Clone the repository
git clone https://github.com/<owner>/ble-fingerprint-scanner.git
cd ble-fingerprint-scanner

# Install frontend dependencies
npm install

# Build and run with Tauri dev server
npm run tauri dev

# Or build a distributable app
npm run tauri build
```

The installer/executable will be in `src-tauri/target/release/bundle/`.

### Platform-Specific Notes

**Windows:**
- Requires Bluetooth adapter with WinBLE support
- May run best with admin privileges for adapter enumeration
- Uses the `btleplug` Bluetooth abstraction layer

**Linux:**
- Requires BlueZ and BlueZ development headers
- Install: `sudo apt-get install libbluetooth-dev` (Debian/Ubuntu)
- May require group membership: `sudo usermod -a -G bluetooth $USER`

**macOS:**
- Requires system Bluetooth permissions for app
- Will prompt for permission on first scan

## Usage

### Starting the Application

```bash
npm run tauri dev     # Development mode with hot reload
npm run tauri build   # Build production app
```

### Scanning

1. **Select Bluetooth Adapter** (defaults to first available)
2. **Adjust Filters** (Min RSSI, Manufacturer, Service UUID)
3. Click **Start Scan**
4. Watch real-time device list and RSSI graphs
5. Click device rows to inspect detailed advertisement payload
6. Stopped devices appear in **Ghost List** with last-seen timestamp

### Payload Inspector

Select a device to view:
- **Fingerprint**: SHA256 hash (MAC-independent identifier)
- **RSSI History**: Signal strength over time
- **Manufacturer Data**: Raw hex payload from manufacturers (Apple, Microsoft, Nordic, etc.)
- **Service UUIDs**: GATT services advertised
- **TX Power**: Transmitted power level
- **Advertisement Structures**: Low-level BLE AD structure breakdown
- **Protocol Hints**: Heuristics for known devices (Apple Find My, Tile, etc.)

### Exporting

Export scan results as CSV from the UI for analysis in spreadsheets or data tools.

## Architecture

```
ble-fingerprint-scanner/
├── src/                        # React frontend
│   ├── App.tsx                # Main React component
│   ├── components/            # UI components
│   └── utils/deviceIdentifier.ts  # Device type/hint database
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── main.rs            # Tauri IPC commands
│   │   ├── ble/
│   │   │   ├── scanner.rs     # BLE scanning loop
│   │   │   ├── fingerprint.rs # SHA256 fingerprinting
│   │   │   └── parser.rs      # AD structure parsing
│   │   └── db/
│   │       └── sqlite.rs      # Persistent device history
│   ├── Cargo.toml             # Rust dependencies
│   └── tauri.conf.json        # Tauri app config
├── public/data/               # Device taxonomy JSON
│   ├── manufacturer-ids.json
│   ├── service-protocol-hints.json
│   └── apple-frame-hints.json
└── package.json               # Node dependencies
```

### Key Dependencies

**Frontend:**
- React 18 - UI framework
- Tauri API - IPC to backend
- uPlot - Real-time graphing

**Backend:**
- `btleplug` - Cross-platform BLE
- `sqlx` - Async SQLite access
- `sha2` - SHA256 fingerprinting
- `serde_json` - Advertisement JSON parsing

## API / IPC Commands

All commands are Tauri IPC calls from frontend to backend:

```typescript
// Start passive BLE scan
invoke('start_scan', {
  adapter_id?: string,    // Leave empty for auto
  scan_mode: 'Passive',   // Only passive supported
  scan_backend: 'Auto'    // Auto, Btleplug, Bluer, CoreBluetooth
})

// Stop scan
invoke('stop_scan')

// List available Bluetooth adapters
invoke('list_adapters')

// Set device alias
invoke('set_device_alias', { fingerprint: string, alias: string })

// Fetch device history
invoke('get_device_history', { fingerprint: string })
```

Events emitted from backend to frontend:
- `ble:device_seen` - New/updated device advertisement
- `ble:device_lost` - Device went offline
- `ble:scan_error` - Scanning error

## Security & Privacy

- **Scanning is passive**: No connections, no pairing, no service discovery
- **Local-only**: All data stored in local SQLite; no network calls
- **No personal data collection**: Fingerprints are based on advertisement public structures, not personal identifiers
- **MAC address anonymization**: Optional MAC masking for privacy-sensitive use cases
- **Policy enforcement**: Backend enforces passive-only mode; active scanning is rejected

### GDPR & Legal Notes

When deploying this scanner in production:
- Disclose that BLE scanning occurs (in privacy policy)
- Consider GDPR/CCPA implications of tracking device fingerprints
- Implement data retention limits
- Allow users to opt-out of history logging

See [docs/SECURITY.md](docs/SECURITY.md) for detailed security architecture.

## Performance

Tested on Windows 11 with 50+ simultaneous BLE devices:
- Real-time processing: 90+ advertisements/second
- RSSI graph updates: 60 FPS with minimal UI stutter
- Memory usage: ~80 MB baseline, grows linearly with device count
- SQLite history: Compressed after 10,000 samples per device

For high-load scenarios, use RSSI filters to reduce device noise.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No Bluetooth adapters found" | Enable Bluetooth in system settings; check adapter driver |
| "Permission denied" | Run app with elevated privileges (admin on Windows, sudo on Linux) |
| "Selected adapter not found" | Adapter may have disconnected; restart app |
| High CPU/memory usage | Reduce scan RSSI range or disable history logging for old devices |
| Scan stops unexpectedly | Check Bluetooth driver stability; system sleep may interrupt scan |

## Testing

```bash
# Run frontend lint/type check
npm run build

# Run backend tests (if configured)
cd src-tauri && cargo test

# Safety check: verify no active scanning code
npm run safety:no-connect
```

## Roadmap

- [ ] Linux multi-adapter support
- [ ] Channel heatmap visualization (awaiting btleplug API)
- [ ] Passive fingerprinting of iOS devices
- [ ] BLE packet capture (PCAP export)
- [ ] Automated device classification
- [ ] REST API for third-party integrations
- [ ] Mobile app (React Native)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Setting up development environment
- Code style and testing
- BLE-specific contribution patterns
- Submitting PRs and issue reports

## License

MIT License. See [LICENSE](LICENSE) for details.

## Citation

If you use BLE Fingerprint Scanner in research or production, please cite:

```bibtex
@software{ble_fingerprint_scanner_2026,
  title = {{BLE Fingerprint Scanner}: Passive Bluetooth Advertisement Analysis Tool},
  url = {https://github.com/<owner>/ble-fingerprint-scanner},
  year = {2026},
  author = {Your Name}
}
```

## Support

- **Issues**: [GitHub Issues](https://github.com/<owner>/ble-fingerprint-scanner/issues)
- **Spec**: [Technical Specification](docs/Technical%20Specification%20&%20Implementation%20Guide%20v1.0.md)

---

**Remember:** This tool performs passive observation only. Always respect privacy laws and obtain necessary permissions before scanning in production environments.
