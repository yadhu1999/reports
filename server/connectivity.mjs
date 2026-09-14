// Snapshot-relative connectivity: never confuse provisioning state with online status.
export const connectivityDescription =
  'Derived from Last Seen at the snapshot timestamp: Online ≤30 minutes, Idle >30 minutes to 24 hours, Offline >24 hours; missing or invalid timestamps are Unknown.';
export const connectivitySQL = `(CASE
  WHEN TRY_CAST(devices.last_seen AS TIMESTAMP) IS NULL OR devices.report_generation_timestamp IS NULL THEN 'Unknown'
  WHEN TRY_CAST(devices.last_seen AS TIMESTAMP) >= devices.report_generation_timestamp - INTERVAL 30 MINUTES THEN 'Online'
  WHEN TRY_CAST(devices.last_seen AS TIMESTAMP) >= devices.report_generation_timestamp - INTERVAL 24 HOURS THEN 'Idle'
  ELSE 'Offline'
END)`;
export function connectivityStatus(lastSeen, snapshotTimestamp) {
  if (!lastSeen || !snapshotTimestamp) return 'Unknown';
  const seen = Date.parse(lastSeen),
    snapshot = Date.parse(snapshotTimestamp);
  if (!Number.isFinite(seen) || !Number.isFinite(snapshot)) return 'Unknown';
  const age = snapshot - seen;
  return age <= 30 * 60000 ? 'Online' : age <= 24 * 3600000 ? 'Idle' : 'Offline';
}
