# Contributing to BLE Fingerprint Scanner

Thank you for your interest in contributing! This document provides guidelines for reporting issues and submitting pull requests.

## Code of Conduct

All contributions must adhere to our [Code of Conduct](CODE_OF_CONDUCT.md):
- Be respectful and inclusive
- Give credit to other contributors
- Focus on what benefits the community, not personal benefit

## Getting Started

### Development Environment Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/<owner>/ble-fingerprint-scanner.git
   cd ble-fingerprint-scanner
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd src-tauri && cargo build && cd ..
   ```

3. **Start development server**
   ```bash
   npm run tauri dev
   ```

4. **Run tests and checks**
   ```bash
   npm run build              # TypeScript compilation
   npm run safety:no-connect  # Safety policy check
   cd src-tauri && cargo test # Rust tests
   ```

### Development Workflow

1. Create a branch from `main`: `git checkout -b feature/my-feature`
2. Make changes and test locally
3. Run safety checks: `npm run safety:no-connect && npm run build`
4. Commit with descriptive messages (see below)
5. Push and open a pull request

## Reporting Issues

### Bugs

Before reporting, check existing issues to avoid duplicates.

**Include:**
- OS (Windows 10/11, Ubuntu 20.04, macOS 12+)
- Bluetooth adapter model/name
- Steps to reproduce
- Expected vs. actual behavior
- Error messages or logs (`npm run tauri dev` console output)
- Screenshot if UI-related

**Example:**
```
Title: Scan crashes when switching adapters rapidly

OS: Windows 11, Intel Bluetooth adapter
Steps:
1. Start scan on adapter A
2. Switch to adapter B without stopping first scan
3. Click start scan

Result: Application crashes with error "adapter not found"
Expected: Graceful error message or automatic switch
```

### Feature Requests

**Include:**
- Use case: why would this feature help?
- Proposed solution (if any)
- Alternatives considered
- Implementation complexity estimate (if known)

**Example:**
```
Title: Add BLE packet capture (PCAP export)

Use case: Network analysts need raw packet data for deeper protocol analysis
beyond fingerprinting.

Proposed: Add "Export as PCAP" button that writes scanned advertisements to
libpcap format for Wireshark.
```

## Pull Request Process

### Before Submitting

1. **Follow code style:**
   - TypeScript: Use `prettier` (configured in repo)
   - Rust: Use `rustfmt`
   - No `console.log` in production code (use proper logging)

2. **Run safety checks:**
   ```bash
   npm run safety:no-connect
   npm run build
   ```
   This verifies no active scanning code (connect, pair, discover-services) is added.

3. **Update documentation:**
   - Update README.md if behavior changes
   - Add CHANGELOG.md entry under `[Unreleased]`
   - Document new IPC commands with types

4. **Test on multiple platforms if possible:**
   - Windows 10+
   - Linux (if you have access)
   - macOS (if you have access)

### PR Template

When opening a PR, use this template:

```markdown
## Description
Brief description of changes.

## Type
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] Feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature that breaks existing behavior)
- [ ] Documentation

## Related Issues
Closes #123

## Testing
Describe how you tested this change:
- [ ] Ran on Windows
- [ ] Ran on Linux
- [ ] Ran on macOS
- [ ] All tests pass

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-reviewed my own code
- [ ] Comments explain complex logic
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] CHANGELOG.md updated
- [ ] Safety check passes: `npm run safety:no-connect`
```

## BLE-Specific Contribution Patterns

### Adding New Device Decoders

Add hints for known device types to `src/utils/deviceIdentifier.ts`:

```typescript
export const getProtocolHints = (ad_data: AdvertisementData): string[] => {
  const hints: string[] = [];

  // Example: Detect My Custom Device
  if (ad_data.manufacturer_data['0x1234']) {
    const payload = ad_data.manufacturer_data['0x1234'];
    if (payload[0] === 0xAB) {
      hints.push('My Custom Device v2');
    }
  }

  return hints;
};
```

Then add a comment documenting the heuristic and reference the spec.

### Adding New Filters

1. Update `ScanOptions` in `src-tauri/src/main.rs`
2. Implement filtering in `src-tauri/src/ble/scanner.rs`
3. Add UI controls in `src/App.tsx`
4. Document in README.md

### Testing Advertisement Parsing

Add test vectors to `src-tauri/src/ble/parser.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_manufacturer_data() {
        let raw = vec![0xFF, 0x59, 0x00, 0xAA, 0xBB]; // AD type 0xFF with company 0x0059
        let parsed = parse_advertisement(&raw, vec![]);
        assert_eq!(parsed.manufacturer_data.len(), 1);
    }
}
```

## Architecture Guidelines

### Frontend (React/TypeScript)

- Components are in `src/components/`
- Device state management via React hooks
- IPC calls via `@tauri-apps/api/tauri` `invoke()`
- Keep components focused on UI; move logic to `utils/`

### Backend (Rust/Tauri)

- BLE scanning logic: `src-tauri/src/ble/scanner.rs`
- Advertisement parsing: `src-tauri/src/ble/parser.rs`
- Fingerprinting: `src-tauri/src/ble/fingerprint.rs`
- Database: `src-tauri/src/db/sqlite.rs`
- Tauri IPC commands: `src-tauri/src/main.rs`

All BLE operations must be **passive only** (no connections/pairing).

## Performance Considerations

- Avoid blocking the Tauri main thread; use `tokio::spawn` for I/O
- Limit RSSI history to last 1000 samples per device (configurable)
- Compress old DB records periodically
- Profile with `cargo flamegraph` before optimizing

## Documentation

- README.md: User-facing installation and usage
- CONTRIBUTING.md: Contributor guidelines (this file)
- docs/SPEC.md: Technical architecture and API contracts
- Code comments: Non-obvious logic, BLE deep-dives, security decisions

## Release Process

Only maintainers can cut releases. Process:

1. Update version in `package.json` and `src-tauri/Cargo.toml`
2. Update CHANGELOG.md with release date
3. Create git tag: `git tag v0.2.0`
4. Push tag: `git push origin v0.2.0`
5. GitHub Actions will build and attach binaries

## Questions?

- Open an issue for feature/clarification questions
- Join our discussions for chat

---

Thank you for contributing to BLE Fingerprint Scanner! Your work helps make Bluetooth analysis more accessible and transparent.
