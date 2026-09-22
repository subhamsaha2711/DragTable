import type { TableMeta, RowRecord } from "@dragtable/target-db";

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function tableToCsv(table: TableMeta, rows: RowRecord[]): string {
  const cols = [...table.columns].sort((a, b) => a.position - b.position);
  const header = cols.map((c) => escapeCsvCell(c.name)).join(",");
  const lines = rows.map((r) =>
    cols.map((c) => escapeCsvCell(r.values[c.id])).join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

export interface DatabaseExportArchive {
  format: "dragtable-export-v1";
  exportedAt: string;
  database: {
    id: string;
    dbCode: string;
    name: string;
  };
  manifest: {
    tableCount: number;
    totalRows: number;
  };
  schema: Array<{
    name: string;
    schemaVersion: number;
    columns: Array<{
      name: string;
      dataType: string;
      nullable: boolean;
      unique: boolean;
      isPrimaryKey: boolean;
    }>;
  }>;
  tables: Record<
    string,
    {
      columns: string[];
      rows: Record<string, unknown>[];
      csv: string;
    }
  >;
}

export function buildDatabaseExport(input: {
  database: { id: string; dbCode: string; name: string };
  tables: TableMeta[];
  rowsByTableId: Map<string, RowRecord[]>;
}): DatabaseExportArchive {
  const schema: DatabaseExportArchive["schema"] = [];
  const tablesOut: DatabaseExportArchive["tables"] = {};
  let totalRows = 0;

  for (const table of input.tables) {
    const rows = input.rowsByTableId.get(table.id) ?? [];
    totalRows += rows.length;
    const cols = [...table.columns].sort((a, b) => a.position - b.position);
    schema.push({
      name: table.name,
      schemaVersion: table.schemaVersion,
      columns: cols.map((c) => ({
        name: c.name,
        dataType: c.dataType,
        nullable: c.nullable,
        unique: c.unique,
        isPrimaryKey: c.isPrimaryKey,
      })),
    });
    tablesOut[table.name] = {
      columns: cols.map((c) => c.name),
      rows: rows.map((r) => {
        const obj: Record<string, unknown> = {};
        for (const c of cols) obj[c.name] = r.values[c.id] ?? null;
        return obj;
      }),
      csv: tableToCsv(table, rows),
    };
  }

  return {
    format: "dragtable-export-v1",
    exportedAt: new Date().toISOString(),
    database: input.database,
    manifest: {
      tableCount: input.tables.length,
      totalRows,
    },
    schema,
    tables: tablesOut,
  };
}

export function buildDatabaseCsvZip(input: {
  tables: TableMeta[];
  rowsByTableId: Map<string, RowRecord[]>;
}): Buffer {
  const files: Array<{ name: string; data: Buffer }> = [];
  const usedNames = new Set<string>();

  for (const table of input.tables) {
    const rows = input.rowsByTableId.get(table.id) ?? [];
    const csv = tableToCsv(table, rows);
    let base = table.name.replace(/[^a-zA-Z0-9._-]+/g, "_") || "table";
    let name = `${base}.csv`;
    let n = 2;
    while (usedNames.has(name.toLowerCase())) {
      name = `${base}_${n}.csv`;
      n++;
    }
    usedNames.add(name.toLowerCase());
    files.push({ name, data: Buffer.from(csv, "utf8") });
  }

  return buildZipStore(files);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipStore(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    localParts.push(local, f.data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);

    offset += local.length + f.data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, end]);
}
