# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────┐
│  BLE Fingerprint Scanner - Architecture         │
└─────────────────────────────────────────────────┘

Front-end (React + TypeScript)              Back-end (Rust + Tauri)
┌─────────────────────────────┐            ┌──────────────────────────┐
│  App.tsx (React)            │            │  main.rs (Tauri)         │
│  - Device list view         │            │  - IPC command handlers  │
│  - RSSI graph               │◄──────────►│  - App state management  │
│  - Payload inspector        │   Tauri    │                          │
│  - Filter UI                │   IPC      │  scanner.rs              │
└─────────────────────────────┘            │  - BLE scan loop         │
         │                                 │  - Event emitter         │
         │                                 │                          │
         │                                 │  parser.rs               │
         │                                 │  - AD structure parsing  │
         │                                 │                          │
         │                                 │  fingerprint.rs          │
         │                                 │  - SHA256 hashing        │
         └──────────────────┬──────────────┤                          │
                            │              │  BLE Hardware            │
                            └──────────────►───────────────────────┐
                                           │  btleplug (abstracted) │
                                           └────────────────────────┘
                                                    │
                                                    ▼
                                           Physical BLE Adapter
                                           (Windows/Linux/macOS)
```

## Component Details

### Frontend

**Location**: `src/`

```
src/
├── App.tsx                    # Main React component
│   ├── Device list rendering
│   ├── RSSI graph (uPlot)
│   ├── Filter state management
│   └── IPC event listeners
├── components/                # UI components
├── utils/
│   └── deviceIdentifier.ts   # Device type detection
└── index.css                 # Styling (Tailwind)
```

**Technologies**:
- React 18: Component framework
- TypeScript: Type safety
- Tauri API: IPC communication
- uPlot: Real-time graphing
- Tailwind: Styling

**Key Responsibilities**:
- Render real-time device list
- Manage UI state (selected device, filters, scanning status)
- Plot RSSI history
- Display advertisement payload details
- Handle user interactions (start/stop scan, export)

### Backend

**Location**: `src-tauri/src/`

```
src-tauri/src/
├── main.rs                    # Tauri app setup + IPC commands
├── models.rs                  # Domain types
├── ble/
│   ├── mod.rs                # Module exports
│   ├── scanner.rs            # BLE scan loop + async handling
│   ├── parser.rs             # BLE AD structure parsing
│   └── fingerprint.rs        # SHA256 fingerprinting
└── db/
    ├── mod.rs
    └── sqlite.rs             # Persistent storage
```

**Technologies**:
- Tauri: Desktop framework + IPC bridge
- btleplug: Cross-platform BLE abstraction
- tokio: Async runtime
- sqlx: Async SQLite driver
- serde: JSON serialization
- sha2: Cryptographic hashing

**Key Responsibilities**:
- Manage Bluetooth adapters and scanning
- Parse incoming BLE advertisements
- Generate device fingerprints
- Persist data to SQLite
- Emit events to frontend

## Data Flow

### Scanning Lifecycle

```
User clicks "Start Scan"
        │
        ▼
Frontend: invoke('start_scan', options)
        │
        ▼
Backend: main.rs::start_scan()
        │
        ├─► Validate options (passive-only policy enforced)
        │
        ├─► Initialize BLE adapters via btleplug
        │
        ├─► Spawn scanner.rs::spawn() async task
        │
        ├─► scanner.rs listens on adapter
        │
        └─► For each BLE advertisement event:
                │
                ├─► parser.rs::parse_advertisement() → ParsedAdData
                │
                ├─► fingerprint.rs::fingerprint_device() → SHA256 hash
                │
                ├─► db::sqlite::upsert_device() → store/update SQLite
                │
                └─► emit ble:device_seen event to frontend
```

### Advertisement Parsing

```
Raw BLE Bytes (input)
        │
        ▼
parser.rs::parse_advertisement()
        │
        ├─► Extract AD structures at byte level
        │       └─► Type 0x01: flags
        │       └─► Type 0x09: local name
        │       └─► Type 0x0A: TX power
        │       └─► Type 0xFF: manufacturer data
        │       └─► ...others
        │
        └─► Return ParsedAdData {
                flags: u8,
                local_name: String,
                tx_power: i16,
                manufacturer_data: HashMap<u16, Vec<u8>>,
                service_uuids: Vec<String>,
                ...
            }
```

### Fingerprinting

```
ParsedAdData (input)
        │
        ▼
fingerprint.rs::fingerprint_device()
        │
        ├─► Hash manufacturer_data entries (sorted by company ID)
        │
        ├─► Hash service_uuids (sorted alphabetically)
        │
        ├─► Hash tx_power (if present)
        │
        └─► Return SHA256(all) → hex string (invariant to MAC address)
