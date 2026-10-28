/**
 * Generates docs/api/openapi.json, the Swagger (OpenAPI 3.1) document every
 * API serves at /docs. Like docs/api/endpoints.md it is built from the code,
 * never written by hand:
 *
 * - the routes, access rules and descriptions: scripts/api-reference.mjs;
 * - request bodies and query strings: the Zod schema each handler validates
 *   with (zodPipe), converted by zod-to-json-schema, so lengths, formats and
 *   enums are the ones the API actually enforces;
 * - responses: each handler's TypeScript return type, read with the
 *   TypeScript compiler.
 *
 *   tsx scripts/openapi.mts           # rewrite docs/api/openapi.json
 *   tsx scripts/openapi.mts --check   # fail if it is out of date
 *
 * Needs the Prisma clients generated and packages/* built (as CI does before
 * check:docs): the controllers' types come from them.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as kernel from '@platform/kernel';
import * as platformContracts from '@platform/platform-contracts';
import * as invoicingContracts from '@platform/invoicing-contracts';
// @ts-expect-error — a plain .mjs script with no type declarations.
import { AREAS, DESCRIPTIONS, access, routes } from './api-reference.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/api/openapi.json');

type Json = Record<string, unknown>;

interface Route {
  method: string;
  path: string;
  isPublic: boolean;
  internal: boolean;
  perm: string | null;
  product: string | null;
  upload: boolean;
  uploadFields: string[];
  rateLimited: boolean;
  raw: boolean;
  handler: string;
  className: string;
  code?: string;
  file: string;
  api: string;
}

/** The Zod schemas the contracts packages export, by name. */
const EXPORTED_SCHEMAS: Record<string, unknown> = {
  ...kernel,
  ...platformContracts,
  ...invoicingContracts,
};

/** Handlers that write the response themselves (@Res()), described here. */
const RAW_RESPONSES: Record<string, Json> = {
  connect: {
    '302': {
      description:
        "Redirect to the provider's consent screen. Open it as a link in the browser, not with fetch.",
      headers: { Location: { schema: { type: 'string', format: 'uri' } } },
    },
  },
  callback: {
    '302': {
      description:
        "Redirect back to the web app's brand settings, with the outcome (or an error code) in the query string.",
      headers: { Location: { schema: { type: 'string', format: 'uri' } } },
    },
  },
  health: {
    '200': { description: 'Every check is up.', content: json(ref('HealthReport')) },
    '503': { description: 'At least one check is down.', content: json(ref('HealthReport')) },
  },
  pdf: {
    '200': {
      description: 'The invoice PDF, as an attachment.',
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    },
  },
  file: {
    '200': {
      description: 'The file.',
      content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
    },
  },
};

function rawKind(r: Route): string {
  if (r.path.endsWith('/connect')) return 'connect';
  if (r.path.endsWith('/callback')) return 'callback';
  if (r.path.startsWith('/health')) return 'health';
  if (r.path.endsWith('/pdf')) return 'pdf';
  if (r.path.startsWith('/storage')) return 'file';
  throw new Error(`${r.method} ${r.path} writes its own response: describe it in RAW_RESPONSES`);
}

function ref(name: string): Json {
  return { $ref: `#/components/schemas/${name}` };
}
function json(schema: Json): Json {
  return { 'application/json': { schema } };
}

// ---------------------------------------------------------------------------
// TypeScript types → JSON Schema

const components: Record<string, Json> = {};
/** Which type each component name was made from, to keep names unique. */
const componentTypes = new Map<string, ts.Type>();
const typeNames = new Map<ts.Type, string>();

/** Types that are written out where used rather than named. */
const INLINE_NAMES = new Set([
  'Array',
  'ReadonlyArray',
  'Promise',
  'Date',
  'Record',
  'Partial',
  'Required',
  'Readonly',
  'Pick',
  'Omit',
  'Buffer',
  'Uint8Array',
]);

function componentName(checker: ts.TypeChecker, type: ts.Type): string | null {
  let name: string | undefined;
  if (type.aliasSymbol && !type.aliasTypeArguments?.length) name = type.aliasSymbol.name;
  else if (type.flags & ts.TypeFlags.Object) {
    const objectFlags = (type as ts.ObjectType).objectFlags;
    const symbol = type.getSymbol();
    if (
      symbol &&
      objectFlags & (ts.ObjectFlags.Interface | ts.ObjectFlags.Class) &&
      !(objectFlags & ts.ObjectFlags.Reference && (type as ts.TypeReference).typeArguments?.length)
    ) {
      name = symbol.name;
    }
  }
  if (!name || name.startsWith('__') || INLINE_NAMES.has(name)) return null;
  // Booleans and single literals read better inline than as a $ref.
  if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.Literal)) return null;
  name = name.replace(/[^A-Za-z0-9_.-]/g, '_');
  let unique = name;
  for (let n = 2; componentTypes.has(unique) && componentTypes.get(unique) !== type; n++) {
    unique = `${name}${n}`;
  }
  void checker;
  return unique;
}

