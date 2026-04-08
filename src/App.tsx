import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/tauri";
import {
  getDeviceDisplayName,
  getManufacturerInfo,
  getManufacturerName,
  getProtocolHints,
  getPrimaryManufacturer,
} from "./utils/deviceIdentifier";

type AdvertisementData = {
  flags?: number | null;
  local_name?: string | null;
  local_name_length?: number | null;
  tx_power?: number | null;
  manufacturer_data: Record<string, number[]>;
  service_data: Record<string, number[]>;
  service_uuids: string[];
  ad_structures?: Record<string, string[]>;
  ad_structure_count?: number;
  service_uuid_count?: number;
  service_data_count?: number;
  manufacturer_count?: number;
  address_type?: string | null;
  class?: number | null;
};

type DeviceSeenPayload = {
  fingerprint: string;
  timestamp: number;
  rssi: number;
  mac_address: string | null;
  raw_hex: string;
  ad_data: AdvertisementData;
};

type AdapterInfo = {
  id: string;
  name: string;
};

type DeviceHistoryPoint = {
  timestamp: number;
  rssi: number;
};

type DeviceHistory = {
  fingerprint: string;
  alias: string | null;
  first_seen: number;
  last_seen: number;
  seen_count: number;
  rssi_history: DeviceHistoryPoint[];
  payload_history: {
    timestamp: number;
    raw_hex: string;
  }[];
  quality: {
    sample_count: number;
    avg_advertisements_per_second: number;
    rssi_span: number;
    payload_change_rate: number;
    stability_score: number;
  };
};

type DeviceMap = Record<string, DeviceSeenPayload>;

type DeviceLostPayload = {
  fingerprint: string;
  last_seen: number;
};

type LostDeviceMap = Record<string, DeviceLostPayload>;

type PayloadSnapshot = {
  timestamp: number;
  rawHex: string;
};

// Performance monitoring state (dev helper)
type PerformanceMetrics = {
  eventCount: number;
  lastEventTime: number;
  eventsPerSecond: number;
  averageFrameTime: number;
  maxFrameTime: number;
  uiFreezeDetected: boolean;
};

const createPerformanceMetrics = (): PerformanceMetrics => ({
  eventCount: 0,
  lastEventTime: Date.now(),
  eventsPerSecond: 0,
  averageFrameTime: 0,
  maxFrameTime: 0,
  uiFreezeDetected: false,
});

const formatRssi = (rssi: number) => `${rssi} dBm`;

const splitHexBytes = (rawHex: string): string[] => {
  if (!rawHex) {
    return [];
  }

  const clean = rawHex.replace(/\s+/g, "").toUpperCase();
  const bytes: string[] = [];

  for (let index = 0; index < clean.length; index += 2) {
    const byte = clean.slice(index, index + 2);
    if (byte.length === 2) {
      bytes.push(byte);
    }
  }

  return bytes;
};

