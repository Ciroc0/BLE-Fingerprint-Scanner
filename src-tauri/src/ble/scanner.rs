use crate::ble::{fingerprint::fingerprint_device, parser::build_packet_from_properties};
use crate::db::sqlite::SqliteStore;
use crate::models::{DeviceLostPayload, DeviceSeenPayload, ScanBackend, ScanMode};
use btleplug::api::{Central, CentralEvent, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Adapter, Manager, PeripheralId};
use futures_util::StreamExt;
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager as TauriManager};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

pub struct ScanRuntime {
    stop_tx: Option<watch::Sender<bool>>,
    scan_tasks: Vec<JoinHandle<()>>,
    dispatch_task: JoinHandle<()>,
}

impl ScanRuntime {
    pub async fn stop(mut self) -> Result<(), String> {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(true);
        }

        for task in self.scan_tasks {
            task.await.map_err(|error| error.to_string())?;
        }
        self.dispatch_task.await.map_err(|error| error.to_string())?;
        Ok(())
    }
}

pub async fn spawn(
    app: AppHandle,
    database: SqliteStore,
    adapter_hint: Option<&str>,
    scan_mode: ScanMode,
    scan_backend: ScanBackend,
) -> Result<ScanRuntime, String> {
    if matches!(scan_mode, ScanMode::Active) {
        return Err(
            "Active scanning is disabled by policy. Ghost Hunter runs passive advertisement capture only."
                .to_string(),
        );
    }

    match scan_backend {
        ScanBackend::Auto | ScanBackend::Btleplug => {
            spawn_btleplug(app, database, adapter_hint).await
        }
        ScanBackend::Bluer => Err("The 'bluer' backend is not enabled in this build yet. Scanning was not started.".to_string()),
        ScanBackend::CoreBluetooth => Err("The 'corebluetooth' backend is not enabled in this build yet. Scanning was not started.".to_string()),
    }
}

