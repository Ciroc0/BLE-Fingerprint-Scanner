// Lazy-loaded signature data from JSON files
let cachedSignatures: {
  manufacturerIds?: Record<string, string>;
  appleFrameHints?: Record<number, string>;
  serviceTypeHints?: Record<string, string>;
  serviceProtocolHints?: Record<string, string>;
} = {};

async function loadSignatureData(type: "manufacturer-ids" | "apple-frame-hints" | "service-type-hints" | "service-protocol-hints") {
  try {
    const response = await fetch(`/data/${type}.json`);
    return await response.json();
  } catch (error) {
    console.warn(`[Signatures] Failed to load ${type}.json, using fallback`);
    return null;
  }
}

// Fallbacks if JSON files fail to load
const FALLBACK_MANUFACTURER_IDS: Record<string, string> = {
  "0x004C": "Apple",
  "0x0006": "Microsoft",
  "0x01FF": "Tile",
  "0x0059": "Nordic",
  "0x004F": "Hewlett-Packard",
  "0x0075": "Samsung",
  "0x0088": "Logitech",
  "0x00D5": "Garmin",
  "0x0106": "Jawbone",
  "0x0109": "GoPro",
  "0x010F": "Fitbit",
  "0x0131": "Sony",
  "0x0158": "Google",
  "0x0171": "Plantronics",
  "0x0177": "Sennheiser",
  "0x019C": "AirWatch",
  "0x01A0": "ResMed",
  "0x01AF": "Motorola",
  "0x01B3": "Oticon",
  "0x01B9": "Abbott",
  "0x01BA": "INSIDE Secure",
  "0x01BB": "InControl",
  "0x01BC": "Alpine",
  "0x01BD": "Seabird Technology",
  "0x01D1": "iDevicesinc",
  "0x01D5": "Vocera",
  "0x01DF": "Arundo",
  "0x01ED": "Google",
  "0x0214": "Amazon",
};

const FALLBACK_APPLE_FRAME_HINTS: Record<number, string> = {
  0x02: "Apple iBeacon",
  0x05: "Apple AirTag",
  0x07: "Apple AirPods",
  0x10: "Apple Nearby Device",
  0x12: "Apple Continuity Device",
  0x16: "Apple Find My Device",
};

const FALLBACK_SERVICE_TYPE_HINTS: Record<string, string> = {
  "180a": "Device Info",
  "180d": "Heart Rate",
  "180f": "Battery",
  "1805": "Current Time",
  "1812": "HID",
  "181a": "Environmental Sensing",
  "181e": "IPS",
  "181f": "Pulse Oximetry",
  "1820": "Fitness",
  "183a": "Generic Media Control",
  "183b": "Constant Tone Extension",
};

const FALLBACK_SERVICE_PROTOCOL_HINTS: Record<string, string> = {
  "0000180d-0000-1000-8000-00805f9b34fb": "Heart Rate Service",
  "0000180f-0000-1000-8000-00805f9b34fb": "Battery Service",
  "00001812-0000-1000-8000-00805f9b34fb": "HID Device",
  "00001816-0000-1000-8000-00805f9b34fb": "Cycling Speed/Cadence",
  "0000181a-0000-1000-8000-00805f9b34fb": "Environmental Sensor",
  "0000feaa-0000-1000-8000-00805f9b34fb": "Eddystone Beacon",
  "0000fe2c-0000-1000-8000-00805f9b34fb": "Fast Pair Service",
  "0000fd6f-0000-1000-8000-00805f9b34fb": "Nearby Interaction",
};

// Helper to get cached or load signature data
async function getSignatureData(type: "manufacturerIds" | "appleFrameHints" | "serviceTypeHints" | "serviceProtocolHints") {
  if (cachedSignatures[type]) {
    return cachedSignatures[type];
  }

  const fileMap = {
    manufacturerIds: "manufacturer-ids",
    appleFrameHints: "apple-frame-hints",
    serviceTypeHints: "service-type-hints",
    serviceProtocolHints: "service-protocol-hints",
  };

  const loaded = await loadSignatureData(fileMap[type] as any);
  const fallbackMap = {
    manufacturerIds: FALLBACK_MANUFACTURER_IDS,
    appleFrameHints: FALLBACK_APPLE_FRAME_HINTS,
    serviceTypeHints: FALLBACK_SERVICE_TYPE_HINTS,
    serviceProtocolHints: FALLBACK_SERVICE_PROTOCOL_HINTS,
  };

  const data = loaded || fallbackMap[type];
  cachedSignatures[type] = data;
  return data;
}

