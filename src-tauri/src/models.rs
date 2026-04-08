use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ScanMode {
    #[serde(rename = "passive")]
    Passive,
    #[serde(rename = "active")]
    Active,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedAdData {
    pub flags: Option<u8>,
    pub local_name: Option<String>,
    pub local_name_length: Option<usize>,
    pub tx_power: Option<i16>,
    pub manufacturer_data: BTreeMap<String, Vec<u8>>,
    pub service_data: BTreeMap<String, Vec<u8>>,
    pub service_uuids: Vec<String>,
    pub ad_structures: BTreeMap<String, Vec<String>>,
    pub ad_structure_count: usize,
    pub service_uuid_count: usize,
    pub service_data_count: usize,
    pub manufacturer_count: usize,
    pub address_type: Option<String>,
    pub class: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct AdvertisementPacket {
    pub raw_bytes: Vec<u8>,
    pub parsed: ParsedAdData,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceSeenPayload {
    pub fingerprint: String,
    pub timestamp: i64,
    pub rssi: i16,
    pub mac_address: Option<String>,
    pub ad_data: ParsedAdData,
    pub raw_hex: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeviceHistoryPoint {
    pub timestamp: i64,
    pub rssi: i16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DevicePayloadPoint {
    pub timestamp: i64,
    pub raw_hex: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceQualityMetrics {
    pub sample_count: usize,
    pub avg_advertisements_per_second: f32,
    pub rssi_span: i16,
    pub payload_change_rate: f32,
    pub stability_score: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceLostPayload {
    pub fingerprint: String,
    pub last_seen: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdapterInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceHistory {
    pub fingerprint: String,
    pub alias: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
    pub seen_count: usize,
    pub rssi_history: Vec<DeviceHistoryPoint>,
    pub payload_history: Vec<DevicePayloadPoint>,
    pub quality: DeviceQualityMetrics,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ScanBackend {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "btleplug")]
    Btleplug,
    #[serde(rename = "bluer")]
    Bluer,
    #[serde(rename = "corebluetooth")]
    CoreBluetooth,
}