// Test-only fake SupabaseClient voor de verzend-orchestrator-karakterisatietests
// (ADR-0035, slice 0). Legt de SIDE-EFFECT-sequence van een `verwerkRow` vast —
// `.rpc(...)`, `.from(...).update(...)` en `storage.upload(...)` — in
// aanroep-volgorde. Dat is het contract waartegen de skeleton-migratie
// gedragsneutraliteit bewijst: dezelfde markeer_*/log_externe_payload-aanroepen
// met dezelfde argumenten, in dezelfde volgorde.
//
// Reads (`.select().eq().single()` / `.order()`) worden NIET als call gelogd —
// hun resultaat is volledig door de config bepaald en de kolomlijsten
// verschillen per carrier by-design (ADR-0034). Wat telt voor "gedrag
// ongewijzigd" zijn de uitgaande effecten.
//
// NIET puur (imiteert de DB-client) → edge-test-only, geen frontend-deling.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface RecordedCall {
  op: 'rpc' | 'update' | 'storage_upload';
  /** rpc-naam (op==='rpc'). */
  name?: string;
  /** rpc-argumenten (op==='rpc'). */
  args?: any;
  /** tabel (op==='update'). */
  table?: string;
  /** update-waarden (op==='update'). */
  values?: any;
  /** .eq()-filters van de update (op==='update'). */
  match?: Record<string, unknown>;
  /** bucket + pad (op==='storage_upload'). */
  bucket?: string;
  path?: string;
}

export interface TableResult {
  /** Resultaat van `.select(...).eq(...).single()`. */
  single?: { data: unknown; error: unknown };
  /** Resultaat van `.select(...).eq(...).order(...)` (lijst-await). */
  list?: { data: unknown; error: unknown };
  /** Resultaat van `.update(...).eq(...)` (await). */
  update?: { data?: unknown; error: unknown };
}

export interface FakeSupabaseConfig {
  /** Per tabelnaam het te leveren read/update-resultaat. */
  tables?: Record<string, TableResult>;
  /** Per rpc-naam het resultaat (default `{ data: null, error: null }`). */
  rpc?: Record<string, { data?: unknown; error?: unknown }>;
  /** Resultaat van elke storage-upload (default ok). */
  storageUpload?: { error: unknown };
}

class QueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private mode: 'select' | 'update' = 'select';
  private values: unknown = undefined;
  private readonly match: Record<string, unknown> = {};

  constructor(private readonly fake: FakeSupabase, private readonly table: string) {}

  select(_cols?: string): this {
    this.mode = 'select';
    return this;
  }
  update(values: unknown): this {
    this.mode = 'update';
    this.values = values;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.match[col] = val;
    return this;
  }
  order(_col: string, _opts?: unknown): this {
    return this;
  }

  single(): Promise<{ data: unknown; error: unknown }> {
    const r = this.fake.cfg.tables?.[this.table]?.single ?? { data: null, error: null };
    return Promise.resolve(r);
  }

  // Thenable: `await builder` (update-pad, of select→order lijst-pad).
  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onF?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onR?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.resolveTerminal().then(onF, onR);
  }

  private resolveTerminal(): Promise<{ data: unknown; error: unknown }> {
    if (this.mode === 'update') {
      this.fake.calls.push({
        op: 'update',
        table: this.table,
        values: this.values,
        match: { ...this.match },
      });
      const r = this.fake.cfg.tables?.[this.table]?.update ?? { data: null, error: null };
      return Promise.resolve({ data: (r as any).data ?? null, error: r.error });
    }
    const r = this.fake.cfg.tables?.[this.table]?.list ?? { data: [], error: null };
    return Promise.resolve(r);
  }
}

export class FakeSupabase {
  readonly calls: RecordedCall[] = [];

  constructor(readonly cfg: FakeSupabaseConfig = {}) {}

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  rpc(name: string, args?: unknown): Promise<{ data: unknown; error: unknown }> {
    this.calls.push({ op: 'rpc', name, args });
    const r = this.cfg.rpc?.[name] ?? { data: null, error: null };
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
  }

  storage = {
    from: (bucket: string) => ({
      upload: (path: string, _body: unknown, _opts?: unknown) => {
        this.calls.push({ op: 'storage_upload', bucket, path });
        const err = this.cfg.storageUpload?.error ?? null;
        return Promise.resolve({ data: { path }, error: err });
      },
    }),
  };

  /** Alleen de rpc-aanroepen, in volgorde — handig voor sequence-asserts. */
  rpcCalls(): Array<{ name: string; args: any }> {
    return this.calls
      .filter((c) => c.op === 'rpc')
      .map((c) => ({ name: c.name!, args: c.args }));
  }

  /** Alleen de rpc-namen, in volgorde. */
  rpcNames(): string[] {
    return this.calls.filter((c) => c.op === 'rpc').map((c) => c.name!);
  }
}

/** Cast naar het echte client-type voor de `verwerkRow`-signatuur. */
export function asClient(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}
