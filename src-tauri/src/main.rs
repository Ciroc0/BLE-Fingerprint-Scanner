#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ble;
mod db;
mod models;

use ble::scanner::{self, ScanRuntime};
use db::sqlite::SqliteStore;
use models::{AdapterInfo, DeviceHistory, ScanBackend, ScanMode};
use btleplug::api::{Central as _, Manager as _};
use btleplug::platform::Manager;
use serde::Deserialize;
use tokio::sync::Mutex;

struct AppState {
    database: SqliteStore,
    scanner: Mutex<Option<ScanRuntime>>,
}

#[derive(Debug, Deserialize)]
struct ScanOptions {
    adapter_id: Option<String>,
    scan_mode: Option<ScanMode>,
    scan_backend: Option<ScanBackend>,
}

#[tauri::command]
async fn start_scan(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    options: Option<ScanOptions>,
) -> Result<(), String> {
    let mut scanner = state.scanner.lock().await;

    if scanner.is_some() {
        return Ok(());
    }

    let adapter_hint = options
        .as_ref()
        .and_then(|opts| opts.adapter_id.as_deref())
        .filter(|value| !value.is_empty());

    let scan_mode = options
        .as_ref()
        .and_then(|opts| opts.scan_mode)
        .unwrap_or(ScanMode::Passive);

    let scan_backend = options
        .as_ref()
        .and_then(|opts| opts.scan_backend)
        .unwrap_or(ScanBackend::Auto);

    let runtime = scanner::spawn(app, state.database.clone(), adapter_hint, scan_mode, scan_backend).await.map_err(|err| {
        eprintln!("[StartScan Error] {}", err);
        // Provide user-friendly error messages for common issues
        if err.contains("No BLE adapters") {
            "No Bluetooth adapters found. Check that Bluetooth is enabled on your system.".to_string()
        } else if err.contains("adapter not found") {
            "Selected Bluetooth adapter was not found. It may have been disconnected.".to_string()
        } else if err.contains("Permission denied") || err.contains("permission") {
            "Permission denied. Ghost Hunter may need to run with elevated privileges.".to_string()
        } else {
            format!("Failed to start scan: {}", err)
        }
    })?;
    *scanner = Some(runtime);
    Ok(())
}

#[tauri::command]
async fn stop_scan(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut scanner = state.scanner.lock().await;

    if let Some(runtime) = scanner.take() {
        runtime.stop().await?;
    }

    Ok(())
}

#[tauri::command]
async fn list_adapters() -> Result<Vec<AdapterInfo>, String> {
    let manager = Manager::new().await.map_err(|error| error.to_string())?;
    let adapters = manager.adapters().await.map_err(|error| error.to_string())?;
    let mut result = Vec::with_capacity(adapters.len());

    for adapter in adapters {
        let info = adapter
            .adapter_info()
            .await
            .unwrap_or_else(|_| "unknown".to_string());

        result.push(AdapterInfo {
            id: info.clone(),
            name: info,
        });
    }

    Ok(result)
}

#[tauri::command]
async fn get_device_history(
    state: tauri::State<'_, AppState>,
    fingerprint: String,
) -> Result<Option<DeviceHistory>, String> {
    state.database.get_device_history(&fingerprint).await
}

#[tauri::command]
async fn get_all_device_history(state: tauri::State<'_, AppState>) -> Result<Vec<DeviceHistory>, String> {
    state.database.get_all_device_history().await
}

#[tauri::command]
async fn set_device_alias(
    state: tauri::State<'_, AppState>,
    fingerprint: String,
    alias: String,
) -> Result<(), String> {
    state.database.set_device_alias(&fingerprint, &alias).await
}

fn main() {
    tauri::async_runtime::block_on(async {
        let database = SqliteStore::initialize()
            .await
            .expect("failed to initialize SQLite store");

        tauri::Builder::default()
            .manage(AppState {
                database,
                scanner: Mutex::new(None),
            })
            .invoke_handler(tauri::generate_handler![
                start_scan,
                stop_scan,
                list_adapters,
                get_device_history,
                get_all_device_history,
                set_device_alias
            ])
            .run(tauri::generate_context!())
            .expect("error while running Ghost Hunter");
    });
}