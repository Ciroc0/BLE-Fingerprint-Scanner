use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub fn fingerprint_device(
    manufacturer_data: &HashMap<u16, Vec<u8>>,
    service_uuids: &[String],
    tx_power: Option<i16>,
) -> String {
    let mut hasher = Sha256::new();

    let mut manufacturer_entries = manufacturer_data.iter().collect::<Vec<_>>();
    manufacturer_entries.sort_by_key(|entry| *entry.0);

    for (company_id, payload) in manufacturer_entries {
        hasher.update(company_id.to_le_bytes());
        hasher.update(payload);
    }

    let mut sorted_services = service_uuids.to_vec();
    sorted_services.sort();

    for service_uuid in sorted_services {
        hasher.update(service_uuid.as_bytes());
    }

    if let Some(tx_power) = tx_power {
        hasher.update(tx_power.to_le_bytes());
    }

    hex::encode(hasher.finalize())
}