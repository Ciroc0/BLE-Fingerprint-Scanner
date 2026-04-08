# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Multi-adapter passive scanning in auto mode
- Real-time performance monitoring (events/sec, frame time metrics)
- UI freeze detection in header
- Automatic console logging when 50+ devices detected
- Protocol hints for Apple Find My, Nearby, and Continuity devices
- AD structure metadata breakdown (count, byte-level details)
- Filter preferences persistence across sessions (localStorage)
- Device aliasing functionality
- Payload history tracking with timestamp and change detection
- Quality scoring for device advertisement stability
- Export functionality for scan results

### Changed
- Active scanning disabled by policy; only passive mode available
- Backend enforces passive-only mode consistently
- Improved error messages for common BLE failures
- RSSI filtering now applies on the frontend for responsiveness

### Fixed
- Permission denied errors on Windows with elevated privilege check
- Adapter removal crashes by proper resource cleanup
- UI tooltips on all payload inspector fields

### Security
- Safety guard script added to block connect/pair/discover-services API usage
- CI workflow enforces passive-only policy validation
- Security documentation clarified in scanner code

## [0.1.0] - 2026-04-08

### Added
- Initial MVP release
- Passive BLE advertisement scanning
- Device fingerprinting via SHA256 hash
- RSSI history tracking and graphing
- BLE advertisement structure parsing
- SQLite persistent device history
- Multi-adapter support (Windows, Linux, macOS)
- Device aliasing and ghost device tracking
- Manufacturer and service UUID filtering
- Real-time device list with payload inspector
- Export to CSV
- Tauri desktop app with React frontend
- TypeScript types for all BLE structures
- Cross-platform build support

### Documentation
- Specification compliance report
- Technical implementation guide
- Safety and security documentation

---

## Migration Guide

### From Ghost Hunter Preview to 0.1.0

If you used pre-release versions:

1. **Database Migration**: Old fingerprints from earlier builds remain compatible. On first run with 0.1.0, history will be preserved.
2. **Config Path**: Database is stored in system config directory (Windows: %APPDATA%/ghost-hunter, Linux: ~/.config/ghost-hunter)
3. **API Changes**: No breaking changes to IPC commands in this release.

---

## Planned Features (Not Yet Implemented)

- **Channel Heatmap** (awaiting btleplug API support for 37/38/39 channel info)
- **Bluer Backend** (Linux-specific optimizations)
- **CoreBluetooth Backend** (macOS-specific optimizations)
- **Alternative BLE Libraries** (libusb for raw packet capture)
- **BLE Packet Capture** (PCAP export)
- **REST API** (third-party integrations)
- **Mobile App** (React Native)
- **Device Fingerprint Database** (community crowdsourced fingerprints)

---

## Known Issues

- **Windows**: Adapter enumeration may require elevated privileges
- **Linux**: BlueZ version compatibility varies; tested on 5.60+
- **macOS**: Scanning may pause during system sleep
- **All Platforms**: Devices broadcasting on non-standard channels not detected (btleplug limitation)

---

For more details, see the [Technical Specification](docs/Technical%20Specification%20&%20Implementation%20Guide%20v1.0.md).
