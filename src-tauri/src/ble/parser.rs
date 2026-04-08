use crate::models::{AdvertisementPacket, ParsedAdData};
use btleplug::api::PeripheralProperties;
use std::collections::BTreeMap;

pub const AD_TYPE_FLAGS: u8 = 0x01;
pub const AD_TYPE_COMPLETE_LOCAL_NAME: u8 = 0x09;
pub const AD_TYPE_TX_POWER: u8 = 0x0A;
pub const AD_TYPE_MANUFACTURER_SPECIFIC: u8 = 0xFF;

pub fn parse_advertisement(raw: &[u8], service_uuids: Vec<String>) -> ParsedAdData {
    let mut offset = 0usize;
    let mut flags = None;
    let mut local_name = None;
    let mut tx_power = None;
    let mut manufacturer_data = BTreeMap::new();
    let mut ad_structures = BTreeMap::<String, Vec<String>>::new();
    let mut ad_structure_count = 0usize;

    while offset < raw.len() {
      let length = raw[offset] as usize;
      offset += 1;

      if length == 0 || offset + length > raw.len() + 1 {
          break;
      }

      let ad_type = raw[offset];
      let data_start = offset + 1;
      let data_end = offset + length;
      let data = &raw[data_start..data_end];
      ad_structure_count += 1;
      ad_structures
          .entry(format!("0x{ad_type:02X}"))
          .or_default()
          .push(hex::encode_upper(data));

      match ad_type {
          AD_TYPE_FLAGS if data.len() == 1 => flags = Some(data[0]),
          AD_TYPE_COMPLETE_LOCAL_NAME => {
              local_name = Some(String::from_utf8_lossy(data).trim_end_matches('\0').to_string());
          }
          AD_TYPE_TX_POWER if data.len() == 1 => {
              tx_power = Some(i8::from_le_bytes([data[0]]) as i16);
          }
          AD_TYPE_MANUFACTURER_SPECIFIC if data.len() >= 2 => {
              let company_id = u16::from_le_bytes([data[0], data[1]]);
              manufacturer_data.insert(format!("0x{company_id:04X}"), data[2..].to_vec());
          }
          _ => {}
      }

      offset = data_end;
    }

    ParsedAdData {
        flags,
        local_name_length: local_name.as_ref().map(|value| value.len()),
        local_name,
        tx_power,
        manufacturer_data,
        service_data: BTreeMap::new(),
        service_uuid_count: service_uuids.len(),
        service_uuids,
        ad_structures,
        ad_structure_count,
        service_data_count: 0,
        manufacturer_count: 0,
        address_type: None,
        class: None,
    }
}

pub fn build_packet_from_properties(properties: &PeripheralProperties) -> AdvertisementPacket {
    let mut raw = Vec::new();

    if let Some(name) = properties
        .local_name
        .clone()
        .or_else(|| properties.advertisement_name.clone())
    {
        let mut bytes = name.into_bytes();
        let max_len = 29usize;
        bytes.truncate(max_len);
        raw.push((bytes.len() + 1) as u8);
        raw.push(AD_TYPE_COMPLETE_LOCAL_NAME);
        raw.extend(bytes);
    }

    if let Some(tx_power) = properties.tx_power_level {
        raw.push(2);
        raw.push(AD_TYPE_TX_POWER);
        raw.push((tx_power as i8) as u8);
    }

    let mut manufacturer_entries = properties.manufacturer_data.iter().collect::<Vec<_>>();
    manufacturer_entries.sort_by_key(|entry| *entry.0);

    for (company_id, payload) in manufacturer_entries {
        let length = payload.len().saturating_add(3);
        raw.push(length as u8);
        raw.push(AD_TYPE_MANUFACTURER_SPECIFIC);
        raw.extend(company_id.to_le_bytes());
        raw.extend(payload.iter().copied());
    }

    let service_uuids = properties
        .services
        .iter()
        .map(|uuid| uuid.to_string().to_lowercase())
        .collect::<Vec<_>>();

    let mut service_data = BTreeMap::new();
    for (service_uuid, payload) in &properties.service_data {
        service_data.insert(service_uuid.to_string().to_lowercase(), payload.clone());
    }

    let address_type = properties
        .address_type
        .as_ref()
        .map(|kind| format!("{kind:?}").to_lowercase());

    let mut parsed = parse_advertisement(&raw, service_uuids);
    parsed.service_data_count = service_data.len();
    parsed.manufacturer_count = parsed.manufacturer_data.len();
    parsed.service_data = service_data;
    parsed.address_type = address_type;
    parsed.class = properties.class;

    AdvertisementPacket { raw_bytes: raw, parsed }
}