function docOf(checker: ts.TypeChecker, symbol: ts.Symbol): string | undefined {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  return text ? text.replace(/\s*\n\s*/g, ' ') : undefined;
}

function withoutUndefined(type: ts.Type): ts.Type[] {
  const parts = type.isUnion() ? type.types : [type];
  return parts.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
}

function typeSchema(checker: ts.TypeChecker, type: ts.Type, depth = 0): Json {
  if (depth > 25) return {};
  const name = componentName(checker, type);
  if (name) {
    const known = typeNames.get(type);
    if (known) return ref(known);
    typeNames.set(type, name);
    componentTypes.set(name, type);
    components[name] = {}; // placeholder while recursive types resolve
    components[name] = describeType(checker, type, depth);
    return ref(name);
  }
  return describeType(checker, type, depth);
}

function describeType(checker: ts.TypeChecker, type: ts.Type, depth: number): Json {
  const f = type.flags;
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
  if (f & ts.TypeFlags.Null) return { type: 'null' };
  if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (f & ts.TypeFlags.BooleanLiteral) {
    return { type: 'boolean', const: checker.typeToString(type) === 'true' };
  }
  if (type.isStringLiteral()) return { type: 'string', const: type.value };
  if (type.isNumberLiteral()) return { type: 'number', const: type.value };
  if (f & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) return { type: 'string' };
  if (f & ts.TypeFlags.Number) return { type: 'number' };
  // Prisma's BigInt money columns are sent as plain numbers (app-setup.ts).
  if (f & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return { type: 'integer' };

  if (type.isUnion()) {
    const parts = withoutUndefined(type);
    const nullable = parts.some((t) => t.flags & ts.TypeFlags.Null);
    let rest = parts.filter((t) => !(t.flags & ts.TypeFlags.Null));
    // `boolean` inside a union arrives as `true | false`.
    const bools = rest.filter((t) => t.flags & ts.TypeFlags.BooleanLiteral);
    if (bools.length === 2) rest = rest.filter((t) => !(t.flags & ts.TypeFlags.BooleanLiteral));
    const schemas: Json[] = bools.length === 2 ? [{ type: 'boolean' }] : [];
    if (rest.length && rest.every((t) => t.isStringLiteral())) {
      schemas.push({
        type: 'string',
        enum: rest.map((t) => (t as ts.StringLiteralType).value),
      });
    } else {
      schemas.push(...rest.map((t) => typeSchema(checker, t, depth + 1)));
    }
    if (nullable) schemas.push({ type: 'null' });
    if (schemas.length === 1) return schemas[0]!;
    if (
      schemas.length === 2 &&
      nullable &&
      typeof schemas[0]!['type'] === 'string' &&
      !schemas[0]!['$ref']
    ) {
      const { type: t, ...more } = schemas[0]!;
      const enumValues = more['enum'] as unknown[] | undefined;
      return {
        ...more,
        type: [t, 'null'],
        ...(enumValues ? { enum: [...enumValues, null] } : {}),
      };
    }
    return { anyOf: schemas };
  }

  if (f & ts.TypeFlags.Object) {
    const symbolName = type.getSymbol()?.name;
    if (symbolName === 'Date') return { type: 'string', format: 'date-time' };
    if (symbolName === 'Buffer' || symbolName === 'Uint8Array') {
      return { type: 'string', format: 'binary' };
    }
    // Prisma's Decimal serialises as a string.
    if (symbolName === 'Decimal') return { type: 'string', pattern: '^-?\\d+(\\.\\d+)?$' };
    if (checker.isTupleType(type)) {
      const items = checker
        .getTypeArguments(type as ts.TypeReference)
        .map((t) => typeSchema(checker, t, depth + 1));
      return { type: 'array', prefixItems: items, minItems: items.length };
    }
    if (checker.isArrayType(type)) {
      const [item] = checker.getTypeArguments(type as ts.TypeReference);
      return { type: 'array', items: item ? typeSchema(checker, item, depth + 1) : {} };
    }
    if (type.getCallSignatures().length) return {};
  }

  if (f & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
    const properties: Record<string, Json> = {};
    const required: string[] = [];
    for (const prop of checker.getPropertiesOfType(type)) {
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
      const propType = checker.getTypeOfSymbol(prop);
      if (propType.getCallSignatures().length) continue; // methods
      const parts = withoutUndefined(propType);
      if (!parts.length) continue;
      const optional =
        Boolean(prop.flags & ts.SymbolFlags.Optional) || parts.length !== withAll(propType);
      const schema =
        parts.length === 1
          ? typeSchema(checker, parts[0]!, depth + 1)
          : typeSchema(checker, propType, depth + 1);
      const description = docOf(checker, prop);
      properties[prop.name] = description
        ? schema['$ref']
          ? { allOf: [schema], description }
          : { ...schema, description }
        : schema;
      if (!optional) required.push(prop.name);
      void declaration;
    }
    const out: Json = { type: 'object', properties };
    if (required.length) out['required'] = required;
    const index = checker.getIndexInfosOfType(type)[0];
    if (index) out['additionalProperties'] = typeSchema(checker, index.type, depth + 1);
    if (!Object.keys(properties).length && !index) out['additionalProperties'] = true;
    return out;
  }
  return {};
}

function withAll(type: ts.Type): number {
  return type.isUnion() ? type.types.length : 1;
}

// ---------------------------------------------------------------------------
// Zod schemas → JSON Schema

function zodSchema(schema: ZodTypeAny): Json {
  const out = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
    // Zod strips unknown fields rather than rejecting them, so only a
    // .strict() object may say additionalProperties: false.
    removeAdditionalStrategy: 'strict',
    effectStrategy: 'input',
    pipeStrategy: 'input',
  }) as Json;
  delete out['$schema'];
  return out;
}