```

### Database Schema (SQLite)

```sql
CREATE TABLE devices (
    fingerprint TEXT PRIMARY KEY,
    first_seen INTEGER,
    last_seen INTEGER,
    seen_count INTEGER,
    alias TEXT,
    raw_hex TEXT
);

CREATE TABLE rssi_history (
    fingerprint TEXT,
    timestamp INTEGER,
    rssi INTEGER,
    FOREIGN KEY (fingerprint) REFERENCES devices(fingerprint)
);

CREATE TABLE payload_history (
    fingerprint TEXT,
    timestamp INTEGER,
    raw_hex TEXT,
    FOREIGN KEY (fingerprint) REFERENCES devices(fingerprint)
);
```

## IPC API

Communication between frontend and backend occurs via Tauri's IPC bridge.

### Commands (Frontend → Backend)

```typescript
// Start passive BLE scanning
invoke('start_scan', {
  adapter_id?: string,      // Leave empty for auto-select
  scan_mode?: 'Passive',    // Only 'Passive' is allowed
  scan_backend?: 'Auto'     // Auto, Btleplug, Bluer, CoreBluetooth
}): Promise<void>

// Stop active scan
invoke('stop_scan'): Promise<void>

// Enumerate available BLE adapters
invoke('list_adapters'): Promise<AdapterInfo[]>

// Update device nickname
invoke('set_device_alias', {
  fingerprint: string,
  alias: string
}): Promise<void>

// Fetch device history
invoke('get_device_history', {
  fingerprint: string
}): Promise<DeviceHistory>
```

### Events (Backend → Frontend)

```typescript
// New or updated device seen
listen('ble:device_seen', (payload: DeviceSeenPayload) => {
  // payload.fingerprint
  // payload.mac_address
  // payload.rssi
  // payload.ad_data (advertisement structures)
})

// Device went offline
listen('ble:device_lost', (payload: DeviceLostPayload) => {
  // payload.fingerprint
  // payload.last_seen
})

// Scanning error
listen('ble:scan_error', (payload: string) => {
  // Error message
})
```

## Cross-Platform Implementation

### Windows
- **BLE Backend**: WinBLE (native Windows API, via btleplug)
- **Adapter Selection**: Uses Windows' native adapter enumeration
- **Privileges**: May require elevated privileges for adapter access
- **Status**: Tested and working

### Linux
- **BLE Backend**: D-Bus + BlueZ (via btleplug)
- **Dependencies**: libbluetooth-dev, BlueZ daemon
- **Privileges**: May require user in `bluetooth` group
- **Status**: Working; multi-adapter support in progress

### macOS
- **BLE Backend**: CoreBluetooth (via btleplug)
- **Framework**: Native system framework
- **Permissions**: Requires user approval at first run
- **Status**: Supported; testing ongoing

## Security Guarantees

### Passive-Only Policy

The backend enforces passive-only scanning at multiple levels:

1. **Compile-time**: `scripts/no-connect-guard.mjs` CI check prevents merge of forbidden APIs
2. **Runtime**: `scanner.rs` rejects `Active` scan mode with error message
3. **Types**: `ScanMode` enum only defines `Passive` variant (other backends stubbed)

### No Device Connections

The btleplug adapter is used only for:
- `adapter.start_scan()` (passive)
- `adapter.scan_filter()` (filtering)
- Event listening (receiving only)

Never called:
- `peripheral.connect()`
- `peripheral.discover_services()`
- `gatt.write_characteristic()`

## Performance

### Scaling

Tested with 50+ simultaneous BLE devices:
- **Memory**: ~80 MB baseline, +1-2 MB per 10 devices
- **CPU**: ~5-10% on modern CPU during active scanning
- **SQLite**: Handles 10k+ history entries per device without slowdown

### Optimization Strategies

1. **Event Debouncing**: Frontend batches device_seen events (100ms window)
2. **History Compression**: Old RSSI samples are aggregated (configurable)
3. **Filtering**: RSSI filtering applied on backend to reduce event volume
4. **Async I/O**: All database operations use tokio::spawn to avoid blocking

## Testing

### Unit Tests

Located in each module's `#[cfg(test)]` section:

```bash
cd src-tauri
cargo test
```

### Integration Tests

Manual end-to-end testing:

```bash
npm run tauri dev    # Start dev app
# Manually test scanning, filtering, export
```

### Safety Verification

```bash
npm run safety:no-connect    # Verify no forbidden BLE APIs
npm run build               # TypeScript + Vite compilation
```

## Future Extensibility

### Alternative BLE Backends

Planned support for:
- `bluer` (Linux-specific optimizations)
- `corebluetooth` (macOS native)
- `winrt-ble` (Windows WinRT)
- Direct libusb (raw packet capture)

### Plugin System

Extensibility points for:
- Custom device decoders
- Export formats
- Data analysis pipelines

---

For detailed API documentation, see [README.md](../README.md).
