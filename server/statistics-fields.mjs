// Verified JSON paths; clients choose field IDs, never arbitrary JSON paths.
export const statisticsFields = [
  ...[
    'units',
    'total_memory',
    'used_memory',
    'total_swap_memory',
    'available_swap_memory',
    'used_swap_memory',
    'total_internal_storage',
    'used_internal_storage',
  ].map((key) => ({
    id: `memory_${key}`,
    blob: 'memory_stats',
    path: key,
    type: 'string',
    category: 'Memory Details',
    label:
      key === 'units'
        ? 'Memory Units'
        : key.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + ' (reported units)',
  })),
  ...[
    'battery_state',
    'battery_health',
    'battery_present',
    'battery_technology',
    'battery_percentage',
    'battery_energy',
    'battery_voltage',
    'battery_energy_full',
    'battery_energy_full_design',
    'battery_temperature',
  ].map((key) => ({
    id: key,
    blob: 'battery_stats',
    path: key,
    type: [
      'battery_percentage',
      'battery_energy',
      'battery_voltage',
      'battery_energy_full',
      'battery_energy_full_design',
      'battery_temperature',
    ].includes(key)
      ? 'number'
      : 'string',
    category: 'Battery Details',
    label:
      key.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) +
      ([
        'battery_energy',
        'battery_voltage',
        'battery_energy_full',
        'battery_energy_full_design',
        'battery_temperature',
      ].includes(key)
        ? ' (reported units)'
        : ''),
  })),
  ...[
    ['network_connection', 'current_active_connection', 'Active Connection', 'string'],
    ['cellular_type', 'cellular_network_info.networkType', 'Cellular Network Type', 'string'],
    ['cellular_sim_count', 'cellular_network_info.numberOfSim', 'SIM Count', 'number'],
    ['cellular_sim_operator', 'cellular_network_info.simOperator', 'SIM Operator', 'string'],
    [
      'cellular_signal',
      'cellular_network_info.signalStrength',
      'Cellular Signal Strength (reported units)',
      'string',
    ],
    ['cellular_operator', 'cellular_network_info.networkOperator', 'Network Operator', 'string'],
    [
      'cellular_status',
      'cellular_network_info.mobileNetworkStatus',
      'Mobile Network Status',
      'string',
    ],
    ['cellular_ipv4', 'cellular_network_info.mobileIPv4', 'Mobile IPv4', 'string'],
    ['cellular_ipv6', 'cellular_network_info.mobileIPv6', 'Mobile IPv6', 'string'],
  ].map(([id, path, label, type]) => ({
    id,
    blob: 'network_stats',
    path,
    label,
    type,
    category: 'Network Details',
  })),
].map((f) => ({
  ...f,
  derived: true,
  description: `From ${f.blob}, ${f.path}. Missing values remain empty. ${f.label.includes('reported units') ? 'Original reported units; no conversion is applied.' : ''}`,
}));
export const jsonValue = (blob, path) => `get_json_object(device_stats.${blob}, '$.${path}')`;
export const statisticsFieldSQL = Object.fromEntries(
  statisticsFields.map((f) => [
    f.id,
    f.type === 'number'
      ? `TRY_CAST(${jsonValue(f.blob, f.path)} AS DOUBLE)`
      : jsonValue(f.blob, f.path),
  ]),
);
export function expandStatistics(row) {
  const blobs = {};
  for (const blob of ['memory_stats', 'battery_stats', 'network_stats', 'location_stats']) {
    try {
      blobs[blob] = JSON.parse(row[blob]);
    } catch {
      blobs[blob] = null;
    }
  }
  const value = (blob, path) => path.split('.').reduce((v, key) => v?.[key], blobs[blob]);
  const text = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const number = (v) =>
    v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const out = { ...row };
  for (const f of statisticsFields) {
    const v = value(f.blob, f.path);
    out[f.id] = f.type === 'number' ? number(v) : text(v);
  }
  for (const [id, blob, path] of [
    ['battery', 'battery_stats', 'battery_level'],
    ['wifi_ssid', 'network_stats', 'wifi_network_info.wifi_ssid'],
    ...['available_ram', 'os_occupied_storage', 'available_internal_storage'].map((id) => [
      id,
      'memory_stats',
      id,
    ]),
    ...['latitude', 'longitude', 'altitude'].map((id) => [id, 'location_stats', id]),
  ])
    if (out[id] == null)
      out[id] = ['battery', 'latitude', 'longitude', 'altitude'].includes(id)
        ? number(value(blob, path))
        : text(value(blob, path));
  return out;
}
