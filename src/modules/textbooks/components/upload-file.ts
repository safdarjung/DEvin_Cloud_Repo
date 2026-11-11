// Browser side of the curriculum material upload (documents pattern, 0067):
// request (material + pending documents row + signed upload URL) -> PUT the
// bytes straight to private storage with progress -> confirm (server checks
// the object exists and its first bytes match the type). Imported only by
// client components.
import { describeActionError } from "@/lib/action-error";
import { checkUploadFile } from "@/modules/documents/upload-check";
import { confirmMaterialUpload, requestMaterialUpload } from "@/modules/textbooks/materials.actions";

export interface UploadTarget {
  gradeId: string;
  subjectId: string;
  unitId?: string;
}

export type UploadOutcome =
  | { ok: true; materialId: string; fileName: string; sizeBytes: number; targets: { gradeId: string; gradeName: string; subjectId: string; subjectName: string; units: { id: string; title: string }[] }[] }
  | { ok: false; error: string };

function put(url: string, file: File, onProgress: (pct: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key) xhr.setRequestHeader("apikey", key);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

export async function uploadMaterialFile(
  institutionSlug: string,
  file: File,
  opts: { target?: UploadTarget; private?: boolean },
  onProgress: (pct: number) => void,
): Promise<UploadOutcome> {
  const bad = checkUploadFile(file);
  if (bad) return { ok: false, error: bad };
  const req = await requestMaterialUpload(institutionSlug, {
    fileName: file.name.slice(0, 200),
    mime: file.type as "application/pdf",
    sizeBytes: file.size,
    ...(opts.target ? { target: opts.target } : {}),
    ...(opts.private ? { private: true } : {}),
  });
  if (!req.ok) return { ok: false, error: describeActionError(req.error) };
  onProgress(0);
  if (!(await put(req.data.signedUrl, file, onProgress))) return { ok: false, error: "The file could not be uploaded. Check your connection and try again." };
  const done = await confirmMaterialUpload(institutionSlug, { materialId: req.data.materialId });
  if (!done.ok) return { ok: false, error: describeActionError(done.error) };
  return { ok: true, materialId: done.data.materialId, fileName: done.data.fileName, sizeBytes: done.data.sizeBytes, targets: done.data.targets };
}
