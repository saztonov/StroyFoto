import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'database');
const FILE_JSON = path.join(OUTPUT_DIR, 'stroyfoto.schema.json');
const FILE_MD = path.join(OUTPUT_DIR, 'stroyfoto.schema.md');
const FILE_SQL = path.join(OUTPUT_DIR, 'stroyfoto.schema.sql');

const HELP_TEXT = `Usage: tsx scripts/db/export-schema.ts [options]

Подключается к PostgreSQL по DATABASE_URL и выгружает структуру БД (без данных)
в три файла в папке database/:
  - stroyfoto.schema.json   машинно-читаемый снимок
  - stroyfoto.schema.md     человекочитаемая документация
  - stroyfoto.schema.sql    SQL-представление структуры

Options:
  -h, --help                напечатать эту справку и выйти
  --schemas=a,b             фильтр схем (по умолчанию все не-системные)

Environment:
  DATABASE_URL              connection string (postgres://user:pass@host:port/db?sslmode=...)
                            читается из process.env, иначе из server/.env, иначе из .env
  PGSSLROOTCERT             путь к CA-сертификату для Yandex MDB
                            (по умолчанию %APPDATA%/postgresql/root.crt или ~/.postgresql/root.crt)
`;

interface CliArgs {
  help: boolean;
  schemas: string[] | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, schemas: null };
  for (const a of argv) {
    if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a.startsWith('--schemas=')) {
      args.schemas = a
        .slice('--schemas='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return args;
}

function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  const candidates = [
    path.join(PROJECT_ROOT, 'server', '.env'),
    path.join(PROJECT_ROOT, '.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      loadDotenv({ path: candidate });
      if (process.env.DATABASE_URL) return;
    }
  }
}

function resolveSslCa(): string[] | undefined {
  const candidates = [
    process.env.PGSSLROOTCERT,
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'postgresql', 'root.crt')
      : undefined,
    path.join(os.homedir(), '.postgresql', 'root.crt'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        const certs = raw
          .split(/(?=-----BEGIN CERTIFICATE-----)/g)
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.startsWith('-----BEGIN CERTIFICATE-----'));
        if (certs.length > 0) return certs;
      } catch {
        // ignore unreadable file, try next candidate
      }
    }
  }
  return undefined;
}

function maskDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, '') || '<no-db>';
    return `${u.host}/${db}`;
  } catch {
    return '<unparseable url>';
  }
}