async fn spawn_btleplug(
    app: AppHandle,
    database: SqliteStore,
    adapter_hint: Option<&str>,
) -> Result<ScanRuntime, String> {
    let manager = Manager::new().await.map_err(|error| error.to_string())?;
    let mut adapters = manager.adapters().await.map_err(|error| error.to_string())?;

    let selected_adapters = if let Some(hint) = adapter_hint {
        let mut matched = Vec::<Adapter>::new();

        for adapter in adapters.drain(..) {
            let info = adapter.adapter_info().await.unwrap_or_default();
            if info == hint {
                matched.push(adapter);
                break;
            }
        }

        if matched.is_empty() {
            return Err(format!("Requested BLE adapter not found: {hint}"));
        }

        matched
    } else {
        adapters
    };

    if selected_adapters.is_empty() {
        return Err("No BLE adapters were detected".to_string());
    }

    eprintln!(
        "[Scanner] Starting passive scan across {} adapter(s)",
        selected_adapters.len()
    );

    let (payload_tx, mut payload_rx) = mpsc::channel::<DeviceSeenPayload>(512);
    let (stop_tx, stop_rx) = watch::channel(false);
    let mut scan_tasks = Vec::<JoinHandle<()>>::new();

    for adapter in selected_adapters {
        adapter
            .start_scan(ScanFilter::default())
            .await
            .map_err(|error| error.to_string())?;

        let adapter_label = adapter.adapter_info().await.unwrap_or_else(|_| "unknown".to_string());
        eprintln!("[Scanner] Passive scan enabled on adapter: {adapter_label}");

        let scan_adapter = adapter.clone();
        let payload_tx = payload_tx.clone();
        let mut stop_rx = stop_rx.clone();
        let mut event_stream = adapter.events().await.map_err(|error| error.to_string())?;

        let scan_task = tokio::spawn(async move {
            let mut last_emit = HashMap::<String, Instant>::new();

            loop {
                tokio::select! {
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() {
                            let _ = scan_adapter.stop_scan().await;
                            break;
                        }
                    }
                    maybe_event = event_stream.next() => {
                        let Some(event) = maybe_event else {
                            let _ = scan_adapter.stop_scan().await;
                            break;
                        };

                        if let Some(peripheral_id) = event_peripheral_id(&event) {
                            if let Ok(Some(payload)) = build_payload(&scan_adapter, peripheral_id).await {
                                let should_emit = match last_emit.get(&payload.fingerprint) {
                                    Some(last_seen) => last_seen.elapsed() >= Duration::from_millis(100),
                                    None => true,
                                };

                                if should_emit {
                                    last_emit.insert(payload.fingerprint.clone(), Instant::now());
                                    if payload_tx.send(payload).await.is_err() {
                                        let _ = scan_adapter.stop_scan().await;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        scan_tasks.push(scan_task);
    }

    drop(payload_tx);

    let dispatch_task = tokio::spawn(async move {
        let mut last_seen = HashMap::<String, i64>::new();
        let mut ticker = tokio::time::interval(Duration::from_secs(1));

        loop {
            tokio::select! {
                maybe_payload = payload_rx.recv() => {
                    let Some(payload) = maybe_payload else {
                        break;
                    };

                    last_seen.insert(payload.fingerprint.clone(), payload.timestamp);
                    let _ = database.upsert_device(&payload).await;
                    let _ = app.emit_all("ble:device_seen", payload);
                }
                _ = ticker.tick() => {
                    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
                        Ok(duration) => duration.as_secs() as i64,
                        Err(_) => continue,
                    };

                    let mut lost_fingerprints = Vec::<String>::new();
                    for (fingerprint, seen_ts) in &last_seen {
                        if now - *seen_ts >= 30 {
                            lost_fingerprints.push(fingerprint.clone());
                        }
                    }

                    for fingerprint in lost_fingerprints {
                        if let Some(last_seen_ts) = last_seen.remove(&fingerprint) {
                            let _ = app.emit_all(
                                "ble:device_lost",
                                DeviceLostPayload {
                                    fingerprint,
                                    last_seen: last_seen_ts,
                                },
                            );
                        }
                    }
                }
            }
        }
    });

    Ok(ScanRuntime {
        stop_tx: Some(stop_tx),
        scan_tasks,
        dispatch_task,
    })
}

async fn build_payload(adapter: &Adapter, peripheral_id: PeripheralId) -> Result<Option<DeviceSeenPayload>, String> {
    // SECURITY NOTE: This function only reads peripheral properties.
    // No pairing and no GATT/connection operations are allowed in this code path.
    // All data is derived from advertisement observation only.
    
    let peripheral = adapter
        .peripheral(&peripheral_id)
        .await
        .map_err(|error| error.to_string())?;

    let Some(properties) = peripheral.properties().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };

    let Some(rssi) = properties.rssi else {
        return Ok(None);
    };

    let packet = build_packet_from_properties(&properties);
    let service_uuids = properties
        .services
        .iter()
        .map(|uuid| uuid.to_string().to_lowercase())
        .collect::<Vec<_>>();

    let fingerprint = fingerprint_device(&properties.manufacturer_data, &service_uuids, properties.tx_power_level);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;

    let mac_address = normalize_address(&properties.address.to_string());

    Ok(Some(DeviceSeenPayload {
        fingerprint,
        timestamp,
        rssi,
        mac_address,
        ad_data: packet.parsed,
        raw_hex: hex::encode_upper(packet.raw_bytes),
    }))
}

fn event_peripheral_id(event: &CentralEvent) -> Option<PeripheralId> {
    match event {
        CentralEvent::DeviceDiscovered(id)
        | CentralEvent::DeviceUpdated(id)
        | CentralEvent::DeviceConnected(id)
        | CentralEvent::DeviceDisconnected(id)
        | CentralEvent::DeviceServicesModified(id) => Some(id.clone()),
        CentralEvent::ManufacturerDataAdvertisement { id, .. }
        | CentralEvent::ServiceDataAdvertisement { id, .. }
        | CentralEvent::ServicesAdvertisement { id, .. }
        | CentralEvent::RssiUpdate { id, .. } => Some(id.clone()),
        CentralEvent::StateUpdate(_) => None,
    }
}

fn normalize_address(address: &str) -> Option<String> {
    if address.contains('-') {
        None
    } else {
        Some(address.to_string())
    }
}