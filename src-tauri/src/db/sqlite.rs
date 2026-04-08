use crate::models::{
    DeviceHistory,
    DeviceHistoryPoint,
    DevicePayloadPoint,
    DeviceQualityMetrics,
    DeviceSeenPayload,
};
use directories::ProjectDirs;
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, ConnectOptions, Row, SqlitePool};
use std::path::PathBuf;

#[derive(Clone)]
pub struct SqliteStore {
    pool: SqlitePool,
}

impl SqliteStore {
    pub async fn initialize() -> Result<Self, String> {
        let database_path = database_path()?;

        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let connect_options = SqliteConnectOptions::new()
            .filename(&database_path)
            .create_if_missing(true)
            .disable_statement_logging();
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(connect_options)
            .await
            .map_err(|error| error.to_string())?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS devices(
                id INTEGER PRIMARY KEY,
                fingerprint TEXT NOT NULL UNIQUE,
                alias TEXT,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                rssi_history TEXT NOT NULL,
                payload_history TEXT NOT NULL DEFAULT '[]'
            )",
        )
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;

        let has_payload_history = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(1) FROM pragma_table_info('devices') WHERE name = 'payload_history'",
        )
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string())?
            > 0;

        if !has_payload_history {
            sqlx::query("ALTER TABLE devices ADD COLUMN payload_history TEXT NOT NULL DEFAULT '[]'")
                .execute(&pool)
                .await
                .map_err(|error| error.to_string())?;
        }

        Ok(Self { pool })
    }

    pub async fn upsert_device(&self, payload: &DeviceSeenPayload) -> Result<(), String> {
        let existing = sqlx::query("SELECT rssi_history, payload_history, first_seen, alias FROM devices WHERE fingerprint = ?1")
            .bind(&payload.fingerprint)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| error.to_string())?;

        let mut history = existing
            .as_ref()
            .and_then(|row| row.try_get::<String, _>("rssi_history").ok())
            .and_then(|value| serde_json::from_str::<Vec<DeviceHistoryPoint>>(&value).ok())
            .unwrap_or_default();

        history.push(DeviceHistoryPoint {
            timestamp: payload.timestamp,
            rssi: payload.rssi,
        });

        let mut payload_history = existing
            .as_ref()
            .and_then(|row| row.try_get::<String, _>("payload_history").ok())
            .and_then(|value| serde_json::from_str::<Vec<DevicePayloadPoint>>(&value).ok())
            .unwrap_or_default();

        payload_history.push(DevicePayloadPoint {
            timestamp: payload.timestamp,
            raw_hex: payload.raw_hex.clone(),
        });

        if history.len() > 2_000 {
            let drain_count = history.len() - 2_000;
            history.drain(0..drain_count);
        }

        if payload_history.len() > 800 {
            let drain_count = payload_history.len() - 800;
            payload_history.drain(0..drain_count);
        }

        let history_json = serde_json::to_string(&history).map_err(|error| error.to_string())?;
        let payload_history_json =
            serde_json::to_string(&payload_history).map_err(|error| error.to_string())?;

        match existing {
            Some(row) => {
                let first_seen = row.try_get::<i64, _>("first_seen").unwrap_or(payload.timestamp);

                sqlx::query(
                    "UPDATE devices SET last_seen = ?1, rssi_history = ?2, payload_history = ?3 WHERE fingerprint = ?4",
                )
                .bind(payload.timestamp)
                .bind(history_json)
                .bind(payload_history_json)
                .bind(&payload.fingerprint)
                .execute(&self.pool)
                .await
                .map_err(|error| error.to_string())?;

                let _ = first_seen;
            }
            None => {
                sqlx::query(
                    "INSERT INTO devices (fingerprint, alias, first_seen, last_seen, rssi_history, payload_history)
                     VALUES (?1, NULL, ?2, ?3, ?4, ?5)",
                )
                .bind(&payload.fingerprint)
                .bind(payload.timestamp)
                .bind(payload.timestamp)
                .bind(history_json)
                 .bind(payload_history_json)
                .execute(&self.pool)
                .await
                .map_err(|error| error.to_string())?;
            }
        }

        Ok(())
    }

    pub async fn get_device_history(&self, fingerprint: &str) -> Result<Option<DeviceHistory>, String> {
        let row = sqlx::query(
            "SELECT fingerprint, alias, first_seen, last_seen, rssi_history, payload_history FROM devices WHERE fingerprint = ?1",
        )
        .bind(fingerprint)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| error.to_string())?;

        let Some(row) = row else {
            return Ok(None);
        };

        let history_json = row
            .try_get::<String, _>("rssi_history")
            .unwrap_or_else(|_| "[]".to_string());
        let rssi_history = serde_json::from_str::<Vec<DeviceHistoryPoint>>(&history_json)
            .unwrap_or_default();

        let payload_history_json = row
            .try_get::<String, _>("payload_history")
            .unwrap_or_else(|_| "[]".to_string());
        let payload_history = serde_json::from_str::<Vec<DevicePayloadPoint>>(&payload_history_json)
            .unwrap_or_default();

        let quality = calculate_quality_metrics(&rssi_history, &payload_history);

        Ok(Some(DeviceHistory {
            fingerprint: row.try_get::<String, _>("fingerprint").map_err(|error| error.to_string())?,
            alias: row.try_get::<Option<String>, _>("alias").ok().flatten(),
            first_seen: row.try_get::<i64, _>("first_seen").map_err(|error| error.to_string())?,
            last_seen: row.try_get::<i64, _>("last_seen").map_err(|error| error.to_string())?,
            seen_count: rssi_history.len(),
            rssi_history,
            payload_history,
            quality,
        }))
    }

    pub async fn get_all_device_history(&self) -> Result<Vec<DeviceHistory>, String> {
        let rows = sqlx::query(
            "SELECT fingerprint FROM devices ORDER BY last_seen DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| error.to_string())?;

        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            let fingerprint = row
                .try_get::<String, _>("fingerprint")
                .map_err(|error| error.to_string())?;

            if let Some(history) = self.get_device_history(&fingerprint).await? {
                result.push(history);
            }
        }

        Ok(result)
    }

    pub async fn set_device_alias(&self, fingerprint: &str, alias: &str) -> Result<(), String> {
        let updated = sqlx::query("UPDATE devices SET alias = ?1 WHERE fingerprint = ?2")
            .bind(alias)
            .bind(fingerprint)
            .execute(&self.pool)
            .await
            .map_err(|error| error.to_string())?;

        if updated.rows_affected() == 0 {
            return Err("Device fingerprint not found".to_string());
        }

        Ok(())
    }
}

