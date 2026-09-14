import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import path from 'node:path';

export function tenantEndpoint(value) {
  const tenant = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenant))
    throw Error('Enter the tenant name from your Esper console URL, such as acme.');
  return { tenant, baseUrl: `https://${tenant}-api.esper.cloud/api/data-tap/v0` };
}

// Separate from report definitions; only encrypted credentials are persisted.
export function connectionStore(directory) {
  const keyFile = path.join(directory, 'connection.key');
  const file = path.join(directory, 'connections.json');
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  chmodSync(keyFile, 0o600);
  const key = readFileSync(keyFile);
  const records = new Map(
    existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, 'utf8'))) : [],
  );
  function read(workspace) {
    const record = records.get(workspace);
    if (!record || !record.enabled) return record;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(workspace));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const apiKey = Buffer.concat([
      decipher.update(Buffer.from(record.encrypted, 'base64')),
      decipher.final(),
    ]).toString();
    return {
      tenant: record.tenant,
      baseUrl: record.baseUrl,
      apiKey,
      updated_at: record.updated_at,
      enabled: true,
    };
  }
  function write(workspace, connection) {
    let record = { enabled: false, updated_at: new Date().toISOString() };
    if (connection) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(workspace));
      const encrypted = Buffer.concat([cipher.update(connection.apiKey, 'utf8'), cipher.final()]);
      record = {
        ...record,
        enabled: true,
        tenant: connection.tenant,
        baseUrl: connection.baseUrl,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        encrypted: encrypted.toString('base64'),
      };
    }
    const next = new Map(records);
    next.set(workspace, record);
    writeFileSync(file + '.tmp', JSON.stringify(Object.fromEntries(next), null, 2), {
      mode: 0o600,
    });
    renameSync(file + '.tmp', file);
    records.set(workspace, record);
  }
  return { read, write };
}

export function connectionCandidate(body, existing) {
  const endpoint = tenantEndpoint(body?.tenant);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const retained =
    existing?.apiKey &&
    (existing.tenant === endpoint.tenant || existing.baseUrl === endpoint.baseUrl);
  const credential = apiKey || (retained ? existing.apiKey : '');
  if (!credential || credential.length > 8192 || /[\s\x00-\x1f\x7f]/.test(credential))
    throw Error('Enter a valid API key. A key is required when changing tenants.');
  return { ...endpoint, apiKey: credential };
}
