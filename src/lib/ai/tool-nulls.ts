import { asSchema, jsonSchema, type JSONSchema7, type ToolSet } from "ai";

// Models (Groq/Llama especially) send `null` for optional tool parameters, and
// Groq rejects the call server-side against the JSON schema before our code
// runs. So: the schema sent to the provider allows null on every optional
// property, and nulls on optional properties are stripped back to "absent"
// before the tool's real schema validates. Required properties still reject null.
// shortcut: handles properties/items only (no $ref/anyOf traversal) — extend if a tool needs it.

type Node = JSONSchema7 & { properties?: Record<string, Node>; items?: Node; required?: string[] };

function nullable(schema: Node): Node {
  const properties = schema.properties && Object.fromEntries(
    Object.entries(schema.properties).map(([key, child]) => {
      const inner = nullable(child);
      return [key, schema.required?.includes(key) ? inner : { anyOf: [inner, { type: "null" }] }];
    }),
  );
  const items = schema.items && !Array.isArray(schema.items) ? nullable(schema.items as Node) : schema.items;
  return { ...schema, ...(properties && { properties }), ...(items && { items }) } as Node;
}

export function stripOptionalNulls(value: unknown, schema: Node): unknown {
  if (Array.isArray(value)) return schema.items ? value.map((v) => stripOptionalNulls(v, schema.items as Node)) : value;
  if (value === null || typeof value !== "object" || !schema.properties) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const child = schema.properties[key];
    if (v === null && child && !schema.required?.includes(key)) continue;
    out[key] = child ? stripOptionalNulls(v, child) : v;
  }
  return out;
}

export function tolerateNullOptionals<TOOLS extends ToolSet>(tools: TOOLS): TOOLS {
  const wrapped: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(tools)) {
    const original = (def as { inputSchema?: unknown }).inputSchema;
    if (!original) {
      wrapped[name] = def;
      continue;
    }
    const base = asSchema(original as never);
    const root = base.jsonSchema as Node;
    wrapped[name] = {
      ...def,
      inputSchema: jsonSchema(nullable(root) as JSONSchema7, {
        validate: (value) => {
          const cleaned = stripOptionalNulls(value, root);
          return base.validate ? base.validate(cleaned) : { success: true, value: cleaned };
        },
      }),
    };
  }
  return wrapped as TOOLS;
}