fn database_path() -> Result<PathBuf, String> {
    let project_dirs = ProjectDirs::from("com", "GhostHunter", "GhostHunter")
        .ok_or_else(|| "Unable to resolve application data directory".to_string())?;

    Ok(project_dirs.data_dir().join("ghost_hunter.sqlite"))
}

fn calculate_quality_metrics(
    rssi_history: &[DeviceHistoryPoint],
    payload_history: &[DevicePayloadPoint],
) -> DeviceQualityMetrics {
    let sample_count = rssi_history.len();

    let avg_advertisements_per_second = if sample_count >= 2 {
        let duration = (rssi_history[sample_count - 1].timestamp - rssi_history[0].timestamp).max(1) as f32;
        (sample_count as f32) / duration
    } else {
        0.0
    };

    let rssi_span = if rssi_history.is_empty() {
        0
    } else {
        let mut min_rssi = i16::MAX;
        let mut max_rssi = i16::MIN;
        for point in rssi_history {
            min_rssi = min_rssi.min(point.rssi);
            max_rssi = max_rssi.max(point.rssi);
        }
        max_rssi - min_rssi
    };

    let payload_change_rate = if payload_history.len() < 2 {
        0.0
    } else {
        let mut changes = 0usize;
        for window in payload_history.windows(2) {
            if window[0].raw_hex != window[1].raw_hex {
                changes += 1;
            }
        }
        changes as f32 / (payload_history.len() as f32 - 1.0)
    };

    let span_penalty = (rssi_span.min(60) as f32) / 60.0;
    let change_penalty = payload_change_rate.min(1.0) * 0.4;
    let raw_stability = (1.0 - span_penalty * 0.6 - change_penalty).clamp(0.0, 1.0);
    let stability_score = (raw_stability * 100.0).round() as u8;

    DeviceQualityMetrics {
        sample_count,
        avg_advertisements_per_second: (avg_advertisements_per_second * 100.0).round() / 100.0,
        rssi_span,
        payload_change_rate: (payload_change_rate * 1000.0).round() / 1000.0,
        stability_score,
    }
}