// Synchronous wrappers that use fallback if async version hasn't loaded yet
function getManufacturerIdsSyncOrFallback() {
  // Schedule async load for next opportunity
  void getSignatureData("manufacturerIds");
  return (cachedSignatures.manufacturerIds as any) || FALLBACK_MANUFACTURER_IDS;
}

function getAppleFrameHintsSyncOrFallback() {
  void getSignatureData("appleFrameHints");
  return (cachedSignatures.appleFrameHints as any) || FALLBACK_APPLE_FRAME_HINTS;
}

function getServiceTypeHintsSyncOrFallback() {
  void getSignatureData("serviceTypeHints");
  return (cachedSignatures.serviceTypeHints as any) || FALLBACK_SERVICE_TYPE_HINTS;
}

function getServiceProtocolHintsSyncOrFallback() {
  void getSignatureData("serviceProtocolHints");
  return (cachedSignatures.serviceProtocolHints as any) || FALLBACK_SERVICE_PROTOCOL_HINTS;
}

function getAppleDeviceHint(payload: number[]): string {
  if (payload.length === 0) {
    return "Apple Device";
  }

  const frameType = payload[0];
  const frameLength = payload[1] ?? 0;

  if (frameType === 0x12 && frameLength === 0x02) {
    return "Apple Watch or iPhone";
  }

  if (frameType === 0x10 && frameLength >= 0x05) {
    return "Apple Nearby Device";
  }

  const hints = getAppleFrameHintsSyncOrFallback();
  return hints[frameType] ?? `Apple Device (type 0x${frameType.toString(16).toUpperCase().padStart(2, "0")})`;
}

function decodeManufacturerHint(manufacturerId: string, payload: number[]): string | null {
  if (manufacturerId === "0x004C") {
    return getAppleDeviceHint(payload);
  }

  if (manufacturerId === "0x0006" && payload.length >= 2) {
    return "Microsoft Swift Pair Candidate";
  }

  if ((manufacturerId === "0x00E0" || manufacturerId === "0x01ED") && payload.length >= 2) {
    return "Google Fast Pair Candidate";
  }

  if (manufacturerId === "0x01FF") {
    return "Tile Tracker Candidate";
  }

  if (manufacturerId === "0x0075") {
    return "Samsung Accessory Candidate";
  }

  if (manufacturerId === "0x00D5") {
    return "Garmin Sensor Candidate";
  }

  return null;
}

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase();
}

export type DecoderContext = {
  localName?: string;
  manufacturerData: Record<string, number[]>;
  serviceUuids: string[];
  serviceData: Record<string, number[]>;
};

export type DecoderPlugin = {
  id: string;
  getProtocolHints?: (context: DecoderContext) => string[];
  getDeviceDisplayName?: (context: DecoderContext) => string | null;
};

const decoderPlugins: DecoderPlugin[] = [];

function ensureDefaultDecoderPlugin() {
  if (decoderPlugins.some((plugin) => plugin.id === "builtin-heuristics")) {
    if (!decoderPlugins.some((plugin) => plugin.id === "service-data-analyzer")) {
      registerDecoderPlugin({
        id: "service-data-analyzer",
        getProtocolHints: (context) => {
          const hints: string[] = [];

          for (const [serviceUuid, payload] of Object.entries(context.serviceData)) {
            const normalized = normalizeUuid(serviceUuid);

            if (payload.length >= 20) {
              hints.push(`High Entropy Service Payload (${normalized.slice(0, 8)})`);
            }

            if (payload.length === 2 && normalized.endsWith("180f-0000-1000-8000-00805f9b34fb")) {
              hints.push("Battery Level Telemetry");
            }
          }

          return hints;
        },
      });
    }
    return;
  }

  registerDecoderPlugin({
    id: "builtin-heuristics",
    getProtocolHints: (context) => {
      const hints = new Set<string>();

      for (const [manufacturerId, payload] of Object.entries(context.manufacturerData)) {
        const hint = decodeManufacturerHint(manufacturerId, payload);
        if (hint) {
          hints.add(hint);
        }
      }

      const serviceProtocolHints = getServiceProtocolHintsSyncOrFallback();
      for (const serviceUuid of context.serviceUuids) {
        const normalized = normalizeUuid(serviceUuid);
        const known = serviceProtocolHints[normalized];
        if (known) {
          hints.add(known);
        }

        if (normalized.endsWith("180d-0000-1000-8000-00805f9b34fb")) {
          hints.add("Heart Rate Monitor Profile");
        }
      }

      for (const [serviceUuid, payload] of Object.entries(context.serviceData)) {
        const normalized = normalizeUuid(serviceUuid);
        if (normalized === "0000feaa-0000-1000-8000-00805f9b34fb" && payload.length > 0) {
          hints.add("Eddystone Beacon Frame");
        }

        if (normalized === "0000fe2c-0000-1000-8000-00805f9b34fb" && payload.length > 0) {
          hints.add("Fast Pair Service Data");
        }
      }

      return Array.from(hints);
    },
    getDeviceDisplayName: (context) => {
      const manufacturerIds = getManufacturerIdsSyncOrFallback();
      for (const [mfgId, mfgName] of Object.entries(manufacturerIds)) {
        if (context.manufacturerData[mfgId]) {
          if (mfgId === "0x004C") {
            return getAppleDeviceHint(context.manufacturerData[mfgId]);
          }

          const specificHint = decodeManufacturerHint(mfgId, context.manufacturerData[mfgId]);
          if (specificHint) {
            return specificHint;
          }

          return `${mfgName} Device`;
        }
      }

      if (context.serviceUuids.length > 0) {
        const firstService = context.serviceUuids[0].toLowerCase().slice(4, 8);
        const serviceTypeHints = getServiceTypeHintsSyncOrFallback();
        const serviceHint = serviceTypeHints[firstService];
        if (serviceHint) {
          return `${serviceHint} Device`;
        }
      }

      return null;
    },
  });

  registerDecoderPlugin({
    id: "service-data-analyzer",
    getProtocolHints: (context) => {
      const hints: string[] = [];

      for (const [serviceUuid, payload] of Object.entries(context.serviceData)) {
        const normalized = normalizeUuid(serviceUuid);

        if (payload.length >= 20) {
          hints.push(`High Entropy Service Payload (${normalized.slice(0, 8)})`);
        }

        if (payload.length === 2 && normalized.endsWith("180f-0000-1000-8000-00805f9b34fb")) {
          hints.push("Battery Level Telemetry");
        }
      }

      return hints;
    },
  });
}