/**
 * The JSON Schema of the value a zodPipe(...) argument accepts: the
 * contracts' exported Zod schema when it is one (with every rule it
 * enforces), otherwise the input type the compiler sees.
 */
function pipeSchema(checker: ts.TypeChecker, expr: ts.Expression): Json {
  if (ts.isIdentifier(expr)) {
    let symbol = checker.getSymbolAtLocation(expr);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const file = symbol?.declarations?.[0]?.getSourceFile().fileName ?? '';
    const exported = EXPORTED_SCHEMAS[expr.text];
    if (/packages\/(kernel|platform-contracts|invoicing-contracts)\//.test(file) && exported) {
      return zodSchema(exported as ZodTypeAny);
    }
  }
  const input = checker.getTypeAtLocation(expr).getProperty('_input');
  return input ? typeSchema(checker, checker.getTypeOfSymbol(input)) : {};
}

// ---------------------------------------------------------------------------
// One operation per route

interface Parsed {
  body?: Json;
  query: Json[];
  params: Record<string, Json>;
  response?: ts.Type;
}

function decoratorCall(param: ts.ParameterDeclaration, name: string): ts.CallExpression | null {
  for (const d of ts.getDecorators(param) ?? []) {
    if (
      ts.isCallExpression(d.expression) &&
      ts.isIdentifier(d.expression.expression) &&
      d.expression.expression.text === name
    ) {
      return d.expression;
    }
  }
  return null;
}

/** The schema inside zodPipe(...) among a decorator's arguments, if any. */
function pipeArg(call: ts.CallExpression): ts.Expression | null {
  for (const arg of call.arguments) {
    if (
      ts.isCallExpression(arg) &&
      ts.isIdentifier(arg.expression) &&
      arg.expression.text === 'zodPipe' &&
      arg.arguments[0]
    ) {
      return arg.arguments[0];
    }
  }
  return null;
}