function App() {
  const [devices, setDevices] = useState<DeviceMap>({});
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null);
  const [lostDevices, setLostDevices] = useState<LostDeviceMap>({});
  const [scanState, setScanState] = useState<"idle" | "starting" | "scanning" | "stopping">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [minRssiFilter, setMinRssiFilter] = useState<number>(-120);
  const [manufacturerFilter, setManufacturerFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [selectedAdapter, setSelectedAdapter] = useState<string>("auto");
  const [selectedHistory, setSelectedHistory] = useState<DeviceHistory | null>(null);
  const [aliasDraft, setAliasDraft] = useState<string>("");
  const [aliasByFingerprint, setAliasByFingerprint] = useState<Record<string, string>>({});
  const [payloadHistoryByFingerprint, setPayloadHistoryByFingerprint] = useState<Record<string, PayloadSnapshot[]>>({});
  const [perfMetrics, setPerfMetrics] = useState<PerformanceMetrics>(createPerformanceMetrics());

  // Load UI preferences from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("ghost-hunter-filters");
    if (saved) {
      try {
        const prefs = JSON.parse(saved);
        if (typeof prefs.minRssiFilter === "number") setMinRssiFilter(prefs.minRssiFilter);
        if (typeof prefs.manufacturerFilter === "string") setManufacturerFilter(prefs.manufacturerFilter);
        if (typeof prefs.serviceFilter === "string") setServiceFilter(prefs.serviceFilter);
      } catch (_) {
        // Silently ignore malformed preferences
      }
    }
  }, []);

  // Save UI preferences to localStorage whenever filters change
  useEffect(() => {
    const prefs = {
      minRssiFilter,
      manufacturerFilter,
      serviceFilter,
    };
    localStorage.setItem("ghost-hunter-filters", JSON.stringify(prefs));
  }, [minRssiFilter, manufacturerFilter, serviceFilter]);

  // Performance monitoring: track event frequency and frame times
  useEffect(() => {
    const interval = setInterval(() => {
      setPerfMetrics((current) => {
        const now = Date.now();
        const delta = (now - current.lastEventTime) / 1000;
        const eps = current.eventCount / delta;
        
        return {
          ...current,
          eventsPerSecond: Math.round(eps * 10) / 10,
          eventCount: 0,
          lastEventTime: now,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Track frame rendering performance via requestAnimationFrame
  useEffect(() => {
    let lastFrameTime = performance.now();
    let isMonitoring = true;

    const measureFrame = () => {
      if (!isMonitoring) return;
      const now = performance.now();
      const frameTime = now - lastFrameTime;
      lastFrameTime = now;

      setPerfMetrics((current) => {
        const avgTime = (current.averageFrameTime * 9 + frameTime) / 10;
        const maxTime = Math.max(current.maxFrameTime, frameTime);
        const isFrozen = frameTime > 100; // More than 100ms is user-visible jank

        return {
          ...current,
          averageFrameTime: Math.round(avgTime * 10) / 10,
          maxFrameTime: Math.round(maxTime * 10) / 10,
          uiFreezeDetected: isFrozen,
          eventCount: current.eventCount + 1,
        };
      });

      requestAnimationFrame(measureFrame);
    };

    requestAnimationFrame(measureFrame);
    return () => {
      isMonitoring = false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const setupListener = async () => {
      const unlistenSeen = await listen<DeviceSeenPayload>("ble:device_seen", (event) => {
        if (disposed) {
          return;
        }

        setPayloadHistoryByFingerprint((current) => {
          const snapshots = current[event.payload.fingerprint] ?? [];

          return {
            ...current,
            [event.payload.fingerprint]: [
              ...snapshots,
              {
                timestamp: event.payload.timestamp,
                rawHex: event.payload.raw_hex,
              },
            ].slice(-80),
          };
        });

        setLostDevices((current) => {
          if (!current[event.payload.fingerprint]) {
            return current;
          }

          const next = { ...current };
          delete next[event.payload.fingerprint];
          return next;
        });

        setDevices((current) => {
          const next = {
            ...current,
            [event.payload.fingerprint]: event.payload,
          };

          setSelectedFingerprint((currentSelected) => currentSelected ?? event.payload.fingerprint);

          return next;
        });
      });

      const unlistenLost = await listen<DeviceLostPayload>("ble:device_lost", (event) => {
        if (disposed) {
          return;
        }

        setLostDevices((current) => ({
          ...current,
          [event.payload.fingerprint]: event.payload,
        }));

        setDevices((current) => {
          if (!current[event.payload.fingerprint]) {
            return current;
          }

          const next = { ...current };
          delete next[event.payload.fingerprint];
          return next;
        });

        setSelectedFingerprint((currentSelected) =>
          currentSelected === event.payload.fingerprint ? null : currentSelected,
        );
      });

      return () => {
        unlistenSeen();
        unlistenLost();
      };
    };

    let cleanup: (() => void) | undefined;

    void setupListener().then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const loadAdapters = async () => {
      try {
        const result = await invoke<AdapterInfo[]>("list_adapters");
        setAdapters(result);
      } catch (error) {
        setErrorMessage(String(error));
      }
    };

    void loadAdapters();
  }, []);

  useEffect(() => {
    let disposed = false;

    const loadHistory = async () => {
      if (!selectedFingerprint) {
        setSelectedHistory(null);
        setAliasDraft("");
        return;
      }

      try {
        const history = await invoke<DeviceHistory | null>("get_device_history", {
          fingerprint: selectedFingerprint,
        });

        if (disposed) {
          return;
        }

        setSelectedHistory(history);
        if (history?.alias) {
          const alias = history.alias;
          setAliasDraft(history.alias);
          setAliasByFingerprint((current) => ({
            ...current,
            [selectedFingerprint]: alias,
          }));
        } else {
          setAliasDraft("");
        }
      } catch {
        // Ignore transient history fetch errors during scan churn.
      }
    };

    void loadHistory();
    const interval = window.setInterval(() => void loadHistory(), 3000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [selectedFingerprint]);

  const manufacturerOptions = useMemo(() => {
    const entries = new Map<string, string>();

    for (const device of Object.values(devices)) {
      const manufacturerId = getPrimaryManufacturer(device.ad_data.manufacturer_data);
      if (!manufacturerId) {
        continue;
      }

      entries.set(manufacturerId, getManufacturerName(manufacturerId));
    }

    return Array.from(entries.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [devices]);

  const serviceOptions = useMemo(() => {
    const entries = new Set<string>();
    for (const device of Object.values(devices)) {
      for (const service of device.ad_data.service_uuids) {
        entries.add(service);
      }
    }
    return Array.from(entries).sort();
  }, [devices]);

  const deviceList = useMemo(
    () =>
      Object.values(devices)
        .filter((device) => {
          if (device.rssi < minRssiFilter) {
            return false;
          }

          if (manufacturerFilter === "all") {
            if (serviceFilter === "all") {
              return true;
            }

            return device.ad_data.service_uuids.includes(serviceFilter);
          }

          const primaryManufacturer = getPrimaryManufacturer(device.ad_data.manufacturer_data);
          if (primaryManufacturer !== manufacturerFilter) {
            return false;
          }

          if (serviceFilter === "all") {
            return true;
          }

          return device.ad_data.service_uuids.includes(serviceFilter);
        })
        .sort((left, right) => right.timestamp - left.timestamp),
    [devices, manufacturerFilter, minRssiFilter, serviceFilter],
  );

  const ghostList = useMemo(
    () => Object.values(lostDevices).sort((left, right) => right.last_seen - left.last_seen),
    [lostDevices],
  );

  const selectedDevice = selectedFingerprint ? devices[selectedFingerprint] : null;

  // Log performance metrics when device count reaches 50+
  useEffect(() => {
    if (deviceList.length >= 50 && scanState === "scanning") {
      console.log(`[Performance] Devices: ${deviceList.length}, Events/sec: ${perfMetrics.eventsPerSecond}, Avg frame: ${perfMetrics.averageFrameTime}ms, Max frame: ${perfMetrics.maxFrameTime}ms`);
      if (perfMetrics.uiFreezeDetected) {
        console.warn("[Performance] UI freeze detected (frame time > 100ms)");
      }
    }
  }, [deviceList.length, scanState, perfMetrics.eventsPerSecond, perfMetrics.averageFrameTime, perfMetrics.maxFrameTime, perfMetrics.uiFreezeDetected]);

  const selectedRssiPoints = selectedHistory?.rssi_history ?? [];
  const selectedPayloadHistory = selectedFingerprint ? payloadHistoryByFingerprint[selectedFingerprint] ?? [] : [];

  const payloadDiff = useMemo(() => {
    const latest = selectedPayloadHistory[selectedPayloadHistory.length - 1];
    const previous = selectedPayloadHistory[selectedPayloadHistory.length - 2];

    if (!latest || !previous) {
      return null;
    }

    const latestBytes = splitHexBytes(latest.rawHex);
    const previousBytes = splitHexBytes(previous.rawHex);
    const maxLength = Math.max(latestBytes.length, previousBytes.length);
    const entries = Array.from({ length: maxLength }, (_, index) => {
      const currentByte = latestBytes[index] ?? "--";
      const oldByte = previousBytes[index] ?? "--";
      return {
        index,
        currentByte,
        oldByte,
        changed: currentByte !== oldByte,
      };
    });

    const changedCount = entries.filter((entry) => entry.changed).length;
    return {
      latest,
      previous,
      entries,
      changedCount,
    };
  }, [selectedPayloadHistory]);

  const payloadChangeHeat = useMemo(() => {
    if (selectedPayloadHistory.length < 2) {
      return null;
    }

    const comparisons = selectedPayloadHistory.slice(-20);
    const changedCounts: number[] = [];

    for (let index = 1; index < comparisons.length; index += 1) {
      const current = splitHexBytes(comparisons[index].rawHex);
      const previous = splitHexBytes(comparisons[index - 1].rawHex);
      const maxLength = Math.max(current.length, previous.length);

      for (let byteIndex = 0; byteIndex < maxLength; byteIndex += 1) {
        const nextByte = current[byteIndex] ?? "--";
        const oldByte = previous[byteIndex] ?? "--";
        if (nextByte !== oldByte) {
          changedCounts[byteIndex] = (changedCounts[byteIndex] ?? 0) + 1;
        }
      }
    }

    if (changedCounts.length === 0) {
      return null;
    }

    return {
      changedCounts,
      maxCount: Math.max(...changedCounts, 1),
      comparisons: comparisons.length - 1,
    };
  }, [selectedPayloadHistory]);

  const rssiSparkline = useMemo(() => {
    if (selectedRssiPoints.length < 2) {
      return "";
    }

    const values = selectedRssiPoints.slice(-60).map((point) => point.rssi);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);

    return values
      .map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * 100;
        const y = 100 - ((value - min) / range) * 100;
        return `${x},${y}`;
      })
      .join(" ");
  }, [selectedRssiPoints]);

  const saveAlias = async () => {
    if (!selectedFingerprint) {
      return;
    }

    const trimmed = aliasDraft.trim();
    if (!trimmed) {
      return;
    }

    try {
      await invoke("set_device_alias", {
        fingerprint: selectedFingerprint,
        alias: trimmed,
      });

      setAliasByFingerprint((current) => ({
        ...current,
        [selectedFingerprint]: trimmed,
      }));
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

  const exportData = async (format: "json" | "csv") => {
    let historyByFingerprint: Record<string, DeviceHistory> = {};
    try {
      const allHistory = await invoke<DeviceHistory[]>("get_all_device_history");
      historyByFingerprint = Object.fromEntries(allHistory.map((entry) => [entry.fingerprint, entry]));
    } catch {
      // Continue with live data export when history aggregation is unavailable.
    }

    const live = deviceList.map((device) => ({
      history: historyByFingerprint[device.fingerprint] ?? null,
      fingerprint: device.fingerprint,
      alias: aliasByFingerprint[device.fingerprint] ?? null,
      timestamp: device.timestamp,
      rssi: device.rssi,
      mac_address: device.mac_address,
      display_name: getDeviceDisplayName(
        device.ad_data.local_name ?? undefined,
        device.ad_data.manufacturer_data,
        device.ad_data.service_uuids,
      ),
      protocol_hints: getProtocolHints(
        device.ad_data.manufacturer_data,
        device.ad_data.service_uuids,
        device.ad_data.service_data,
      ),
      manufacturer: getManufacturerInfo(device.ad_data.manufacturer_data),
      flags: device.ad_data.flags ?? null,
      tx_power: device.ad_data.tx_power ?? null,
      address_type: device.ad_data.address_type ?? null,
      class: device.ad_data.class ?? null,
      local_name_length: device.ad_data.local_name_length ?? null,
      ad_structure_count: device.ad_data.ad_structure_count ?? null,
      manufacturer_count: device.ad_data.manufacturer_count ?? null,
      service_uuid_count: device.ad_data.service_uuid_count ?? null,
      service_data_count: device.ad_data.service_data_count ?? null,
      ad_structures: device.ad_data.ad_structures ?? {},
      service_data: device.ad_data.service_data,
      service_uuids: device.ad_data.service_uuids,
      raw_hex: device.raw_hex,
      quality: historyByFingerprint[device.fingerprint]?.quality ?? null,
    }));

    if (format === "json") {
      const blob = new Blob([JSON.stringify({ exported_at: Date.now(), live, ghost_list: ghostList }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ghost-hunter-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const header = [
      "fingerprint",
      "alias",
      "timestamp",
      "rssi",
      "mac_address",
      "display_name",
      "protocol_hints",
      "manufacturer",
      "flags",
      "tx_power",
      "address_type",
      "class",
      "local_name_length",
      "ad_structure_count",
      "manufacturer_count",
      "service_uuid_count",
      "service_data_count",
      "service_uuids",
      "service_data",
      "quality_score",
      "avg_ads_per_sec",
      "payload_change_rate",
      "rssi_span",
      "rssi_history",
      "payload_history",
      "raw_hex",
    ];
    const rows = live.map((row) =>
      [
        row.fingerprint,
        row.alias ?? "",
        String(row.timestamp),
        String(row.rssi),
        row.mac_address ?? "",
        row.display_name,
        row.protocol_hints.join("|"),
        row.manufacturer,
        row.flags ?? "",
        row.tx_power ?? "",
        row.address_type ?? "",
        row.class ?? "",
        row.local_name_length ?? "",
        row.ad_structure_count ?? "",
        row.manufacturer_count ?? "",
        row.service_uuid_count ?? "",
        row.service_data_count ?? "",
        row.service_uuids.join("|"),
        JSON.stringify(row.service_data),
        row.quality?.stability_score ?? "",
        row.quality?.avg_advertisements_per_second ?? "",
        row.quality?.payload_change_rate ?? "",
        row.quality?.rssi_span ?? "",
        JSON.stringify(row.history?.rssi_history ?? []),
        JSON.stringify(row.history?.payload_history ?? []),
        row.raw_hex,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ghost-hunter-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const startScan = async () => {
    setErrorMessage(null);
    setScanState("starting");

    try {
      await invoke("start_scan", {
        options: {
          adapter_id: selectedAdapter === "auto" ? null : selectedAdapter,
          scan_mode: "passive",
        },
      });
      setScanState("scanning");
    } catch (error) {
      setScanState("idle");
      setErrorMessage(String(error));
    }
  };

  const stopScan = async () => {
    setErrorMessage(null);
    setScanState("stopping");

    try {
      await invoke("stop_scan");
      setScanState("idle");
    } catch (error) {
      setScanState("scanning");
      setErrorMessage(String(error));
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_35%),linear-gradient(180deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-3xl border border-sky-400/15 bg-slate-950/70 p-6 shadow-glow backdrop-blur xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-sky-300/80">Ghost Hunter</p>
            <h1 title="Detects and tracks all Bluetooth Low Energy devices nearby. Each device gets a unique fingerprint ID so you can identify it even if it hides its wireless address for privacy." className="font-display text-4xl font-semibold tracking-tight text-white">BLE fingerprint scanner</h1>
            <p title="All data stays on your computer. No information is sent to the internet. Complete privacy guaranteed." className="max-w-2xl text-sm text-slate-300">
              Cross-platform BLE advertisement capture with local fingerprinting, SQLite history, and a normalized raw payload view.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedAdapter}
              onChange={(event) => setSelectedAdapter(event.target.value)}
              className="rounded-full border border-white/15 bg-slate-950/70 px-4 py-2 text-xs text-slate-200"
              title="Which Bluetooth adapter to use for scanning. 'Auto' scans on all detected adapters in passive mode."
            >
              <option value="auto">Auto adapter</option>
              {adapters.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.name}
                </option>
              ))}
            </select>
            <div
              className="rounded-full border border-emerald-400/35 bg-emerald-400/10 px-4 py-2 text-xs text-emerald-100"
              title="Passive-only mode is enforced for safety. No active scan requests, no pairing, no connections."
            >
              Passive-only policy
            </div>
            <button
              title="Start scanning for nearby Bluetooth devices. Will detect all devices advertising in range."
              className="rounded-full border border-sky-400/40 bg-sky-400/15 px-5 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={scanState === "starting" || scanState === "scanning"}
              onClick={() => void startScan()}
            >
              {scanState === "starting" ? "Starting..." : "Start scan"}
            </button>
            <button
              title="Stop scanning. No new devices will be detected after this."
              className="rounded-full border border-rose-400/40 bg-rose-400/10 px-5 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={scanState === "idle" || scanState === "stopping"}
              onClick={() => void stopScan()}
            >
              {scanState === "stopping" ? "Stopping..." : "Stop scan"}
            </button>
            <div title="Device count and current performance metrics" className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 font-mono text-xs text-emerald-200">
              {deviceList.length} devices {perfMetrics.uiFreezeDetected && <span className="text-amber-300">⚠</span>}
            </div>
            {scanState === "scanning" && (
              <div title={`Events/sec: ${perfMetrics.eventsPerSecond}, Avg frame: ${perfMetrics.averageFrameTime}ms, Max: ${perfMetrics.maxFrameTime}ms`} className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-2 font-mono text-xs text-sky-200">
                {perfMetrics.eventsPerSecond} evt/s
              </div>
            )}
            <button
              title="Download all detected devices as JSON file (machine-readable format with complete data)"
              className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-xs text-indigo-100 transition hover:bg-indigo-400/20"
              onClick={() => void exportData("json")}
            >
              Export JSON
            </button>
            <button
              title="Download all detected devices as CSV file (spreadsheet format, easier to open in Excel)"
              className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-4 py-2 text-xs text-indigo-100 transition hover:bg-indigo-400/20"
              onClick={() => void exportData("csv")}
            >
              Export CSV
            </button>
          </div>
        </header>

        {errorMessage ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{errorMessage}</div>
        ) : null}

        <section className="grid flex-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4 shadow-glow backdrop-blur">
            <div className="mb-4 flex items-center justify-between px-2">
              <h2 title="All Bluetooth devices currently in range. Each device is identified by a unique fingerprint to track it even when the wireless address changes for privacy." className="font-display text-xl text-white">Live devices</h2>
              <span title="RSSI (Received Signal Strength Indicator): signal strength in dBm. Lower numbers (more negative) mean weaker signal / further away." className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">RSSI stream</span>
            </div>

            <div className="mb-4 grid gap-3 rounded-2xl border border-white/5 bg-slate-900/40 p-3 md:grid-cols-3">
              <label title="Only show devices with signal strength stronger than this value. Move slider left to see weaker/distant devices, right to see only strong nearby devices." className="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                Min RSSI
                <input
                  type="range"
                  min={-120}
                  max={-30}
                  value={minRssiFilter}
                  onChange={(event) => setMinRssiFilter(Number(event.target.value))}
                />
                <span className="font-mono text-slate-300">{minRssiFilter} dBm</span>
              </label>

              <label title="Filter to show only devices from specific manufacturers (Apple, Microsoft, Google, etc.). Use to focus on particular brands or vendors." className="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                Manufacturer
                <select
                  title="Choose a manufacturer to filter devices"
                  value={manufacturerFilter}
                  onChange={(event) => setManufacturerFilter(event.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-200"
                >
                  <option value="all">All manufacturers</option>
                  {manufacturerOptions.map(([manufacturerId, manufacturerName]) => (
                    <option key={manufacturerId} value={manufacturerId}>
                      {manufacturerName} ({manufacturerId})
                    </option>
                  ))}
                </select>
              </label>

              <label title="Filter to show only devices offering specific Bluetooth services or capabilities (Heart Rate, Battery, HID, etc.). Useful to find specific device types." className="flex flex-col gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                Service UUID
                <select
                  title="Choose a service type to filter devices"
                  value={serviceFilter}
                  onChange={(event) => setServiceFilter(event.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-200"
                >
                  <option value="all">All services</option>
                  {serviceOptions.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/5">
              <table className="min-w-full divide-y divide-white/5 text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-[0.25em] text-slate-400">
                  <tr>
                    <th title="Device name or type (inferred from broadcast data or manufacturer)" className="px-4 py-3">Device</th>
                    <th title="Unique fingerprint ID - stable even when wireless address changes for privacy" className="px-4 py-3">Fingerprint</th>
                    <th title="Signal strength (dBm): higher/less negative = stronger signal = closer device" className="px-4 py-3">RSSI</th>
                    <th title="When this device was last detected" className="px-4 py-3">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-slate-900/40 text-slate-200">
                  {deviceList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-slate-400">
                        Start scanning to populate nearby BLE devices.
                      </td>
                    </tr>
                  ) : (
                    deviceList.map((device) => {
                      const isSelected = device.fingerprint === selectedFingerprint;
                      const inferredName = getDeviceDisplayName(
                        device.ad_data.local_name ?? undefined,
                        device.ad_data.manufacturer_data,
                        device.ad_data.service_uuids,
                      );
                      const displayName = aliasByFingerprint[device.fingerprint] ?? inferredName;
                      const manufacturerInfo = getManufacturerInfo(device.ad_data.manufacturer_data);

                      return (
                        <tr
                          key={device.fingerprint}
                          className={isSelected ? "bg-sky-400/10" : "hover:bg-white/5"}
                          onClick={() => setSelectedFingerprint(device.fingerprint)}
                        >
                          <td className="cursor-pointer px-4 py-3">
                            <div className="font-medium text-white">{displayName}</div>
                            <div className="font-mono text-xs text-slate-400">{device.mac_address ?? "macOS/private"}</div>
                            {manufacturerInfo && (
                              <div className="mt-1 font-mono text-xs text-sky-300/70">{manufacturerInfo}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">{device.fingerprint.slice(0, 20)}...</td>
                          <td className="px-4 py-3 font-mono text-emerald-300">{formatRssi(device.rssi)}</td>
                          <td className="px-4 py-3 text-slate-400">{new Date(device.timestamp * 1000).toLocaleTimeString()}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 title="Devices that were detected but then disappeared (haven't been seen for 30+ seconds)" className="font-display text-sm text-amber-100">Ghost list</h3>
                <span title="Number of missing devices" className="font-mono text-xs text-amber-200/80">{ghostList.length} lost</span>
              </div>

              {ghostList.length === 0 ? (
                <p className="text-xs text-slate-400">No devices have disappeared in the last scan session.</p>
              ) : (
                <ul className="space-y-2">
                  {ghostList.slice(0, 8).map((ghost) => (
                    <li key={ghost.fingerprint} className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                      <div className="font-mono text-xs text-slate-200">{ghost.fingerprint.slice(0, 20)}...</div>
                      <div className="text-xs text-slate-400">
                        Lost at {new Date(ghost.last_seen * 1000).toLocaleTimeString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <aside className="flex min-h-[24rem] flex-col rounded-3xl border border-white/10 bg-slate-950/60 p-4 shadow-glow backdrop-blur">
            <div className="mb-4 px-2">
              <h2 title="Detailed view of the selected device's broadcast information. Shows all metadata and raw bytes." className="font-display text-xl text-white">Payload inspector</h2>
              <p title="Click on device above to select it and see detailed information here" className="mt-1 text-sm text-slate-400">Selected device metadata and reconstructed advertisement payload.</p>
            </div>

            {selectedDevice ? (
              <div className="flex flex-1 flex-col gap-4">
                <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 text-sm text-slate-200">
                  <p title="Give this device a friendly name for easy identification (e.g., 'Kitchen Speaker', 'My Watch')" className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Alias</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={aliasDraft}
                      onChange={(event) => setAliasDraft(event.target.value)}
                      placeholder="Set alias for selected fingerprint"
                      className="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                    />
                    <button
                      onClick={() => void saveAlias()}
                      className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100"
                    >
                      Save
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 rounded-2xl border border-white/5 bg-slate-900/40 p-4 text-sm text-slate-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div title="First timestamp when this device fingerprint was observed">
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">First seen</p>
                      <p className="mt-1 text-white">{selectedHistory ? new Date(selectedHistory.first_seen * 1000).toLocaleTimeString() : "-"}</p>
                    </div>
                    <div title="Number of times this device fingerprint has been detected">
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Seen count</p>
                      <p className="mt-1 text-white">{selectedHistory?.seen_count ?? 0}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div title="Derived quality score for this device fingerprint, based on RSSI span and payload stability over time.">
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Quality score</p>
                      <p className="mt-1 text-white">{selectedHistory?.quality?.stability_score ?? 0}/100</p>
                    </div>
                    <div title="Average observed advertisement frequency for this fingerprint.">
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Ad rate</p>
                      <p className="mt-1 text-white">{(selectedHistory?.quality?.avg_advertisements_per_second ?? 0).toFixed(2)} / sec</p>
                    </div>
                  </div>
                  <div title="Friendly name advertised by the device, if available">
                    <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Local name</p>
                    <p className="mt-1 text-white">{selectedDevice.ad_data.local_name ?? "Unavailable"}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div title="AD Flags field (0x01): indicates device discoverability and mode">
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Flags</p>
                      <p className="mt-1 text-white">
                        {selectedDevice.ad_data.flags != null
                          ? `0x${selectedDevice.ad_data.flags.toString(16).toUpperCase().padStart(2, "0")}`
                          : "Unavailable"}
                      </p>
                    </div>
                    <div title="Transmit power level in dBm, used to estimate distance">
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">TX power</p>
                      <p className="mt-1 text-white">{selectedDevice.ad_data.tx_power != null ? `${selectedDevice.ad_data.tx_power} dBm` : "Unavailable"}</p>
                    </div>
                    <div title="Address type: public (fixed) or random (privacy)">
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Address type</p>
                      <p className="mt-1 text-white">{selectedDevice.ad_data.address_type ?? "Unavailable"}</p>
                    </div>
                  </div>
                  <div title="Class of Device (CoD) from classic Bluetooth, if present">
                    <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Class</p>
                    <p className="mt-1 text-white">{selectedDevice.ad_data.class ?? "Unavailable"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3" title="Advertisement structure counters extracted from AD fields.">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">AD structures</p>
                      <p className="mt-1 text-white">{selectedDevice.ad_data.ad_structure_count ?? 0}</p>
                    </div>
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Name length</p>
                      <p className="mt-1 text-white">{selectedDevice.ad_data.local_name_length ?? 0}</p>
                    </div>
                  </div>
                  <div title="Detected device types and protocols (Apple, Microsoft, etc.)">
                    <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Protocol hints</p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-300">
                      {getProtocolHints(
                        selectedDevice.ad_data.manufacturer_data,
                        selectedDevice.ad_data.service_uuids,
                        selectedDevice.ad_data.service_data,
                      ).join(" | ") || "Unavailable"}
                    </p>
                  </div>
                  <div title="GATT service UUIDs that the device advertises">
                    <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Service UUIDs</p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-300">
                      {selectedDevice.ad_data.service_uuids.length > 0
                        ? selectedDevice.ad_data.service_uuids.join(", ")
                        : "Unavailable"}
                    </p>
                  </div>
                  <div title="Service Data field (0x16): service-specific data with UUID">
                    <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Service data</p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-300">
                      {Object.keys(selectedDevice.ad_data.service_data).length > 0
                        ? Object.entries(selectedDevice.ad_data.service_data)
                            .map(([service, payload]) =>
                              `${service}: ${payload.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
                            )
                            .join(" | ")
                        : "Unavailable"}
                    </p>
                  </div>
                  <div title="Manufacturer Specific Data field (0xFF): vendor-specific payload">
                    <p className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Manufacturer</p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-300">
                      {getManufacturerInfo(selectedDevice.ad_data.manufacturer_data) || "No manufacturer data"}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-300/10 bg-black/30 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span title="Real-time signal strength history: shows how the device's signal varied over last ~60 measurements. Wavy line means moving/changing distance." className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">RSSI history</span>
                    <span title="How many data points are shown in the graph" className="font-mono text-xs text-slate-400">Last {Math.min(60, selectedRssiPoints.length)} points</span>
                  </div>
                  {rssiSparkline ? (
                    <svg viewBox="0 0 100 100" className="h-24 w-full rounded bg-slate-950/70 p-2">
                      <polyline
                        points={rssiSparkline}
                        fill="none"
                        stroke="rgb(56 189 248)"
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <p className="text-xs text-slate-400">No history yet for this fingerprint.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-amber-300/20 bg-amber-400/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span title="Byte-by-byte comparison: shows which bytes changed between the last two samples. Highlighted bytes indicate they were different." className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Payload diff</span>
                    <span title="How many bytes are different between last two samples" className="font-mono text-xs text-slate-400">
                      {payloadDiff ? `${payloadDiff.changedCount} bytes changed` : "Waiting for second sample"}
                    </span>
                  </div>

                  {payloadDiff ? (
                    <>
                      <p className="mb-3 text-xs text-slate-400">
                        Comparing {new Date(payloadDiff.previous.timestamp * 1000).toLocaleTimeString()} to{" "}
                        {new Date(payloadDiff.latest.timestamp * 1000).toLocaleTimeString()}
                      </p>
                      <div className="max-h-28 overflow-auto rounded-lg border border-white/10 bg-slate-950/70 p-2 font-mono text-xs leading-6">
                        {payloadDiff.entries.map((entry) => (
                          <span
                            key={`${entry.index}-${entry.currentByte}`}
                            className={entry.changed ? "mr-1 rounded bg-amber-300/20 px-1 text-amber-100" : "mr-1 px-1 text-slate-400"}
                            title={`Byte ${entry.index}: ${entry.oldByte} -> ${entry.currentByte}`}
                          >
                            {entry.currentByte}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">Need at least two payload samples for this fingerprint.</p>
                  )}

                  {payloadChangeHeat ? (
                    <div className="mt-3">
                      <p title="Heatmap showing which bytes change frequently: darker=rarely changes, brighter=frequently changes. Shows stability of device's broadcast data." className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                        Change heat ({payloadChangeHeat.comparisons} transitions)
                      </p>
                      <div className="max-h-20 overflow-auto rounded-lg border border-white/10 bg-slate-950/70 p-2">
                        <div className="flex gap-[2px]">
                          {payloadChangeHeat.changedCounts.map((count, index) => {
                            const intensity = count / payloadChangeHeat.maxCount;
                            return (
                              <div
                                key={`${index}-${count}`}
                                className="h-10 w-2 rounded-sm"
                                style={{
                                  backgroundColor: `rgba(251, 191, 36, ${0.12 + intensity * 0.88})`,
                                }}
                                title={`Byte ${index}: changed ${count} times`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex-1 rounded-2xl border border-sky-300/10 bg-black/30 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span title="Raw hexadecimal representation of the device's full advertisement data. Shows every byte in the payload." className="font-mono text-xs uppercase tracking-[0.25em] text-slate-500">Raw hex dump</span>
                    <span title="Hex data is normalized to show AD (Advertisement Data) fields with structure" className="font-mono text-xs text-slate-400">AD len/type normalized</span>
                  </div>
                  <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-sm leading-7 text-sky-100">
                    {selectedDevice.raw_hex || "No payload bytes available"}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-400">
                Select a device to inspect its payload.
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}

export default App;