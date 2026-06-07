"""Tests voor de batchhelpers met een mock-Supabase-client.

De mock legt elke aangeroepen methode + argumenten vast zodat we kunnen
bewijzen dat upsert vs. insert het juiste pad kiest, en dat batching klopt.
"""
import pytest

from lib.supabase_helpers import (
    upsert_batch,
    batch_delete,
    batch_select,
)


class FakeQuery:
    def __init__(self, table, log):
        self.table_name = table
        self.log = log
        self._select_cols = None
        self._in_field = None
        self._in_ids = None

    # write
    def upsert(self, batch, **kwargs):
        self.log.append(("upsert", self.table_name, list(batch), kwargs))
        return self

    def insert(self, batch, **kwargs):
        self.log.append(("insert", self.table_name, list(batch), kwargs))
        return self

    # delete
    def delete(self):
        self.log.append(("delete", self.table_name))
        return self

    # read
    def select(self, cols):
        self._select_cols = cols
        return self

    def in_(self, field, ids):
        self._in_field = field
        self._in_ids = list(ids)
        self.log.append(("in_", self.table_name, field, list(ids)))
        return self

    def execute(self):
        # batch_select leest .data; geef per gevraagde id een rij terug
        if self._select_cols is not None and self._in_ids is not None:
            data = [{"id": i} for i in self._in_ids]
            return type("Res", (), {"data": data})()
        return type("Res", (), {"data": []})()


class FakeSB:
    def __init__(self):
        self.log = []

    def table(self, name):
        return FakeQuery(name, self.log)


def test_upsert_batch_default_pad():
    sb = FakeSB()
    records = [{"a": i} for i in range(3)]
    upsert_batch(sb, "t", records, on_conflict="a", progress=False)
    writes = [e for e in sb.log if e[0] in ("upsert", "insert")]
    assert len(writes) == 1
    assert writes[0][0] == "upsert"
    assert writes[0][3] == {"on_conflict": "a"}


def test_upsert_batch_zonder_on_conflict_geen_kwargs():
    sb = FakeSB()
    upsert_batch(sb, "t", [{"a": 1}], progress=False)
    writes = [e for e in sb.log if e[0] == "upsert"]
    assert writes[0][3] == {}


def test_upsert_batch_insert_mode():
    sb = FakeSB()
    upsert_batch(sb, "t", [{"a": 1}], mode="insert", progress=False)
    kinds = [e[0] for e in sb.log if e[0] in ("upsert", "insert")]
    assert kinds == ["insert"]


def test_upsert_batch_chunking():
    sb = FakeSB()
    records = [{"a": i} for i in range(5)]
    upsert_batch(sb, "t", records, batch_size=2, progress=False)
    writes = [e for e in sb.log if e[0] == "upsert"]
    assert [len(w[2]) for w in writes] == [2, 2, 1]


def test_upsert_batch_lege_lijst():
    sb = FakeSB()
    upsert_batch(sb, "t", [], progress=False)
    assert [e for e in sb.log if e[0] in ("upsert", "insert")] == []


def test_upsert_batch_onbekende_mode():
    sb = FakeSB()
    with pytest.raises(ValueError):
        upsert_batch(sb, "t", [{"a": 1}], mode="merge", progress=False)


def test_batch_delete_chunking():
    sb = FakeSB()
    batch_delete(sb, "t", "id", list(range(5)), size=2)
    in_calls = [e for e in sb.log if e[0] == "in_"]
    assert [e[3] for e in in_calls] == [[0, 1], [2, 3], [4]]
    assert all(e[0] == "delete" for e in sb.log if e[0] == "delete")


def test_batch_select_verzamelt_data():
    sb = FakeSB()
    rows = batch_select(sb, "t", "id", "id", [10, 11, 12], size=2)
    assert rows == [{"id": 10}, {"id": 11}, {"id": 12}]