function parseHandler(checker: ts.TypeChecker, method: ts.MethodDeclaration): Parsed {
  const parsed: Parsed = { query: [], params: {} };
  for (const param of method.parameters) {
    const paramType = checker.getTypeAtLocation(param);
    const body = decoratorCall(param, 'Body');
    if (body) {
      const pipe = pipeArg(body);
      parsed.body = pipe ? pipeSchema(checker, pipe) : typeSchema(checker, paramType);
    }
    const query = decoratorCall(param, 'Query');
    if (query) {
      const first = query.arguments[0];
      const pipe = pipeArg(query);
      if (first && ts.isStringLiteral(first)) {
        const schema = pipe ? pipeSchema(checker, pipe) : typeSchema(checker, paramType);
        parsed.query.push({
          name: first.text,
          in: 'query',
          required:
            !paramType.isUnion() || withoutUndefined(paramType).length === withAll(paramType),
          schema,
        });
      } else if (pipe) {
        const schema = pipeSchema(checker, pipe);
        const props = (schema['properties'] ?? {}) as Record<string, Json>;
        const required = new Set((schema['required'] as string[] | undefined) ?? []);
        for (const [name, prop] of Object.entries(props)) {
          const { description, ...rest } = prop;
          parsed.query.push({
            name,
            in: 'query',
            required: required.has(name) && !('default' in prop),
            schema: rest,
            ...(description ? { description } : {}),
          });
        }
      }
    }
    const p = decoratorCall(param, 'Param');
    if (p && p.arguments[0] && ts.isStringLiteral(p.arguments[0])) {
      const pipe = pipeArg(p);
      parsed.params[p.arguments[0].text] = pipe ? pipeSchema(checker, pipe) : { type: 'string' };
    }
  }
  const signature = checker.getSignatureFromDeclaration(method);
  if (signature) {
    const returned = checker.getReturnTypeOfSignature(signature);
    parsed.response = checker.getAwaitedType(returned) ?? returned;
  }
  return parsed;
}

function areaOf(p: string): string {
  const found = (AREAS as [string, (path: string) => boolean][]).find(([, test]) => test(p));
  if (!found) throw new Error(`no area for ${p}`);
  return found[0];
}

/** An error response, with an example of its own status. */
function errorResponse(description: string, status: number, error: string, message: string): Json {
  return {
    description,
    content: {
      'application/json': {
        schema: ref('Error'),
        example: { statusCode: status, error, message },
      },
    },
  };
}

const ERROR_RESPONSES = {
  '400': {
    description: 'The request is invalid. Validation failures list every field problem.',
    content: {
      'application/json': {
        schema: { anyOf: [ref('ValidationError'), ref('Error')] },
        example: {
          message: 'validation failed',
          issues: [{ path: 'email', message: 'Invalid email', code: 'invalid_string' }],
        },
      },
    },
  },
  '401': errorResponse(
    'No session, or it expired or was ended.',
    401,
    'Unauthorized',
    'authentication required',
  ),
  '403': errorResponse(
    'Signed in, but not allowed (role, product or brand).',
    403,
    'Forbidden',
    'insufficient permissions',
  ),
  '404': errorResponse(
    'Not found, or not yours (or a payment link that is no longer valid).',
    404,
    'Not Found',
    'not found',
  ),
  '429': errorResponse(
    'Too many requests: wait and retry.',
    429,
    'Too Many Requests',
    'too many requests',
  ),
};

function operation(checker: ts.TypeChecker, r: Route, method: ts.MethodDeclaration): Json {
  const parsed = parseHandler(checker, method);
  const description = DESCRIPTIONS[`${r.method} ${r.path}`] as string;
  const served =
    r.api === 'every API' ? 'every API (platform, Sugrpay and HQ)' : `the ${r.api} API`;
  const details = [
    description,
    '',
    `**Access:** ${String(access(r)).replace(/`/g, '')}`,
    `**Served by:** ${served} — \`${r.file}\` (\`${r.className}.${r.handler}\`)`,
  ];

  const parameters: Json[] = [];
  for (const name of [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]!)) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: parsed.params[name] ?? { type: 'string' },
    });
  }
  parameters.push(...parsed.query);

  const op: Json = {
    tags: [areaOf(r.path)],
    operationId: `${r.className}_${r.handler}`,
    summary: description.split(/(?<=[.!?])\s|:\s/)[0]!.replace(/\.$/, ''),
    description: details.join('\n'),
  };
  if (parameters.length) op['parameters'] = parameters;

  if (r.upload) {
    const body = parsed.body ?? { type: 'object', properties: {} };
    const properties = { ...((body['properties'] as Json | undefined) ?? {}) };
    for (const field of r.uploadFields) properties[field] = { type: 'string', format: 'binary' };
    op['requestBody'] = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties,
            required: [...((body['required'] as string[] | undefined) ?? []), ...r.uploadFields],
          },
        },
      },
    };
  } else if (parsed.body) {
    op['requestBody'] = { required: true, content: json(parsed.body) };
  }

  let responses: Json;
  if (r.raw) {
    responses = { ...RAW_RESPONSES[rawKind(r)] };
  } else {
    const status = r.code ?? (r.method === 'POST' ? '201' : '200');
    const type = parsed.response;
    const empty =
      !type || type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined) || status === '204';
    const schema = empty ? {} : typeSchema(checker, type);
    responses = {
      [status]: empty
        ? { description: 'Done; no body.' }
        : {
            // `unknown`: a provider's own JSON (Zoho's), passed through as is.
            description: Object.keys(schema).length
              ? 'Success.'
              : "Success: the provider's response, passed through as is.",
            content: json(schema),
          },
    };
  }
  const hasInput = Boolean(op['requestBody']) || parameters.length > 0;
  if (hasInput) responses['400'] = ERROR_RESPONSES['400'];
  if (!r.isPublic) {
    responses['401'] = ERROR_RESPONSES['401'];
    responses['403'] = ERROR_RESPONSES['403'];
  }
  if (r.path.includes(':')) responses['404'] = ERROR_RESPONSES['404'];
  if (r.rateLimited) responses['429'] = ERROR_RESPONSES['429'];
  op['responses'] = responses;

  op['security'] = r.internal
    ? [{ internalKey: [] }]
    : r.isPublic
      ? []
      : [{ bearerAuth: [] }, { cookieAuth: [] }];
  if (r.internal) op['x-internal'] = true;
  return op;
}

