#!/usr/bin/env python3
"""Verhoek SFTP-uploader — draait vanaf de Windows-machine, NIET vanuit Supabase.

Waarom buiten de edge-runtime: Verhoeks SFTP-server biedt alleen legacy
CTR/CBC-ciphers. De Deno edge-runtime (ssh2) kan geen aes256-ctr instantiëren,
dus `verhoek-send` kan principieel niet uploaden (Rhenus werkt wel — die doet
GCM). paramiko ondersteunt aes256-ctr wel. Daarom verschuift ALLEEN de
byte-push hierheen; XML-bouw, queue, audit en storage blijven in Supabase.

Gebruik:
  python verhoek_sftp.py test [bestand]   # connectie-test: upload een .txt
                                          #   (Verhoek verwerkt alleen .xml/.pdf,
                                          #   dus een .txt test puur de verbinding)
  python verhoek_sftp.py put <bestand>    # upload één bestand (bv. een proef-XML)

Credentials via env-vars of via import/.verhoek.env (regels KEY=VALUE):
  VERHOEK_SFTP_HOST
  VERHOEK_SFTP_PORT        (default 22)
  VERHOEK_SFTP_USER
  VERHOEK_SFTP_PASSWORD
  VERHOEK_SFTP_REMOTE_DIR  (upload-map, bv. karpi_to_verhoek)

ponytail: queue-drain (storage-map -> SFTP) komt pas nadat de connectie-test
slaagt — geen zin die te bouwen tegen een nog-onbewezen verbinding.
"""
import os
import posixpath
import sys

import paramiko

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load_env():
    """Laad import/.verhoek.env (gitignored) als env-vars nog niet gezet zijn."""
    path = os.path.join(_HERE, ".verhoek.env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())


def _cfg():
    _load_env()
    required = ("VERHOEK_SFTP_HOST", "VERHOEK_SFTP_USER",
                "VERHOEK_SFTP_PASSWORD", "VERHOEK_SFTP_REMOTE_DIR")
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        sys.exit(
            "Ontbrekende credentials: " + ", ".join(missing) +
            "\nZet ze in import/.verhoek.env (KEY=VALUE per regel) of als env-var."
        )
    return {
        "host": os.environ["VERHOEK_SFTP_HOST"],
        "port": int(os.environ.get("VERHOEK_SFTP_PORT", "22")),
        "user": os.environ["VERHOEK_SFTP_USER"],
        "pw": os.environ["VERHOEK_SFTP_PASSWORD"],
        "remote": os.environ["VERHOEK_SFTP_REMOTE_DIR"],
    }


def upload(local_path, remote_name=None):
    if not os.path.exists(local_path):
        sys.exit(f"Bestand niet gevonden: {local_path}")
    c = _cfg()
    remote_name = remote_name or os.path.basename(local_path)
    remote_path = posixpath.join(c["remote"], remote_name)

    transport = paramiko.Transport((c["host"], c["port"]))
    try:
        transport.connect(username=c["user"], password=c["pw"])
        # Toon de onderhandelde cipher — dit is het hele punt van de exercitie.
        print(f"Verbonden met {c['host']}:{c['port']} als {c['user']}")
        print(f"  cipher c->s: {transport.local_cipher}  |  s->c: {transport.remote_cipher}")
        sftp = paramiko.SFTPClient.from_transport(transport)
        sftp.put(local_path, remote_path)
        print(f"OK — geüpload naar {remote_path}")
    finally:
        transport.close()


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "test":
        local = sys.argv[2] if len(sys.argv) > 2 else os.path.join(_HERE, "verhoek_verbindingstest.txt")
        if not os.path.exists(local):
            with open(local, "w", encoding="utf-8") as fh:
                fh.write("Karpi B.V. - verbindingstest Verhoek SFTP.\n"
                         "Dit .txt-bestand dient alleen om de SFTP-verbinding te testen "
                         "en wordt door Verhoek niet verwerkt.\n")
        upload(local)
    elif cmd == "put" and len(sys.argv) > 2:
        upload(sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
