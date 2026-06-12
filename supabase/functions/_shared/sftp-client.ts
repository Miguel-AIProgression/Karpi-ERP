// Dunne SFTP-wrapper voor de sftp-vervoerder-adapters (verhoek-send,
// rhenus-send). Bewust geïsoleerd: als de runtime ssh2 niet draait, is dít de
// enige module die vervangen wordt (fallback: n8n-SFTP-workflow of
// Python-worker die dezelfde adapter-wachtrijen leegt).
// Geëxtraheerd uit verhoek-send (ADR-0031 Taak 9) → _shared bij de komst van
// Rhenus als tweede SFTP-vervoerder (ADR-0032). Gedrag ongewijzigd.

import { Buffer } from 'node:buffer';
import SftpClient from 'npm:ssh2-sftp-client@11';

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  remoteDir: string; // upload-map op de server, bv. '/in'
}

export interface SftpUploadResult {
  ok: boolean;
  remotePad: string | null;
  errorMsg: string | null;
}

export async function uploadXmlViaSftp(
  cfg: SftpConfig,
  bestandsnaam: string,
  xml: string,
): Promise<SftpUploadResult> {
  const sftp = new SftpClient();
  const remotePad = `${cfg.remoteDir.replace(/\/+$/, '')}/${bestandsnaam}`;
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      readyTimeout: 15_000,
    });
    await sftp.put(Buffer.from(xml, 'utf-8'), remotePad);
    return { ok: true, remotePad, errorMsg: null };
  } catch (err) {
    return { ok: false, remotePad: null, errorMsg: String(err) };
  } finally {
    try {
      await sftp.end();
    } catch (_) { /* verbinding was al weg */ }
  }
}

// Runtime-bewijs zonder schrijfrechten: connect + handshake + listing.
export async function testSftpVerbinding(
  cfg: Omit<SftpConfig, 'remoteDir'> & { listDir?: string },
): Promise<{ ok: boolean; entries: number; errorMsg: string | null }> {
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      readyTimeout: 15_000,
    });
    const lijst = await sftp.list(cfg.listDir ?? '/');
    return { ok: true, entries: lijst.length, errorMsg: null };
  } catch (err) {
    return { ok: false, entries: 0, errorMsg: String(err) };
  } finally {
    try {
      await sftp.end();
    } catch (_) { /* verbinding was al weg */ }
  }
}