// ---------------------------------------------------------------------------

function build(): Json {
  const all = routes() as Route[];
  const files = [...new Set(all.map((r) => path.join(ROOT, r.file)))];
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(ROOT, 'apps/platform/tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!config) throw new Error('cannot read apps/platform/tsconfig.json');
  const program = ts.createProgram(files, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();

  const methods = new Map<string, ts.MethodDeclaration>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`not compiled: ${file}`);
    source.forEachChild(function visit(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
            methods.set(`${node.name.text}.${member.name.text}`, member);
          }
        }
      }
      node.forEachChild(visit);
    });
  }

  components['Error'] = {
    type: 'object',
    properties: {
      statusCode: { type: 'integer', examples: [404] },
      error: { type: 'string', examples: ['Not Found'] },
      message: {
        anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        examples: ['invoice not found'],
      },
    },
    required: ['statusCode', 'message'],
  };
  components['ValidationError'] = {
    type: 'object',
    properties: {
      message: { type: 'string', const: 'validation failed' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'The field, dotted (e.g. `lines.0.unitPrice`).' },
            message: { type: 'string' },
            code: { type: 'string', description: 'The Zod issue code, e.g. `invalid_type`.' },
          },
          required: ['path', 'message', 'code'],
        },
      },
    },
    required: ['message', 'issues'],
  };
  components['HealthReport'] = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded', 'ready', 'not-ready'] },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', examples: ['database', 'redis', 'storage'] },
            state: { type: 'string', enum: ['up', 'down'] },
            durationMs: { type: 'number' },
            detail: { type: 'string' },
          },
          required: ['name', 'state', 'durationMs'],
        },
      },
    },
    required: ['status', 'checks'],
  };

  const paths: Record<string, Json> = {};
  for (const r of all) {
    const method = methods.get(`${r.className}.${r.handler}`);
    if (!method) throw new Error(`handler not found: ${r.className}.${r.handler}`);
    const p = r.path.replace(/:(\w+)/g, '{$1}');
    paths[p] = { ...(paths[p] ?? {}), [r.method.toLowerCase()]: operation(checker, r, method) };
  }

  const version = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Json)[
    'version'
  ] as string;
  const intro = fs
    .readFileSync(path.join(ROOT, 'docs/api/swagger-intro.md'), 'utf8')
    .replace(/^#.*\n+/, '')
    .replace(/<!--[\s\S]*?-->\n*/g, '')
    .trim();

  return {
    openapi: '3.1.0',
    info: { title: 'Sugrpay platform API', version, description: intro },
    // The served copy (/docs/openapi.json) sets `servers` from the running
    // API's own configuration; see packages/server/src/api-docs.ts.
    tags: (AREAS as [string][]).map(([name]) => ({ name })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'The `token` from `POST /auth/login`. Paste it into **Authorize**; it works on every API.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'sugrpay_session',
          description:
            'Set by `POST /auth/login` on the API\'s own address. "Try it out" on this page sends it automatically after you sign in here.',
        },
        internalKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-internal-key',
          description:
            'INTERNAL_API_KEY, shared by the APIs. nginx refuses `/internal/…` from the internet, so these cannot be tried from this page in production.',
        },
      },
      schemas: Object.fromEntries(
        Object.entries(components).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}

const prettier = await import('prettier');
const text = await prettier.format(JSON.stringify(build()), {
  ...(await prettier.resolveConfig(OUT)),
  parser: 'json',
});
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('docs/api/openapi.json is out of date: run `pnpm docs:api`.');
    process.exit(1);
  }
  console.log('docs/api/openapi.json is up to date.');
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