function buildClientConfig(databaseUrl: string): pg.ClientConfig {
  const sslmodeMatch = databaseUrl.match(/[?&]sslmode=([^&]+)/i);
  const sslmode = sslmodeMatch?.[1]?.toLowerCase();
  const requiresSsl =
    sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full';
  const cleaned = databaseUrl
    .replace(/([?&])sslmode=[^&]*&?/i, (_m, sep) => (sep === '?' ? '?' : '&'))
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?');

  if (!requiresSsl) {
    return { connectionString: cleaned };
  }

  const ca = resolveSslCa();
  if ((sslmode === 'verify-ca' || sslmode === 'verify-full') && !ca) {
    throw new Error(
      `DATABASE_URL requires sslmode=${sslmode}, но CA-сертификат не найден.\n` +
        `Положите root.crt по одному из путей или задайте PGSSLROOTCERT:\n` +
        `  - ${process.env.APPDATA ? path.join(process.env.APPDATA, 'postgresql', 'root.crt') : '%APPDATA%/postgresql/root.crt'}\n` +
        `  - ${path.join(os.homedir(), '.postgresql', 'root.crt')}`,
    );
  }

  return {
    connectionString: cleaned,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}

interface ServerInfo {
  version: string;
  versionNum: number;
  database: string;
}

interface SchemaInfo {
  name: string;
  comment: string | null;
}

interface ExtensionInfo {
  name: string;
  version: string;
  schema: string;
}

interface EnumTypeInfo {
  schema: string;
  name: string;
  values: string[];
}

interface DomainTypeInfo {
  schema: string;
  name: string;
  baseType: string;
  nullable: boolean;
  default: string | null;
  check: string | null;
}

interface ColumnInfo {
  ord: number;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  identity: string | null;
  generated: string | null;
  comment: string | null;
}

interface ConstraintInfo {
  name: string;
  type: 'p' | 'u' | 'f' | 'c' | 'x' | string;
  definition: string;
}

interface IndexInfo {
  name: string;
  isPrimary: boolean;
  isUnique: boolean;
  definition: string;
}

interface TriggerInfo {
  name: string;
  definition: string;
}

interface PolicyInfo {
  name: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  withCheck: string | null;
}

interface TableInfo {
  schema: string;
  name: string;
  kind: 'r' | 'p';
  comment: string | null;
  rlsEnabled: boolean;
  rlsForced: boolean;
  columns: ColumnInfo[];
  constraints: ConstraintInfo[];
  indexes: IndexInfo[];
  triggers: TriggerInfo[];
  policies: PolicyInfo[];
}

interface ViewInfo {
  schema: string;
  name: string;
  kind: 'v' | 'm';
  definition: string;
  comment: string | null;
}

interface SequenceInfo {
  schema: string;
  name: string;
  dataType: string;
  startValue: string;
  incrementBy: string;
  minValue: string;
  maxValue: string;
  cacheSize: string;
  cycle: boolean;
  ownedBy: string | null;
}

interface FunctionInfo {
  schema: string;
  name: string;
  kind: string;
  definition: string;
}

interface Snapshot {
  generatedAt: string;
  server: ServerInfo;
  schemas: SchemaInfo[];
  extensions: ExtensionInfo[];
  enumTypes: EnumTypeInfo[];
  domainTypes: DomainTypeInfo[];
  tables: TableInfo[];
  views: ViewInfo[];
  sequences: SequenceInfo[];
  functions: FunctionInfo[];
}

function buildSchemaPredicate(schemas: string[] | null, alias: string): string {
  if (schemas && schemas.length > 0) {
    const list = schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
    return `${alias} IN (${list})`;
  }
  return `${alias} NOT LIKE 'pg\\_%' ESCAPE '\\' AND ${alias} != 'information_schema'`;
}

async function fetchSnapshot(
  client: pg.Client,
  schemas: string[] | null,
): Promise<Snapshot> {
  const serverRow = (
    await client.query<{ version: string; current_database: string; num: string }>(
      `SELECT version() AS version, current_database(), current_setting('server_version_num') AS num`,
    )
  ).rows[0]!;
  const server: ServerInfo = {
    version: serverRow.version,
    versionNum: Number(serverRow.num),
    database: serverRow.current_database,
  };

  const schemaPred = buildSchemaPredicate(schemas, 'n.nspname');
  const schemasRows = (
    await client.query<{ name: string; comment: string | null }>(
      `SELECT n.nspname AS name, obj_description(n.oid, 'pg_namespace') AS comment
       FROM pg_namespace n
       WHERE ${schemaPred}
       ORDER BY n.nspname`,
    )
  ).rows;
  const schemaNames = schemasRows.map((r) => r.name);
  if (schemaNames.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      server,
      schemas: [],
      extensions: [],
      enumTypes: [],
      domainTypes: [],
      tables: [],
      views: [],
      sequences: [],
      functions: [],
    };
  }

  const extensions = (
    await client.query<ExtensionInfo>(
      `SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE n.nspname = ANY($1::text[])
       ORDER BY e.extname`,
      [schemaNames],
    )
  ).rows;

  const enumTypes = (
    await client.query<EnumTypeInfo>(
      `SELECT n.nspname::text AS schema,
              t.typname::text AS name,
              array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       LEFT JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typtype = 'e' AND n.nspname = ANY($1::text[])
       GROUP BY n.nspname, t.typname
       ORDER BY n.nspname, t.typname`,
      [schemaNames],
    )
  ).rows;

  const domainTypes = (
    await client.query<{
      schema: string;
      name: string;
      base_type: string;
      nullable: boolean;
      default_expr: string | null;
      check_constraint: string | null;
    }>(
      `SELECT n.nspname AS schema,
              t.typname AS name,
              pg_catalog.format_type(t.typbasetype, t.typtypmod) AS base_type,
              NOT t.typnotnull AS nullable,
              t.typdefault AS default_expr,
              (SELECT pg_catalog.pg_get_constraintdef(c.oid)
                 FROM pg_constraint c
                WHERE c.contypid = t.oid LIMIT 1) AS check_constraint
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typtype = 'd' AND n.nspname = ANY($1::text[])
       ORDER BY n.nspname, t.typname`,
      [schemaNames],
    )
  ).rows.map<DomainTypeInfo>((r) => ({
    schema: r.schema,
    name: r.name,
    baseType: r.base_type,
    nullable: r.nullable,
    default: r.default_expr,
    check: r.check_constraint,
  }));

  type RawTable = {
    oid: number;
    schema: string;
    name: string;
    kind: 'r' | 'p';
    comment: string | null;
    rls_enabled: boolean;
    rls_forced: boolean;
  };

  const tableRows = (
    await client.query<RawTable>(
      `SELECT c.oid::int AS oid,
              n.nspname AS schema,
              c.relname AS name,
              c.relkind AS kind,
              obj_description(c.oid, 'pg_class') AS comment,
              c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p')
         AND n.nspname = ANY($1::text[])
       ORDER BY n.nspname, c.relname`,
      [schemaNames],
    )
  ).rows;

  const tables: TableInfo[] = [];
  for (const t of tableRows) {
    const columns = (
      await client.query<{
        ord: number;
        name: string;
        type: string;
        nullable: boolean;
        default_expr: string | null;
        identity: string;
        generated: string;
        comment: string | null;
      }>(
        `SELECT a.attnum AS ord,
                a.attname AS name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
                NOT a.attnotnull AS nullable,
                pg_get_expr(d.adbin, d.adrelid) AS default_expr,
                a.attidentity AS identity,
                a.attgenerated AS generated,
                col_description(a.attrelid, a.attnum) AS comment
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [t.oid],
      )
    ).rows.map<ColumnInfo>((r) => ({
      ord: r.ord,
      name: r.name,
      type: r.type,
      nullable: r.nullable,
      default: r.default_expr,
      identity: r.identity ? r.identity : null,
      generated: r.generated ? r.generated : null,
      comment: r.comment,
    }));

    const constraints = (
      await client.query<{ name: string; type: string; definition: string }>(
        `SELECT c.conname AS name, c.contype::text AS type, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         WHERE c.conrelid = $1::oid
         ORDER BY c.contype, c.conname`,
        [t.oid],
      )
    ).rows;

    const indexes = (
      await client.query<{
        name: string;
        is_primary: boolean;
        is_unique: boolean;
        definition: string;
      }>(
        `SELECT i.relname AS name,
                idx.indisprimary AS is_primary,
                idx.indisunique AS is_unique,
                pg_get_indexdef(idx.indexrelid) AS definition
         FROM pg_index idx
         JOIN pg_class i ON i.oid = idx.indexrelid
         WHERE idx.indrelid = $1::oid
         ORDER BY i.relname`,
        [t.oid],
      )
    ).rows.map<IndexInfo>((r) => ({
      name: r.name,
      isPrimary: r.is_primary,
      isUnique: r.is_unique,
      definition: r.definition,
    }));

    const triggers = (
      await client.query<TriggerInfo>(
        `SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS definition
         FROM pg_trigger t
         WHERE t.tgrelid = $1::oid AND NOT t.tgisinternal
         ORDER BY t.tgname`,
        [t.oid],
      )
    ).rows;

    const policies = (
      await client.query<{
        name: string;
        permissive: string;
        roles: string[];
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `SELECT policyname AS name,
                permissive,
                roles::text[] AS roles,
                cmd,
                qual,
                with_check
         FROM pg_policies
         WHERE schemaname = $1 AND tablename = $2
         ORDER BY policyname`,
        [t.schema, t.name],
      )
    ).rows.map<PolicyInfo>((r) => ({
      name: r.name,
      permissive: r.permissive,
      roles: r.roles,
      cmd: r.cmd,
      qual: r.qual,
      withCheck: r.with_check,
    }));

    tables.push({
      schema: t.schema,
      name: t.name,
      kind: t.kind,
      comment: t.comment,
      rlsEnabled: t.rls_enabled,
      rlsForced: t.rls_forced,
      columns,
      constraints,
      indexes,
      triggers,
      policies,
    });
  }

  const views = (
    await client.query<{
      schema: string;
      name: string;
      kind: 'v' | 'm';
      definition: string;
      comment: string | null;
    }>(
      `SELECT n.nspname AS schema,
              c.relname AS name,
              c.relkind AS kind,
              pg_get_viewdef(c.oid, true) AS definition,
              obj_description(c.oid, 'pg_class') AS comment
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('v', 'm') AND n.nspname = ANY($1::text[])
       ORDER BY n.nspname, c.relname`,
      [schemaNames],
    )
  ).rows;

  const sequences = (
    await client.query<{
      schema: string;
      name: string;
      data_type: string;
      start_value: string;
      increment_by: string;
      min_value: string;
      max_value: string;
      cache_size: string;
      cycle: boolean;
      owned_by: string | null;
    }>(
      `SELECT s.schemaname AS schema,
              s.sequencename AS name,
              s.data_type::text AS data_type,
              s.start_value::text AS start_value,
              s.increment_by::text AS increment_by,
              s.min_value::text AS min_value,
              s.max_value::text AS max_value,
              s.cache_size::text AS cache_size,
              s.cycle AS cycle,
              (SELECT format('%I.%I.%I', tn.nspname, tc.relname, ta.attname)
                 FROM pg_depend d
                 JOIN pg_class sc ON sc.oid = d.objid AND sc.relkind = 'S'
                 JOIN pg_class tc ON tc.oid = d.refobjid
                 JOIN pg_namespace tn ON tn.oid = tc.relnamespace
                 JOIN pg_attribute ta ON ta.attrelid = d.refobjid AND ta.attnum = d.refobjsubid
                 WHERE sc.relname = s.sequencename AND sc.relnamespace = (
                   SELECT oid FROM pg_namespace WHERE nspname = s.schemaname
                 )
                 LIMIT 1) AS owned_by
       FROM pg_sequences s
       WHERE s.schemaname = ANY($1::text[])
       ORDER BY s.schemaname, s.sequencename`,
      [schemaNames],
    )
  ).rows.map<SequenceInfo>((r) => ({
    schema: r.schema,
    name: r.name,
    dataType: r.data_type,
    startValue: r.start_value,
    incrementBy: r.increment_by,
    minValue: r.min_value,
    maxValue: r.max_value,
    cacheSize: r.cache_size,
    cycle: r.cycle,
    ownedBy: r.owned_by,
  }));

  const functions = (
    await client.query<{
      schema: string;
      name: string;
      kind: string;
      definition: string;
    }>(
      `SELECT n.nspname AS schema,
              p.proname AS name,
              p.prokind::text AS kind,
              pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d
           WHERE d.objid = p.oid AND d.deptype = 'e'
         )
       ORDER BY n.nspname, p.proname`,
      [schemaNames],
    )
  ).rows;

  return {
    generatedAt: new Date().toISOString(),
    server,
    schemas: schemasRows,
    extensions,
    enumTypes,
    domainTypes,
    tables,
    views,
    sequences,
    functions,
  };
}

function renderJson(snap: Snapshot): string {
  return JSON.stringify(snap, null, 2) + '\n';
}

function escapeMd(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMarkdown(snap: Snapshot): string {
  const out: string[] = [];
  out.push('# stroyfoto — структура БД');
  out.push('');
  out.push(`Generated: \`${snap.generatedAt}\`  `);
  out.push(`PostgreSQL: \`${snap.server.version}\`  `);
  out.push(`Database: \`${snap.server.database}\``);
  out.push('');
  out.push('> Автоматически сгенерировано `npm run db:schema:pull`. Не редактировать вручную — для изменения схемы пишите миграцию в `db/migrations/`.');
  out.push('');

  out.push('## Содержание');
  out.push('');
  out.push(`- Schemas: ${snap.schemas.length}`);
  out.push(`- Extensions: ${snap.extensions.length}`);
  out.push(`- Enum types: ${snap.enumTypes.length}`);
  out.push(`- Domain types: ${snap.domainTypes.length}`);
  out.push(`- Tables: ${snap.tables.length}`);
  out.push(`- Views: ${snap.views.filter((v) => v.kind === 'v').length}`);
  out.push(`- Materialized views: ${snap.views.filter((v) => v.kind === 'm').length}`);
  out.push(`- Sequences: ${snap.sequences.length}`);
  out.push(`- Functions/procedures: ${snap.functions.length}`);
  out.push('');

  if (snap.extensions.length > 0) {
    out.push('## Extensions');
    out.push('');
    out.push('| Name | Version | Schema |');
    out.push('|------|---------|--------|');
    for (const e of snap.extensions) {
      out.push(`| \`${e.name}\` | ${e.version} | ${e.schema} |`);
    }
    out.push('');
  }

  if (snap.enumTypes.length > 0) {
    out.push('## Enum types');
    out.push('');
    for (const t of snap.enumTypes) {
      out.push(`### \`${t.schema}.${t.name}\``);
      out.push('');
      out.push(t.values.map((v) => `\`${v}\``).join(', '));
      out.push('');
    }
  }

  if (snap.domainTypes.length > 0) {
    out.push('## Domain types');
    out.push('');
    out.push('| Schema | Name | Base type | Nullable | Default | Check |');
    out.push('|--------|------|-----------|----------|---------|-------|');
    for (const d of snap.domainTypes) {
      out.push(
        `| ${d.schema} | \`${d.name}\` | \`${d.baseType}\` | ${d.nullable ? 'yes' : 'no'} | ${escapeMd(d.default) || '—'} | ${escapeMd(d.check) || '—'} |`,
      );
    }
    out.push('');
  }

  if (snap.tables.length > 0) {
    out.push('## Tables');
    out.push('');
    for (const t of snap.tables) {
      out.push(`### \`${t.schema}.${t.name}\`${t.kind === 'p' ? ' (partitioned)' : ''}`);
      out.push('');
      if (t.comment) {
        out.push(`> ${t.comment}`);
        out.push('');
      }
      if (t.rlsEnabled) {
        out.push(`RLS: enabled${t.rlsForced ? ' (forced)' : ''}`);
        out.push('');
      }

      out.push('**Columns**');
      out.push('');
      out.push('| # | Name | Type | Null | Default | Identity/Generated | Comment |');
      out.push('|---|------|------|------|---------|--------------------|---------|');
      for (const c of t.columns) {
        const idGen = c.identity
          ? `identity (${c.identity})`
          : c.generated
            ? `generated (${c.generated})`
            : '';
        out.push(
          `| ${c.ord} | \`${c.name}\` | \`${c.type}\` | ${c.nullable ? 'yes' : 'no'} | ${escapeMd(c.default) || '—'} | ${idGen || '—'} | ${escapeMd(c.comment)} |`,
        );
      }
      out.push('');

      if (t.constraints.length > 0) {
        out.push('**Constraints**');
        out.push('');
        for (const c of t.constraints) {
          const typeLabel =
            c.type === 'p'
              ? 'PK'
              : c.type === 'u'
                ? 'UNIQUE'
                : c.type === 'f'
                  ? 'FK'
                  : c.type === 'c'
                    ? 'CHECK'
                    : c.type === 'x'
                      ? 'EXCLUDE'
                      : c.type;
          out.push(`- **${typeLabel}** \`${c.name}\` — \`${c.definition}\``);
        }
        out.push('');
      }

      if (t.indexes.length > 0) {
        out.push('**Indexes**');
        out.push('');
        for (const i of t.indexes) {
          const tags = [
            i.isPrimary ? 'primary' : null,
            i.isUnique && !i.isPrimary ? 'unique' : null,
          ]
            .filter(Boolean)
            .join(', ');
          out.push(`- \`${i.name}\`${tags ? ` (${tags})` : ''} — \`${i.definition}\``);
        }
        out.push('');
      }

      if (t.triggers.length > 0) {
        out.push('**Triggers**');
        out.push('');
        for (const tr of t.triggers) {
          out.push(`- \`${tr.name}\` — \`${tr.definition}\``);
        }
        out.push('');
      }

      if (t.policies.length > 0) {
        out.push('**RLS policies**');
        out.push('');
        for (const p of t.policies) {
          out.push(
            `- \`${p.name}\` (${p.permissive}, cmd=${p.cmd}, roles=${p.roles.join(',')}) USING ${p.qual ?? '—'}; WITH CHECK ${p.withCheck ?? '—'}`,
          );
        }
        out.push('');
      }
    }
  }

  if (snap.views.length > 0) {
    out.push('## Views & Materialized views');
    out.push('');
    for (const v of snap.views) {
      out.push(`### \`${v.schema}.${v.name}\` (${v.kind === 'm' ? 'matview' : 'view'})`);
      out.push('');
      if (v.comment) {
        out.push(`> ${v.comment}`);
        out.push('');
      }
      out.push('```sql');
      out.push(v.definition.trim());
      out.push('```');
      out.push('');
    }
  }

  if (snap.sequences.length > 0) {
    out.push('## Sequences');
    out.push('');
    out.push('| Schema | Name | Type | Start | Inc | Min | Max | Cache | Cycle | Owned by |');
    out.push('|--------|------|------|-------|-----|-----|-----|-------|-------|----------|');
    for (const s of snap.sequences) {
      out.push(
        `| ${s.schema} | \`${s.name}\` | ${s.dataType} | ${s.startValue} | ${s.incrementBy} | ${s.minValue} | ${s.maxValue} | ${s.cacheSize} | ${s.cycle ? 'yes' : 'no'} | ${s.ownedBy ?? '—'} |`,
      );
    }
    out.push('');
  }

  if (snap.functions.length > 0) {
    out.push('## Functions / Procedures');
    out.push('');
    for (const f of snap.functions) {
      const kindLabel =
        f.kind === 'p' ? 'procedure' : f.kind === 'a' ? 'aggregate' : f.kind === 'w' ? 'window' : 'function';
      out.push(`### \`${f.schema}.${f.name}\` (${kindLabel})`);
      out.push('');
      out.push('```sql');
      out.push(f.definition.trim());
      out.push('```');
      out.push('');
    }
  }

  return out.join('\n');
}

function renderSql(snap: Snapshot): string {
  const out: string[] = [];
  const banner = (title: string) => {
    out.push('');
    out.push(`-- ${'='.repeat(72)}`);
    out.push(`-- ${title}`);
    out.push(`-- ${'='.repeat(72)}`);
    out.push('');
  };

  out.push('-- stroyfoto — snapshot of database structure');
  out.push(`-- Generated: ${snap.generatedAt}`);
  out.push(`-- PostgreSQL: ${snap.server.version}`);
  out.push(`-- Database: ${snap.server.database}`);
  out.push('-- This file is auto-generated by `npm run db:schema:pull`. Do not edit manually.');
  out.push('-- Source of truth for migrations: db/migrations/');

  if (snap.schemas.length > 0) {
    banner('Schemas');
    for (const s of snap.schemas) {
      if (s.name !== 'public') {
        out.push(`CREATE SCHEMA IF NOT EXISTS ${s.name};`);
      }
    }
  }

  if (snap.extensions.length > 0) {
    banner('Extensions');
    for (const e of snap.extensions) {
      out.push(`CREATE EXTENSION IF NOT EXISTS "${e.name}" WITH SCHEMA ${e.schema};`);
    }
  }

  if (snap.enumTypes.length > 0) {
    banner('Enum types');
    for (const t of snap.enumTypes) {
      const values = t.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
      out.push(`CREATE TYPE ${t.schema}.${t.name} AS ENUM (${values});`);
    }
  }

  if (snap.domainTypes.length > 0) {
    banner('Domain types');
    for (const d of snap.domainTypes) {
      const parts = [`CREATE DOMAIN ${d.schema}.${d.name} AS ${d.baseType}`];
      if (d.default) parts.push(`DEFAULT ${d.default}`);
      if (!d.nullable) parts.push('NOT NULL');
      if (d.check) parts.push(d.check);
      out.push(parts.join(' ') + ';');
    }
  }

  if (snap.sequences.length > 0) {
    banner('Sequences (standalone)');
    for (const s of snap.sequences) {
      if (s.ownedBy) continue;
      out.push(
        `CREATE SEQUENCE ${s.schema}.${s.name} AS ${s.dataType} START WITH ${s.startValue} INCREMENT BY ${s.incrementBy} MINVALUE ${s.minValue} MAXVALUE ${s.maxValue} CACHE ${s.cacheSize}${s.cycle ? ' CYCLE' : ' NO CYCLE'};`,
      );
    }
  }

  if (snap.tables.length > 0) {
    banner('Tables');
    for (const t of snap.tables) {
      out.push(`-- Table: ${t.schema}.${t.name}`);
      const colLines = t.columns.map((c) => {
        const parts = [`  ${c.name} ${c.type}`];
        if (c.identity === 'a') parts.push('GENERATED ALWAYS AS IDENTITY');
        else if (c.identity === 'd') parts.push('GENERATED BY DEFAULT AS IDENTITY');
        if (c.generated === 's' && c.default) parts.push(`GENERATED ALWAYS AS (${c.default}) STORED`);
        else if (c.default && !c.generated) parts.push(`DEFAULT ${c.default}`);
        if (!c.nullable) parts.push('NOT NULL');
        return parts.join(' ');
      });
      out.push(`CREATE TABLE ${t.schema}.${t.name} (`);
      out.push(colLines.join(',\n'));
      out.push(');');
      if (t.comment) {
        out.push(`COMMENT ON TABLE ${t.schema}.${t.name} IS '${t.comment.replace(/'/g, "''")}';`);
      }
      for (const c of t.columns) {
        if (c.comment) {
          out.push(
            `COMMENT ON COLUMN ${t.schema}.${t.name}.${c.name} IS '${c.comment.replace(/'/g, "''")}';`,
          );
        }
      }
      out.push('');
    }

    banner('Constraints');
    for (const t of snap.tables) {
      for (const c of t.constraints) {
        out.push(
          `ALTER TABLE ${t.schema}.${t.name} ADD CONSTRAINT ${c.name} ${c.definition};`,
        );
      }
    }

    banner('Indexes');
    for (const t of snap.tables) {
      for (const i of t.indexes) {
        if (i.isPrimary) continue; // already created via PK constraint
        out.push(`${i.definition};`);
      }
    }

    const tablesWithTriggers = snap.tables.filter((t) => t.triggers.length > 0);
    if (tablesWithTriggers.length > 0) {
      banner('Triggers');
      for (const t of tablesWithTriggers) {
        for (const tr of t.triggers) {
          out.push(`${tr.definition};`);
        }
      }
    }

    const rlsTables = snap.tables.filter((t) => t.rlsEnabled || t.policies.length > 0);
    if (rlsTables.length > 0) {
      banner('RLS');
      for (const t of rlsTables) {
        if (t.rlsEnabled) {
          out.push(`ALTER TABLE ${t.schema}.${t.name} ENABLE ROW LEVEL SECURITY;`);
        }
        if (t.rlsForced) {
          out.push(`ALTER TABLE ${t.schema}.${t.name} FORCE ROW LEVEL SECURITY;`);
        }
        for (const p of t.policies) {
          const parts = [`CREATE POLICY ${p.name} ON ${t.schema}.${t.name}`];
          parts.push(`AS ${p.permissive}`);
          parts.push(`FOR ${p.cmd}`);
          if (p.roles && p.roles.length > 0) parts.push(`TO ${p.roles.join(', ')}`);
          if (p.qual) parts.push(`USING (${p.qual})`);
          if (p.withCheck) parts.push(`WITH CHECK (${p.withCheck})`);
          out.push(parts.join(' ') + ';');
        }
      }
    }
  }

  if (snap.views.length > 0) {
    banner('Views & Materialized views');
    for (const v of snap.views) {
      const keyword = v.kind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW';
      out.push(`CREATE ${keyword} ${v.schema}.${v.name} AS`);
      out.push(v.definition.trim());
      if (!v.definition.trim().endsWith(';')) out.push(';');
      if (v.comment) {
        out.push(
          `COMMENT ON ${keyword} ${v.schema}.${v.name} IS '${v.comment.replace(/'/g, "''")}';`,
        );
      }
      out.push('');
    }
  }

  if (snap.functions.length > 0) {
    banner('Functions / Procedures');
    for (const f of snap.functions) {
      out.push(f.definition.trim());
      if (!f.definition.trim().endsWith(';')) out.push(';');
      out.push('');
    }
  }

  return out.join('\n') + '\n';
}

function writeAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8' });
  fs.renameSync(tmp, filePath);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      '[export-schema] DATABASE_URL is required (set in env, server/.env or .env).',
    );
    process.exit(1);
  }

  const clientConfig = buildClientConfig(databaseUrl);
  const masked = maskDatabaseUrl(databaseUrl);
  console.log(`[export-schema] Connecting to ${masked}…`);

  const client = new pg.Client(clientConfig);
  await client.connect();
  let snapshot: Snapshot;
  try {
    snapshot = await fetchSnapshot(client, args.schemas);
  } finally {
    await client.end();
  }

  console.log(
    `[export-schema] Collected: ${snapshot.tables.length} tables, ${snapshot.tables.reduce((n, t) => n + t.indexes.length, 0)} indexes, ${snapshot.functions.length} functions, ${snapshot.enumTypes.length} enums, ${snapshot.views.length} views, ${snapshot.sequences.length} sequences.`,
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const json = renderJson(snapshot);
  const md = renderMarkdown(snapshot);
  const sql = renderSql(snapshot);
  writeAtomic(FILE_JSON, json);
  writeAtomic(FILE_MD, md);
  writeAtomic(FILE_SQL, sql);

  const totalBytes = json.length + md.length + sql.length;
  console.log(
    `[export-schema] Wrote 3 files to database/ (${totalBytes.toLocaleString('en-US')} bytes total).`,
  );
}

main().catch((err) => {
  console.error('[export-schema]', err instanceof Error ? err.message : err);
  process.exit(1);
});
