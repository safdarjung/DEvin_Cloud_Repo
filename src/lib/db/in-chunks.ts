// PostgREST encodes `.in()` lists in the URL, so a few hundred uuids overflow it
// ("URI too long"). Run the query once per chunk of <=100 ids and concatenate
// in input order; any chunk error throws, so results are never silently partial.
// shortcut: no paging inside a chunk (max_rows 1000 applies per chunk); upgrade
// if a single chunk can legitimately match >1000 rows.
export const IN_CHUNK_SIZE = 100;

export async function inChunks<T>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const { data, error } = await run(ids.slice(i, i + IN_CHUNK_SIZE));
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}
