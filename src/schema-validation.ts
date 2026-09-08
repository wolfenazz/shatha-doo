/** Constraint-preserving JSON Schema 2020-12 to Zod conversion. */
import { z } from 'zod';
import { ConnectorError } from './errors';

type JsonSchema = Record<string, unknown>;

function asSchema(value: unknown): JsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchema)
    : {};
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith('#/')) return {};
  let current: unknown = root;
  for (const token of ref.slice(2).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    current = asSchema(current)[key];
  }
  return asSchema(current);
}

function stringSchema(schema: JsonSchema): z.ZodTypeAny {
  let result = z.string();
  if (typeof schema.minLength === 'number') result = result.min(schema.minLength);
  if (typeof schema.maxLength === 'number') result = result.max(schema.maxLength);
  if (typeof schema.pattern === 'string') result = result.regex(new RegExp(schema.pattern));
  switch (schema.format) {
    case 'date-time':
      result = result.datetime({ offset: true });
      break;
    case 'email':
      result = result.email();
      break;
    case 'uri':
      result = result.url();
      break;
  }
  return result;
}

/** Converts the supported connector schemas without dropping safety constraints. */
export function jsonSchemaToZod(
  schemaValue: unknown,
  rootValue: unknown = schemaValue,
): z.ZodTypeAny {
  const schema = asSchema(schemaValue);
  const root = asSchema(rootValue);
  if (typeof schema.$ref === 'string') return jsonSchemaToZod(resolveRef(root, schema.$ref), root);
  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  if (enumValues.length > 0) {
    const literals = enumValues.map((value) =>
      z.literal(value as string | number | boolean | null),
    );
    return literals.length === 1
      ? literals[0]
      : z.union(literals as [z.ZodLiteral, z.ZodLiteral, ...z.ZodLiteral[]]);
  }
  if ('const' in schema) {
    return z.literal(schema.const as string | number | boolean | null);
  }

  let result: z.ZodTypeAny;
  switch (schema.type) {
    case 'string':
      result = stringSchema(schema);
      break;
    case 'integer': {
      let number = z.number().int();
      if (typeof schema.minimum === 'number') number = number.min(schema.minimum);
      if (typeof schema.maximum === 'number') number = number.max(schema.maximum);
      result = number;
      break;
    }
    case 'number': {
      let number = z.number();
      if (typeof schema.minimum === 'number') number = number.min(schema.minimum);
      if (typeof schema.maximum === 'number') number = number.max(schema.maximum);
      result = number;
      break;
    }
    case 'boolean':
      result = z.boolean();
      break;
    case 'array': {
      let array = z.array(jsonSchemaToZod(schema.items, root));
      if (typeof schema.minItems === 'number') array = array.min(schema.minItems);
      if (typeof schema.maxItems === 'number') array = array.max(schema.maxItems);
      result = array;
      break;
    }
    case 'object': {
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, property] of Object.entries(asSchema(schema.properties))) {
        const propertySchema = jsonSchemaToZod(property, root);
        shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
      }
      let object: z.ZodObject<z.ZodRawShape> = z.object(shape);
      object = schema.additionalProperties === false ? object.strict() : object.passthrough();
      result = object;
      break;
    }
    default:
      result = z.unknown();
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const alternatives = schema.anyOf.map((alternative) => {
      const candidate = asSchema(alternative);
      const required = Array.isArray(candidate.required) ? candidate.required : [];
      const requiredShape = Object.fromEntries(required.map((key) => [String(key), z.unknown()]));
      return z.object(requiredShape).passthrough();
    });
    const anyOf =
      alternatives.length === 1
        ? alternatives[0]
        : z.union(alternatives as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    result = z.intersection(result, anyOf);
  }
  return result;
}

/** Validates an action input and returns a normalized, secret-safe error. */
export function validateActionInput(actionId: string, schema: unknown, input: unknown): unknown {
  const parsed = jsonSchemaToZod(schema).safeParse(input);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('; ');
  throw new ConnectorError(`${actionId}: ${details}`, 'VALIDATION_ERROR');
}
