import { mkdir } from "node:fs/promises";

type LanceDbModule = typeof import("@lancedb/lancedb");
type LanceConnection = Awaited<ReturnType<LanceDbModule["connect"]>>;
type LanceTable = Awaited<ReturnType<LanceConnection["openTable"]>>;
export type DbRow = Record<string, unknown>;
export type DbSchema = Awaited<ReturnType<LanceTable["schema"]>>;

export class Database {
  private connectionPromise: Promise<LanceConnection> | null = null;

  constructor(private readonly baseDir: string) {}

  async getConnection(): Promise<LanceConnection> {
    if (!this.connectionPromise) {
      this.connectionPromise = this.connect();
    }
    return this.connectionPromise;
  }

  async hasTable(name: string): Promise<boolean> {
    const connection = await this.getConnection();
    const tableNames = await this.listTableNames(connection);
    return tableNames.includes(name);
  }

  async listTables(): Promise<string[]> {
    const connection = await this.getConnection();
    return this.listTableNames(connection);
  }

  async openTable(name: string): Promise<LanceTable> {
    const connection = await this.getConnection();
    return connection.openTable(name);
  }

  async createTable(name: string, rows: DbRow[], schema?: DbSchema): Promise<LanceTable> {
    const connection = await this.getConnection();
    return connection.createTable(name, rows, schema ? { schema } : undefined);
  }

  async tableToArray<T>(name: string): Promise<T[]> {
    if (!(await this.hasTable(name))) {
      return [];
    }

    const table = await this.openTable(name);
    const query = (table as unknown as { query?: () => { toArray?: () => Promise<T[]> } }).query?.();
    if (!query?.toArray) {
      throw new Error(`LanceDB query().toArray() is unavailable for table ${name}`);
    }
    return query.toArray();
  }

  async describeTable(name: string): Promise<Array<{ name: string; type: string; nullable: boolean }>> {
    if (!(await this.hasTable(name))) {
      return [];
    }

    const table = await this.openTable(name);
    const schema = await table.schema();
    const fields = (schema as { fields?: Array<{ name: string; type?: unknown; nullable?: boolean }> }).fields ?? [];
    return fields.map((field) => ({
      name: field.name,
      type: String(field.type ?? "unknown"),
      nullable: Boolean(field.nullable),
    }));
  }

  private async connect(): Promise<LanceConnection> {
    await mkdir(this.baseDir, { recursive: true });
    const lancedb = (await import("@lancedb/lancedb")) as LanceDbModule;
    return lancedb.connect(this.baseDir);
  }

  private async listTableNames(connection: LanceConnection): Promise<string[]> {
    const conn = connection as unknown as {
      tableNames?: () => Promise<string[]>;
      listTables?: () => Promise<string[] | { tables?: string[] }>;
    };

    if (conn.tableNames) {
      return conn.tableNames();
    }

    if (conn.listTables) {
      const result = await conn.listTables();
      if (Array.isArray(result)) {
        return result;
      }
      return result.tables ?? [];
    }

    throw new Error("Unable to list LanceDB tables");
  }
}
