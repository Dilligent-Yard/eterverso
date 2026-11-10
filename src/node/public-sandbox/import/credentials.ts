import type {
  ExistingTesterRow,
  ImportPlan,
  TesterPasswords,
  UnknownRecord,
} from './contracts.js';
import { TESTER_SPECS } from './contracts.js';
import { publicError } from './primitives.js';

/** Callable `postgres` client plus the array helper used by the tester probe. */
export interface TesterLookupSql {
  <Row extends object = UnknownRecord>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<Row[]>;
  array(values: readonly string[], oid: number): unknown;
}

export function inspectExistingTesters(
  sql: TesterLookupSql,
  plan: Pick<ImportPlan, 'testers'>,
): Promise<ExistingTesterRow[]> {
  if (!sql || typeof sql !== 'function') throw new TypeError('A postgres client is required.');
  const ids = plan.testers.map((tester) => tester.id);
  const usernames = plan.testers.map((tester) => tester.username);
  return sql<ExistingTesterRow>`
    SELECT id, username FROM users
    WHERE id = ANY(${sql.array(ids, 2950)})
       OR lower(username) = ANY(${sql.array(usernames, 25)})`;
}

export function parseTesterCredentials(contents: unknown): TesterPasswords {
  const parsed: Record<string, string> = {};
  for (const line of String(contents).split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw publicError('The private tester credential file is invalid.');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (Object.hasOwn(parsed, key)) {
      throw publicError('The private tester credential file contains duplicate keys.');
    }
    parsed[key] = value;
  }
  const passwords: Record<string, string> = {};
  for (const spec of TESTER_SPECS) {
    const prefix = `SANDBOX_${spec.key.toUpperCase()}`;
    const username = parsed[`${prefix}_USERNAME`];
    const password = parsed[`${prefix}_PASSWORD`];
    if (username !== spec.username || typeof password !== 'string'
        || password.length < 20 || password.length > 200) {
      throw publicError('The private tester credential file does not describe the expected synthetic accounts.');
    }
    passwords[spec.key] = password;
  }
  const expectedKeys = TESTER_SPECS.flatMap((spec) => [
    `SANDBOX_${spec.key.toUpperCase()}_USERNAME`,
    `SANDBOX_${spec.key.toUpperCase()}_PASSWORD`,
  ]).sort();
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedKeys)) {
    throw publicError('The private tester credential file has an unsupported format.');
  }
  return passwords;
}

export function testerCredentialsContents(passwords: TesterPasswords): string {
  return `${TESTER_SPECS.map((spec) => {
    const prefix = `SANDBOX_${spec.key.toUpperCase()}`;
    return `${prefix}_USERNAME=${spec.username}\n${prefix}_PASSWORD=${passwords[spec.key]}`;
  }).join('\n')}\n`;
}
