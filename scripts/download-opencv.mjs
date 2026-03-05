import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, "..", "public", "opencv.js");

if (existsSync(dest)) {
  console.log("opencv.js already exists, skipping download.");
  process.exit(0);
}

const url = "https://cdn.jsdelivr.net/npm/opencv.js@1.2.1/opencv.js";

console.log("Downloading OpenCV.js (~8 MB)...");

try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log(`Downloaded opencv.js (${(buf.length / 1e6).toFixed(1)} MB)`);
} catch (e) {
  console.error("Failed to download OpenCV.js:", e.message);
  console.error("You can manually download it from:", url);
  console.error("Place it at: public/opencv.js");
  process.exit(1);
}
