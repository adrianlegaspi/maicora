import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Persists the stamped XML (docs/mvp/13-roadmap.md, "XML/PDF persistence").
 *
 * ponytail: the local filesystem, because a self-hosted Docker install is the
 * MVP's deployment target and it already has a volume. Swapping in Supabase
 * Storage or S3 means changing this function and nothing else - the invoice
 * row only ever holds the returned path.
 */
export function cfdiStorageDir(): string {
  return resolve(process.env.CFDI_STORAGE_DIR ?? "./storage/cfdi");
}

export async function saveCfdiXml(tenantId: string, uuid: string, xml: string): Promise<string> {
  const path = join(cfdiStorageDir(), tenantId, `${uuid}.xml`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, xml, "utf8");
  return path;
}