export function registerDecoderPlugin(plugin: DecoderPlugin): void {
  const existingIndex = decoderPlugins.findIndex((entry) => entry.id === plugin.id);
  if (existingIndex >= 0) {
    decoderPlugins[existingIndex] = plugin;
    return;
  }

  decoderPlugins.push(plugin);
}

export function unregisterDecoderPlugin(id: string): void {
  const index = decoderPlugins.findIndex((plugin) => plugin.id === id);
  if (index >= 0) {
    decoderPlugins.splice(index, 1);
  }
}

export function listDecoderPlugins(): string[] {
  ensureDefaultDecoderPlugin();
  return decoderPlugins.map((plugin) => plugin.id);
}

export function getProtocolHints(
  manufacturerData: Record<string, number[]>,
  serviceUuids: string[],
  serviceData: Record<string, number[]>,
): string[] {
  ensureDefaultDecoderPlugin();
  const hints = new Set<string>();
  const context: DecoderContext = {
    manufacturerData,
    serviceUuids,
    serviceData,
  };

  for (const plugin of decoderPlugins) {
    const pluginHints = plugin.getProtocolHints?.(context) ?? [];
    for (const hint of pluginHints) {
      if (hint) {
        hints.add(hint);
      }
    }
  }

  return Array.from(hints).sort();
}

export function getManufacturerName(manufacturerId: string): string {
  const ids = getManufacturerIdsSyncOrFallback();
  return ids[manufacturerId] || "Unknown";
}

export function getPrimaryManufacturer(manufacturerData: Record<string, number[]>): string | null {
  const first = Object.keys(manufacturerData)[0];
  return first ?? null;
}

export function getDeviceDisplayName(
  localName: string | undefined,
  manufacturerData: Record<string, number[]>,
  serviceUuids: string[],
): string {
  ensureDefaultDecoderPlugin();

  // 1. If there's a local name, use it
  if (localName && localName.trim()) {
    return localName;
  }

  const context: DecoderContext = {
    localName,
    manufacturerData,
    serviceUuids,
    serviceData: {},
  };

  for (const plugin of decoderPlugins) {
    const pluginName = plugin.getDeviceDisplayName?.(context);
    if (pluginName && pluginName.trim()) {
      return pluginName;
    }
  }

  // Fallback
  return "Unnamed Device";
}

export function getManufacturerInfo(manufacturerData: Record<string, number[]>): string {
  const entries = Object.entries(manufacturerData);
  if (entries.length === 0) return "";

  return entries
    .map(([mfgId, data]) => {
      const name = getManufacturerName(mfgId);
      const hex = data.map((b) => b.toString(16).padStart(2, "0")).join(" ");
      if (mfgId === "0x004C") {
        return `${getAppleDeviceHint(data)} (${mfgId}): ${hex}`;
      }
      return `${name} (${mfgId}): ${hex}`;
    })
    .join(" | ");
}
