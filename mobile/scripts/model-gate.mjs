import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const strict = process.argv.includes('--strict');
const root = process.cwd();
const models = [
  ['Face detector', 'src/assets/models/yunet_detector.tflite'],
  ['Liveness', 'src/assets/models/minifasnet_v2.tflite'],
  ['Recognition', 'src/assets/models/mobilefacenet_arcface.tflite'],
];

let failures = 0;

for (const [label, relativePath] of models) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures += 1;
    console.error(`${label}: missing ${relativePath}`);
    continue;
  }

  const size = fs.statSync(absolutePath).size;
  if (size < 1024) {
    failures += 1;
    console.error(`${label}: placeholder or invalid asset (${size} bytes)`);
    continue;
  }

  console.log(`${label}: present (${(size / 1024).toFixed(1)} KB)`);
}

if (strict && failures > 0) {
  process.exit(1);
}

if (failures > 0) {
  console.log(`Model gate found ${failures} unresolved model assets.`);
}
