import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const defaultExportDir = path.join(process.cwd(), "exports");

export function exportStorageDir() {
  return process.env.EXPORT_DIR || defaultExportDir;
}

export async function writeExportFile(fileName: string, content: string) {
  const dir = exportStorageDir();
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export async function readExportFile(filePath: string) {
  return readFile(filePath, "utf8");
}
