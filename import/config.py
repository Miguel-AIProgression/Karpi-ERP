"""Supabase connection config for import scripts."""
from pathlib import Path

def _read_env(path):
    env = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                key, val = line.split("=", 1)
                env[key.strip()] = val.strip()
    return env

# Import uses service_role key (bypasses RLS)
_env = _read_env(Path(__file__).parent / ".env")

SUPABASE_URL = _env.get("SUPABASE_URL", "")
SUPABASE_KEY = _env.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Paths
BASE_DIR = Path(__file__).parent.parent
BRONDATA_DIR = BASE_DIR / "brondata"
DEBITEUREN_FILE = BRONDATA_DIR / "debiteuren" / "Karpi_Debiteuren_Import.xlsx"
VOORRAAD_FILE = BRONDATA_DIR / "voorraad" / "Karpi_Import.xlsx"
LOGOS_DIR = BRONDATA_DIR / "logos"
