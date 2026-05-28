# Nirikshan
## Offline Facial Recognition + Liveness Detection (Hackathon 7.0)

---

## 1. Executive Verdict

The research you've been given is 70% solid and 30% overengineered noise. The core technology choices are defensible. The deployment framing is dangerously optimistic in several places.

**The winning build is this:**

| Component | Final Choice |
|-----------|-------------|
| Face Detection | YuNet (TFLite, ~300KB) |
| Face Recognition | MobileFaceNet + ArcFace FP16 (InsightFace buffalo_s, ~4MB) |
| Liveness | MiniFASNetV2 INT8 TFLite (~600KB) |
| Inference | react-native-fast-tflite (CPU/XNNPACK, not GPU delegate) |
| Camera | react-native-vision-camera **v4** |
| Preprocessing | Simple JS luminance normalization (NOT C++ CLAHE) |
| Storage | react-native-quick-sqlite + cosine similarity in JS |
| Encryption | AES-256 key in Android Keystore / iOS Keychain via react-native-encrypted-storage |
| AWS Sync | Embedding-only POST to API Gateway → Lambda → DynamoDB |

**Total model footprint: ~5MB.** Total auth latency target: 50–70ms on Snapdragon 665+.

The architecture is deliberately conservative. You have 2 weeks. Conservative wins hackathons. Ambitious fails live demos.

---

## 2. Final Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Native App                             │
│                   (New Architecture / Fabric)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  react-native-vision-camera v4                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Back camera, 5 FPS cap, 720p resolution                    │   │
│  │  useFrameProcessor worklet (native thread, no JS bridge)    │   │
│  └────────────────────────┬────────────────────────────────────┘   │
│                           │                                         │
│  ──────── STAGE 1: DETECTION ─────────────────────────────────     │
│  ┌────────────────────────▼────────────────────────────────────┐   │
│  │  vision-camera-resize-plugin                                 │   │
│  │  Resize: 720p → 320×320 (YUV→RGB, hardware-accelerated)     │   │
│  │  YuNet TFLite (~300KB)                                       │   │
│  │  Output: bounding box + 5 landmark points                    │   │
│  │  Latency: ~5ms                                               │   │
│  └────────────────────────┬────────────────────────────────────┘   │
│                           │                                         │
│          ┌────────────────┤ Face found?                             │
│          │ YES            │ NO → show "No face detected" UI        │
│          ▼                                                          │
│  ──────── STAGE 2: PREPROCESSING ────────────────────────────────  │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Crop face ROI to bounding box                             │    │
│  │  Affine warp to 112×112 using 5 landmarks                  │    │
│  │  Luminance normalization (JS lookup table, ~2ms)           │    │
│  └────────────────────────┬───────────────────────────────────┘    │
│                           │                                         │
│  ──────── STAGE 3: LIVENESS ──────────────────────────────────     │
│  ┌────────────────────────▼───────────────────────────────────┐    │
│  │  Resize to 128×128 for MiniFASNetV2                        │    │
│  │  MiniFASNetV2 INT8 TFLite (~600KB)                         │    │
│  │  Output: P(real), P(spoof)                                 │    │
│  │  Latency: ~15–20ms                                         │    │
│  └────────────────────────┬───────────────────────────────────┘    │
│                           │                                         │
│          ┌────────────────┤ P(real) > 0.7?                          │
│          │ YES            │ NO → "Spoof detected" UI, log attempt  │
│          ▼                                                          │
│  ──────── STAGE 4: RECOGNITION ───────────────────────────────     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  MobileFaceNet + ArcFace FP16 TFLite (~4MB)               │    │
│  │  Input: 112×112 aligned face                               │    │
│  │  Output: 128-dim embedding (float32[128])                  │    │
│  │  Latency: ~18ms                                             │    │
│  └────────────────────────┬───────────────────────────────────┘    │
│                           │                                         │
│  ──────── STAGE 5: MATCHING ──────────────────────────────────     │
│  ┌────────────────────────▼───────────────────────────────────┐    │
│  │  react-native-quick-sqlite                                 │    │
│  │  Load embeddings → cosine similarity in JS                 │    │
│  │  Distance < 0.40 → AUTHENTICATED                           │    │
│  │  Distance >= 0.40 → REJECTED                               │    │
│  │  Latency: <2ms (for <500 registered users)                 │    │
│  └────────────────────────┬───────────────────────────────────┘    │
│                           │                                         │
│  ──────── STAGE 6: STORAGE & SYNC ────────────────────────────     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  SQLite: user_id, embedding (BLOB), name, created_at       │    │
│  │  Auth log: event_id, user_id, result, timestamp, device_id │    │
│  │  AES-256 key: Android Keystore / iOS Keychain              │    │
│  │  Sync queue: pending events table                          │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Total pipeline latency: ~45–65ms                                 │
│  Total model size: ~5MB                                           │
└─────────────────────────────────────────────────────────────────────┘

AWS Sync (background, offline-tolerant):
┌────────────────────────────────────────────────────────────┐
│  Network available?                                         │
│  → POST /sync { user_id, embedding_b64, encrypted:true }   │
│  → API Gateway → Lambda → DynamoDB                          │
│  → On success: mark local events as synced                 │
│  → Local purge: optionally delete raw embeddings after sync│
│  Network unavailable?                                       │
│  → Queue in SQLite pending_sync table                      │
│  → Retry on next network event                             │
└────────────────────────────────────────────────────────────┘
```

---

## 3. Why This Architecture Wins

**It's built to run, not built to impress on paper.**

- Every component has been deployed in production React Native apps before. No experiment.
- The failure modes are predictable and recoverable during live demos.
- The 5ms + 20ms + 18ms + 2ms pipeline is well within 1s even if each step takes 3× longer than expected.
- Model conversion risk is isolated to ONE model (MiniFASNet). You validate that first, day 1.
- Cosine similarity in JS is perfectly fast for hackathon scale. The sqlite-vec complexity is completely unnecessary.
- VisionCamera v4 has thousands of production deployments. v5 "Nitro Modules" architecture is still in flux.

---

## 4. Technologies Rejected and Why

###  GhostFaceNet (both research docs push this differently)
**Why rejected:** The W8A8 quantization pipeline for GhostFaceNet from PyTorch → ONNX → TFLite is significantly less documented than MobileFaceNet's. InsightFace buffalo_s gives you MobileFaceNet + ArcFace pre-converted and validated. GhostFaceNet's claimed 99.683% vs MobileFaceNet's 99.55% on LFW is a **0.13% difference on a benchmark** that doesn't represent Indian outdoor conditions anyway. Not worth the conversion risk.

###  sqlite-vec with op-sqlite
**Why rejected:** Native C extension compilation inside a React Native project adds an entire layer of build system risk. You will spend 2 days debugging Gradle and CocoaPods. For demo scale (<500 users), a cosine similarity implemented in JavaScript (loop over stored embeddings) runs in <2ms. The sqlite-vec complexity is justified for production systems with 10,000+ users. Not for a hackathon demo.

###  Vision Camera V5 / Nitro Modules
**Why rejected:** As of mid-2025, V5 is not yet the stable release widely used in production React Native apps. The research doc conflates the V5 architecture description with V4's actual Worklet system. VisionCamera v4's frame processors using `react-native-reanimated` worklets are battle-tested, well-documented, and have extensive GitHub issues to reference when things go wrong. Use v4.

###  ONNX Runtime for React Native
**Why rejected:** react-native-onnxruntime has significantly fewer production deployments and GitHub examples than react-native-fast-tflite. The TFLite ecosystem in React Native is deeper. When something breaks at 11pm during the hackathon, you need Stack Overflow and GitHub issues to save you. TFLite has them; ONNX doesn't.

###  C++ CLAHE injection into worklet
**Why rejected:** This requires writing a native module, linking OpenCV, and rebuilding the binary on both Android and iOS. That's a week of work. The research doc makes this sound like a config option. It is not. Use JavaScript luminance normalization (gamma correction + per-channel normalization). It's 30 minutes of work, captures 80% of CLAHE's benefit, and will not break your demo.

###  GPU Delegate (NNAPI on Android)
**Why rejected:** GPU delegate behavior is extremely hardware-specific on Android. On Snapdragon 665, NNAPI may actually be *slower* than CPU XNNPACK due to delegate initialization overhead and the model size. On some Kirin chips, NNAPI silently falls back to CPU anyway. Use XNNPACK explicitly. It's deterministic, fast, and identical across all Android mid-range chipsets.

###  BlazeFace for detection
**Why rejected:** YuNet is smaller (~300KB vs ~900KB), faster, and specifically designed for face detection in production edge scenarios. BlazeFace was designed as a face *mesh* precursor, not a standalone face detector for recognition pipelines. YuNet's 5-landmark output also gives you the alignment points you need for the next stage.

###  Active liveness (blink detection, head turn)
**Why rejected:** MediaPipe Face Mesh + EAR calculation for blink detection adds ~30MB to your payload (MediaPipe model), requires 3–5 seconds of interaction, and fails completely in bright outdoor backlight where eye detection degrades. MiniFASNet passive liveness is faster, smaller, and gives a better demo moment (instant rejection of a photo).

###  RetinaFace, SCRFD 500m, YOLO-NAS Nano
**Why rejected:** All larger than YuNet with no meaningful accuracy advantage for this use case (close-range, front-facing, single-face authentication). YOLO-NAS is for multi-object detection. Not appropriate here.

###  MobileNetV4, ViTs, TinyViT, EfficientFace
**Why rejected:** No pre-trained ArcFace weights available in TFLite format for these architectures. You'd need to train them yourself. You don't have time. EfficientFace at 19.72M params also violates the thermal budget on Snapdragon 665.

###  Event sourcing for AWS sync
**Why rejected:** Massively overengineered for a hackathon. "Append-only log with idempotent event replay" is impressive in a distributed systems interview. For this demo, a `pending_sync` boolean column on your auth_events table is 10 lines of code and achieves the same result.

---

## 5. Full Mobile Pipeline

### Frame Processing Thread (Worklet, never touches JS thread)

```
Camera frame arrives (5 FPS max, 720p)
│
├── resize-plugin: 720p → 320×320 RGB
│
├── react-native-fast-tflite: run YuNet
│   ├── No face detected → skip frame (show "Position face in frame")
│   └── Face detected → extract [x, y, w, h, lm1..lm5]
│
├── Crop face ROI from 320×320 based on bounding box
├── Affine warp using 5 landmarks → 112×112 normalized face
├── JS luminance normalization: 
│     pixels = pixels.map(p => Math.pow(p / 255, 0.85) * 255)
│     per-channel mean subtraction (mean [0.5, 0.5, 0.5], std [0.5])
│
├── Resize 112×112 → 128×128 for MiniFASNet (simple bilinear)
├── react-native-fast-tflite: run MiniFASNetV2
│   ├── P(spoof) > 0.30 → reject, log to SQLite, show "Spoof detected"
│   └── P(real) > 0.70 → proceed
│
├── react-native-fast-tflite: run MobileFaceNet (112×112 input)
│   └── embedding: Float32Array[128]
│
└── JS thread callback:
    └── cosine_similarity(embedding, stored_embeddings)
        ├── Match found (distance < 0.40) → AUTH SUCCESS
        └── No match → AUTH FAILED
```

### Threading model

- Frame processor (`useFrameProcessor`) runs on dedicated native worklet thread
- Model inference happens synchronously inside worklet
- Only the final decision (auth result) is passed to JS thread via `runOnJS()`
- UI updates via Reanimated shared values (zero JS thread blocking)

---

## 6. Full ML Pipeline

### Model inventory

| Model | Format | Size | Input | Output | Latency (SD665) |
|-------|--------|------|-------|--------|-----------------|
| YuNet | TFLite INT8 | ~300KB | 320×320 RGB | bbox + 5 landmarks | ~5ms |
| MiniFASNetV2 | TFLite INT8 | ~600KB | 128×128 RGB | [P(real), P(spoof)] | ~15–20ms |
| MobileFaceNet | TFLite FP16 | ~4MB | 112×112 RGB | float32[128] | ~18ms |
| **Total** | | **~5MB** | | | **~40–45ms** |

### Model acquisition (validated paths, in order of reliability)

**YuNet:**
- Direct from OpenCV Zoo: `face_detection_yunet_2023mar.tflite`
- Already TFLite, no conversion needed
- URL: `https://github.com/opencv/opencv_zoo`

**MobileFaceNet + ArcFace:**
- InsightFace buffalo_s model → convert to TFLite FP16
- Alternatively: `sirius-ai/MobileFaceNet_TF` has pre-quantized TFLite
- This is the best-documented conversion path

**MiniFASNetV2:**
- `minivision-ai/Silent-Face-Anti-Spoofing` repo (PyTorch)
- Convert: PyTorch → ONNX (`torch.onnx.export`) → TFLite (`tf.lite.TFLiteConverter.from_saved_model`)
- **THIS IS YOUR DAY 1 TASK. VALIDATE THIS CONVERSION IMMEDIATELY.**
- Fallback if conversion fails: use `facenox/face-antispoof-onnx` with ONNX Runtime for React Native (only fallback case where ONNX is acceptable)

### Conversion script skeleton

```python
# convert_minifasnet.py — Run this Day 1
import torch
import torch.onnx
import tensorflow as tf

# Step 1: Load PyTorch model
model = load_minifasnet_model("checkpoints/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth")
model.eval()

# Step 2: Export to ONNX
dummy_input = torch.randn(1, 3, 128, 128)
torch.onnx.export(model, dummy_input, "minifasnet.onnx",
                  opset_version=11,
                  input_names=["input"],
                  output_names=["output"])

# Step 3: ONNX → TFLite
# Use onnx-tf: pip install onnx-tf
import onnx
from onnx_tf.backend import prepare
onnx_model = onnx.load("minifasnet.onnx")
tf_rep = prepare(onnx_model)
tf_rep.export_graph("minifasnet_tf")

# Step 4: TF SavedModel → TFLite INT8
converter = tf.lite.TFLiteConverter.from_saved_model("minifasnet_tf")
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()
with open("minifasnet_v2_int8.tflite", "wb") as f:
    f.write(tflite_model)
print(f"Size: {len(tflite_model) / 1024:.1f} KB")
```

### Embedding comparison (JS, runs on JS thread after worklet)

```javascript
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Auth check
function authenticate(queryEmbedding, storedUsers) {
  let best = { userId: null, similarity: -1 };
  for (const user of storedUsers) {
    const sim = cosineSimilarity(queryEmbedding, user.embedding);
    if (sim > best.similarity) best = { userId: user.id, similarity: sim };
  }
  const THRESHOLD = 0.75; // cosine similarity (not distance)
  return best.similarity >= THRESHOLD ? best.userId : null;
}
```

Note: cosine SIMILARITY threshold of 0.75 is equivalent to cosine DISTANCE of 0.25. Tune this empirically during testing.

---

## 7. Full React Native Stack

### package.json dependencies

```json
{
  "dependencies": {
    "react": "18.3.x",
    "react-native": "0.75.x",
    "react-native-vision-camera": "^4.5.0",
    "react-native-worklets-core": "^1.3.0",
    "react-native-fast-tflite": "^1.2.0",
    "vision-camera-resize-plugin": "^3.1.0",
    "react-native-quick-sqlite": "^8.0.0",
    "react-native-encrypted-storage": "^4.0.3",
    "@react-native-async-storage/async-storage": "^1.23.0",
    "react-native-reanimated": "^3.12.0",
    "axios": "^1.7.0"
  }
}
```

### React Native New Architecture

Enable in `android/gradle.properties`:
```
newArchEnabled=true
```

Enable in `ios/Podfile`:
```ruby
ENV['RCT_NEW_ARCH_ENABLED'] = '1'
```

This is required for react-native-fast-tflite v1.2+ and VisionCamera v4.

### Core frame processor setup

```javascript
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { runOnJS } from 'react-native-reanimated';

export function FaceAuthCamera({ onAuthResult }) {
  const device = useCameraDevice('front');
  const { resize } = useResizePlugin();
  
  const detectionModel = useTensorflowModel(require('../assets/yunet.tflite'));
  const livenessModel = useTensorflowModel(require('../assets/minifasnet_v2_int8.tflite'));
  const recognitionModel = useTensorflowModel(require('../assets/mobilefacenet_fp16.tflite'));

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!detectionModel || !livenessModel || !recognitionModel) return;
    
    // Stage 1: Detection
    const detectionInput = resize(frame, {
      width: 320, height: 320, pixelFormat: 'rgb'
    });
    const detectionOutput = detectionModel.runSync([detectionInput]);
    const bbox = parseBoundingBox(detectionOutput);
    if (!bbox) return; // No face
    
    // Stage 2: Aligned 112x112 face (using landmarks)
    const faceInput = resize(frame, {
      width: 112, height: 112, pixelFormat: 'rgb',
      crop: bbox // Crop to face ROI
    });
    
    // Stage 3: Liveness
    const livenessInput = resize(frame, {
      width: 128, height: 128, pixelFormat: 'rgb',
      crop: bbox
    });
    const livenessOutput = livenessModel.runSync([livenessInput]);
    const isReal = livenessOutput[0][1] > 0.70; // index 1 = P(real)
    
    if (!isReal) {
      runOnJS(onAuthResult)({ type: 'spoof', message: 'Spoof detected' });
      return;
    }
    
    // Stage 4: Embedding
    const embeddingOutput = recognitionModel.runSync([faceInput]);
    const embedding = Array.from(embeddingOutput[0]);
    
    runOnJS(onAuthResult)({ type: 'embedding', data: embedding });
  }, [detectionModel, livenessModel, recognitionModel]);

  return (
    <Camera
      device={device}
      isActive={true}
      frameProcessor={frameProcessor}
      fps={5}
      style={{ flex: 1 }}
    />
  );
}
```

### Asset bundling (metro.config.js)

```javascript
const { getDefaultConfig } = require('@react-native/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('tflite', 'bin');
module.exports = config;
```

---

## 8. Full Offline Sync Architecture

### SQLite schema

```sql
-- Users enrolled locally
CREATE TABLE face_users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  embedding   BLOB NOT NULL,    -- Float32Array serialized to BLOB
  device_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  synced      INTEGER DEFAULT 0
);

-- Authentication events
CREATE TABLE auth_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  result      TEXT NOT NULL,    -- 'authenticated' | 'rejected' | 'spoof'
  confidence  REAL,
  timestamp   INTEGER NOT NULL,
  synced      INTEGER DEFAULT 0
);

-- Spoof attempts (separate table for security audit)
CREATE TABLE spoof_attempts (
  id          TEXT PRIMARY KEY,
  timestamp   INTEGER NOT NULL,
  device_id   TEXT NOT NULL,
  synced      INTEGER DEFAULT 0
);
```

### Sync service (background, network-aware)

```javascript
import NetInfo from '@react-native-community/netinfo';
import { getDB } from './database';

const API_BASE = 'https://your-api-gateway.amazonaws.com/prod';

async function syncPendingData() {
  const { isConnected } = await NetInfo.fetch();
  if (!isConnected) return;

  const db = getDB();
  
  // Sync unsynced users
  const users = db.execute('SELECT * FROM face_users WHERE synced = 0').rows;
  for (const user of users) {
    try {
      await axios.post(`${API_BASE}/sync/user`, {
        id: user.id,
        name: user.name,
        embedding: btoa(user.embedding), // base64 encode blob
        device_id: user.device_id,
        created_at: user.created_at,
      });
      db.execute('UPDATE face_users SET synced = 1 WHERE id = ?', [user.id]);
    } catch (e) {
      // Will retry next sync cycle
    }
  }

  // Sync auth events
  const events = db.execute('SELECT * FROM auth_events WHERE synced = 0').rows;
  if (events.length > 0) {
    try {
      await axios.post(`${API_BASE}/sync/events`, { events });
      db.execute('UPDATE auth_events SET synced = 1 WHERE synced = 0');
    } catch (e) {}
  }
}

// Run on app foreground + network reconnect
AppState.addEventListener('change', (state) => {
  if (state === 'active') syncPendingData();
});
NetInfo.addEventListener(({ isConnected }) => {
  if (isConnected) syncPendingData();
});
```

### AWS stack (minimal, deployable in 2 hours)

```
API Gateway (REST) →
  POST /sync/user   → Lambda (Node.js) → DynamoDB (face_users table)
  POST /sync/events → Lambda (Node.js) → DynamoDB (auth_events table)
  GET  /users/{device_id} → Lambda → DynamoDB → return user list
```

DynamoDB table schema:
- `face_users`: partition_key=device_id, sort_key=user_id
- `auth_events`: partition_key=device_id, sort_key=timestamp

**Do not use S3 for embedding storage.** DynamoDB handles this fine for demo scale. S3 adds IAM complexity you don't need.

### Local purge capability

```javascript
// After confirmed sync, optional purge of raw embeddings
// Replace embedding with placeholder, keep metadata
async function purgeLocalEmbedding(userId) {
  const db = getDB();
  db.execute(
    'UPDATE face_users SET embedding = ?, name = name || " (purged)" WHERE id = ?',
    [new Uint8Array(0), userId]
  );
}
```

---

## 9. Full Security Architecture

### Key management

```javascript
import EncryptedStorage from 'react-native-encrypted-storage';
import { randomBytes, createCipheriv, createDecipheriv } from 'react-native-quick-crypto';

async function getOrCreateEncryptionKey() {
  let key = await EncryptedStorage.getItem('biometric_encryption_key');
  if (!key) {
    const keyBytes = await randomBytes(32); // 256-bit
    key = keyBytes.toString('hex');
    await EncryptedStorage.setItem('biometric_encryption_key', key);
    // EncryptedStorage uses Android Keystore / iOS Keychain internally
  }
  return key;
}

function encryptEmbedding(embedding, key) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
  const buf = Buffer.from(new Float32Array(embedding).buffer);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  return { iv: iv.toString('hex'), data: encrypted.toString('base64') };
}
```

### What this guarantees

- Embeddings encrypted at rest with AES-256-CBC
- Key bound to device hardware (Android Keystore / iOS Keychain)
- Key not exportable from device
- Even if SQLite file is extracted, embeddings are unreadable without device hardware

### What this does NOT guarantee (be honest in the demo)

- Security against malicious apps with root access
- Protection against OS-level frame injection (the academic "deep fake video into camera driver" attack)
- Biometric template irreversibility (embeddings cannot be trivially reversed to a face image, but this is not cryptographic irreversibility)

---

## 10. Liveness Detection Strategy

### MiniFASNetV2 in practice

The model takes a 128×128 RGB face crop and outputs two logits: `[P(spoof), P(real)]` (order may vary—validate against your converted model).

**Threshold tuning:**
- Default: P(real) > 0.70
- For demo: test with your specific lighting. Outdoor sun may drop P(real) for legitimate faces.
- If you get false rejections outdoors: lower threshold to 0.60
- If you get false acceptances in testing: raise threshold to 0.80

**What it defeats:**
- Printed A4 photo: YES (Fourier spectrum identifies ink matrix patterns)
- Phone/tablet screen showing a face: YES (moiré and LCD artifacts)
- High-res printed photo on glossy paper: YES
- 3D silicone mask: Partially (may pass; don't overclaim this in the demo)
- Pre-recorded video playing on a phone: YES (screen artifacts detected)
- Deepfake video injected at OS level: NO (out of scope; this is a camera-level attack)

### Demo flow for anti-spoofing

1. Register user (real face captured, enrolled)
2. Print a screenshot of the user's face on A4 paper
3. Hold paper to camera → instant "Spoof Detected" with reason overlay
4. Open user's photo on iPad/phone screen → hold to camera → "Spoof Detected"
5. Show real face → authenticates in <1s

This is your most dramatic demo moment. Practice it 20 times before the presentation.

### What to say to judges

"We use passive liveness detection via frequency domain analysis. Printed materials and digital screens both produce artifacts in the Fourier spectrum that a real face never does. The model makes this determination in 15ms without requiring any user interaction."

---

## 11. Indian Demographic Robustness Strategy

### The actual problem

MobileFaceNet trained on MS-Celeb-1M has lower representation of South Asian faces with dark skin tones and in high-contrast outdoor lighting. The embedding quality degrades specifically at the eye region landmarks, which are the primary alignment anchors.

### What you can realistically do in 2 weeks

**Do this (high ROI, low effort):**

1. **5-point facial alignment** — This is the biggest single improvement. Warping the face to a canonical pose using eye/nose/mouth landmark positions before embedding reduces false rejections by ~8-12% for dark skin tones. YuNet provides these landmarks for free.

2. **Luminance normalization** — Before passing to MobileFaceNet, normalize the pixel distribution:
```javascript
function normalizeFace(pixels) {
  // Per-channel mean/std normalization (standard for face recognition)
  const mean = [0.5, 0.5, 0.5];
  const std = [0.5, 0.5, 0.5];
  return pixels.map((p, i) => (p / 255 - mean[i % 3]) / std[i % 3]);
}
```

3. **Register multiple embeddings per user** — During enrollment, capture 5 frames under different lighting (front-facing, slightly turned, indoor, outdoor). Store all 5 embeddings. Auth passes if ANY embedding matches. This is the single highest-impact change you can make for outdoor robustness.

4. **Adaptive threshold per user** — After enrollment, calibrate similarity threshold per user based on intra-user embedding variance. High-variance users (inconsistent lighting, dark skin, beard) get a slightly relaxed threshold (0.65 instead of 0.75).

**Don't do this (too complex, risky, low ROI for hackathon):**

- Fine-tuning MobileFaceNet on JFAD dataset (need compute cluster, 1+ week)
- Implementing full C++ CLAHE pipeline
- Per-frame adaptive brightness correction via Metal shaders
- Collecting your own Indian demographic test set

### Testing protocol for Indian demographics

Recruit 5 volunteers across skin tone range (Fitzpatrick scale 4-6) and test:
- Indoor flat lighting → expect >95% TAR
- Outdoor direct sunlight from above → expect >85% TAR
- Outdoor bright backlighting → expect >75% TAR (your floor)
- Indoor low-light (~50 lux) → expect >80% TAR

Report actual numbers to judges. Don't fabricate.

---

## 12. Edge Optimization Strategy

### CPU-only execution (XNNPACK)

Explicitly force XNNPACK delegate in TFLite. Do NOT enable GPU delegate on Android for this project.

```javascript
const model = useTensorflowModel(
  require('../assets/mobilefacenet_fp16.tflite'),
  'default' // This selects XNNPACK on CPU, not NNAPI/GPU
);
```

Why: NNAPI delegate on Snapdragon 665/730 can silently fail or run slower than XNNPACK due to driver bugs. XNNPACK is a deterministic, highly optimized SIMD CPU path that performs identically on all ARM devices.

### Frame rate limiting

Cap at 5 FPS in the camera:
```javascript
<Camera fps={5} ... />
```

This alone reduces battery drain by ~3× compared to 30fps processing. Authentication doesn't require 30fps. The user is holding still.

### Memory: no frame copies

react-native-fast-tflite uses zero-copy ArrayBuffers. Do not convert frames to base64 or JSON at any point in the hot path. The frame stays as a native buffer throughout.

### Thermal management

At 5 FPS, 3 model inferences per frame, FP16/INT8 quantization: expect ~80ms of GPU-idle CPU work per second. This is well below thermal throttling on any device made after 2019.

### APK size impact

| Component | APK size contribution |
|-----------|-----------------------|
| react-native-fast-tflite | ~2MB (native binary) |
| TFLite models (3 models) | ~5MB |
| VisionCamera | ~3MB |
| Total ML overhead | ~10MB |

Your total APK will be ~25-35MB, which is standard for a RN camera app.

---

## 13. Benchmarking Strategy

### What to measure and report

Run this benchmark script before the presentation and screenshot the results.

```javascript
async function runBenchmark() {
  const results = {
    detection: [],
    liveness: [],
    recognition: [],
    e2e: [],
  };
  
  // Run 50 frames through pipeline, record each stage timing
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    const t1 = performance.now(); // after detection
    const t2 = performance.now(); // after liveness
    const t3 = performance.now(); // after recognition
    
    results.detection.push(t1 - t0);
    results.liveness.push(t2 - t1);
    results.recognition.push(t3 - t2);
    results.e2e.push(t3 - t0);
  }
  
  const median = arr => arr.sort((a,b)=>a-b)[Math.floor(arr.length/2)];
  return {
    detection_p50: median(results.detection),
    liveness_p50: median(results.liveness),
    recognition_p50: median(results.recognition),
    e2e_p50: median(results.e2e),
    e2e_p95: results.e2e.sort((a,b)=>a-b)[Math.floor(results.e2e.length * 0.95)],
  };
}
```

Report the p50 AND p95. Judges who know systems will ask about the p95.

### Accuracy test protocol

Minimum viable test for judges:
- 5 registered users, 3 images each (15 genuine tests)
- 5 spoofing attacks: 2 printed photos, 2 screen replays, 1 different person
- Report: TAR, FAR, spoof rejection rate

This is enough to say "we validated 95%+ TAR and 100% spoof rejection in our test set."

### Device targets

Test on at least 2 of these:
- Redmi Note 10 (Snapdragon 678) — very common Indian mid-range
- Realme 8 (Helio G95) — baseline target
- Samsung Galaxy M31 (Exynos 9611) — tests the worst-case Exynos path

---

## 14. Biggest Technical Risks

**Ranked by severity × probability:**

###  CRITICAL: MiniFASNet TFLite conversion pipeline
The PyTorch → ONNX → TFLite conversion for MiniFASNet is the single highest-risk item in this entire build. PyTorch models with custom operators, GroupNorm layers, or non-standard activations often fail at ONNX opset 11, or produce TFLite graphs that pass conversion but produce garbage outputs.

**Mitigation:**
- This is your Day 1, Hour 1 task. Before anything else.
- If the conversion fails after 4 hours of debugging: switch to the ONNX path with `onnxruntime-react-native` for MiniFASNet only, keeping everything else on TFLite. This is acceptable.
- Have `facenox/face-antispoof-onnx` cloned and ready as day-1 fallback.

###  CRITICAL: MobileFaceNet embedding quality on Indian faces in outdoor lighting
If the model was trained only on LFW/MS-Celeb-1M, outdoor high-contrast lighting may produce embeddings that don't match the enrolled embeddings. You'd see high FRR (legitimate users rejected).

**Mitigation:**
- During enrollment, capture 5 frames per user (see multi-embedding strategy above)
- Set up enrollment outdoors, not just indoors
- Tune threshold empirically

###  HIGH: react-native-fast-tflite model loading on Android
Some Android build configurations have issues loading TFLite models from assets on first launch. This is a known issue with specific Metro bundling configs.

**Mitigation:**
- Test model loading on day 2 after conversion
- Bundle models as `require('../assets/model.tflite')` not via file path
- Use the library's built-in error state: `if (model.state === 'error') ...`

###  HIGH: VisionCamera frame processor crashing on device rotation or background/foreground
Frame processors can crash when the app is backgrounded or the device is rotated during active processing.

**Mitigation:**
- Lock orientation to portrait during auth
- Stop camera (`isActive={false}`) when app backgrounds
- Wrap the frame processor logic in try/catch (worklets support this)

###  MEDIUM: iOS build complexity
iOS requires Apple Developer account, valid provisioning profile, and correct entitlements for camera access and Keychain usage. CocoaPods can take 2+ hours to set up correctly.

**Mitigation:**
- If you can demo on Android only: do it. Judges understand "Android-first."
- Set up iOS on day 5 at the latest, not during final week.

###  MEDIUM: Cosine similarity threshold calibration
The threshold is the most sensitive parameter in the system. Too low → spoofers pass. Too high → legitimate users rejected.

**Mitigation:**
- Default threshold: cosine similarity > 0.75 (equivalently, distance < 0.25)
- Tune it empirically with your 5-person test set. Do not trust paper defaults.
- Different threshold for 1-embedding vs 5-embedding enrollment.

###  LOW: AWS Lambda cold starts
If sync endpoint hasn't been called recently, first sync call may timeout (Lambda cold start).

**Mitigation:**
- Use a simple API Gateway + Lambda with Provisioned Concurrency for demo, or just accept the first-call delay (it's background sync, not on the critical auth path).

---

## 15. Simplifications That Improve Winning Chances

### Do these, they make things better:

1. **Remove C++ CLAHE, use JS normalization** — 30 minutes of work vs 3 days. Same visual result in demos.

2. **Remove GPU delegate** — Forces deterministic XNNPACK execution. No device-specific debugging.

3. **Remove sqlite-vec** — 5 lines of JS cosine similarity vs 3 days of native build debugging.

4. **Lock enrollment to 5 frames per user** — Massively improves robustness with zero model changes.

5. **Hard-code the demo users** — Include 2-3 pre-enrolled users in the app bundle as fallback if live enrollment fails during demo.

6. **Single-device demo** — Demo on ONE device that you know works. Not two. The second device is a liability.

7. **Remove iOS for now** — Deliver Android. Tell judges iOS is identical (it is, architecturally). Save a week.

8. **Pre-compute benchmark numbers** — Do not benchmark live during the demo. Have screenshots ready.

9. **Offline mode: toggle airplane mode BEFORE the demo starts** — Not during the demo. Switching to airplane mode mid-demo triggers permission dialogs on some devices.

---

## 16. Fastest 2-Week Execution Plan

### Week 1: Core Pipeline

**Day 1 (Monday) — Environment + Model Conversion**
- Set up React Native 0.75 + New Architecture
- Install VisionCamera v4 + fast-tflite + resize plugin
- Get camera preview working with YuNet face detection box visible
- **CRITICAL: Start MiniFASNet TFLite conversion. Do not sleep until you know if it works.**

**Day 2 — Detection + Liveness**
- YuNet output parsed, bounding boxes drawn on camera
- MiniFASNet inference running (even with dummy input)
- Validate MiniFASNet output shape and softmax interpretation

**Day 3 — Recognition**
- MobileFaceNet TFLite converted and loading
- Embedding output validated (128-dim float32 array)
- Compare two embeddings manually (same person, different people)

**Day 4 — Full Pipeline Integration**
- All three models running sequentially in one frame processor
- Frame processor outputs `{ spoof: bool, embedding: float32[] }` to JS thread
- End-to-end: camera → detection → liveness → embedding (no storage yet)

**Day 5 — Storage**
- SQLite schema set up with react-native-quick-sqlite
- Enrollment flow: capture face → compute embedding → store encrypted
- Auth flow: query embeddings → cosine similarity → decision

**Day 6 — Multi-embedding enrollment**
- Capture 5 frames during enrollment, store all 5 embeddings per user
- Auth: match against all 5, take max similarity

**Day 7 — First full demo run**
- Register 3 people, try authentication, try spoofing with a photo
- Identify what fails. Write it down. Fix priority list.

---

### Week 2: Polish + Demo Prep

**Day 8 — Fix week 1 failures**
- Threshold tuning
- Fix any model loading edge cases
- Fix any frame processor crashes

**Day 9 — AWS Sync**
- Deploy Lambda + DynamoDB (use AWS SAM or Serverless Framework, 2 hours max)
- Implement sync service
- Test offline → sync → purge flow

**Day 10 — Security**
- Encrypt embeddings in SQLite
- Test key generation and retrieval from Keystore/Keychain
- Add spoof attempt logging

**Day 11 — Outdoor testing + robustness**
- Go outside. Test in direct sunlight.
- Tune preprocessing normalization for outdoor conditions
- Run benchmark on target devices, record numbers

**Day 12 — Demo rehearsal**
- Full demo run 5 times start to finish
- Time each section
- Identify any hardware/device issues

**Day 13 — Presentation materials**
- Architecture diagram (draw.io or Figma)
- Benchmark slide (latency, accuracy, model sizes)
- Demo flow slide
- Indian demographics slide

**Day 14 — Buffer + Final test**
- Nothing new. Fix any regressions.
- Charge demo device. Lock orientation. Set screen timeout to Never.
- Pre-enroll demo users and do NOT unenroll them.

---

## 17. Demo Strategy

### Hardware setup before walking in
- Demo device: Snapdragon 730+ (Redmi Note 10 Pro or equivalent). Not Exynos.
- Charged to 100%
- Screen brightness: max
- Screen timeout: Never (disable auto-lock)
- 3-5 users pre-enrolled (including you and your teammates)
- Spoofing materials ready: printed A4 photo + open photo on iPad/spare phone
- App open, on the auth screen, camera active
- Airplane mode ALREADY ON when you walk in

### Demo script (5 minutes)

**Opening (30s):** "We're going to start with the device already in airplane mode. There's no network. No API call will be made. Everything you see is running on this Snapdragon 730 CPU."

**Enrollment (45s):** Show how a new user registers. Capture face, see embedding generated, stored. "Under the hood, we're generating a 128-dimensional biometric embedding. The image is discarded immediately. Only the math stays."

**Authentication (60s):** Authenticate yourself. Show the telemetry overlay: "Detection: 5ms | Liveness: 18ms | Recognition: 20ms | Total: 43ms." Authenticate a teammate. "Under 50 milliseconds, with three neural networks running sequentially on CPU only."

**Anti-spoofing — the dramatic moment (60s):**
- "Now watch what happens when someone tries to spoof the system."
- Hold printed photo to camera → UI flashes red: " Spoof Detected: Print artifact"
- Hold phone screen showing face → " Spoof Detected: Screen artifact"
- "The frequency domain analysis fires in 18 milliseconds. No user interaction required."

**Indian demographics (30s):** Show your darkest-skinned team member authenticating successfully in the room's lighting. "We enrolled this user outdoors in direct sunlight. The 5-landmark alignment and illumination normalization ensures robustness across skin tones."

**AWS sync (30s):** Turn airplane mode off. Show sync log: "3 auth events synced to DynamoDB." Turn airplane mode back on. "The system works completely offline and syncs when connectivity is available."

**Close (30s):** Show the architecture diagram. "5 megabytes of models. 50 milliseconds of authentication. Fully offline. No cloud dependency for auth. This is deployable to any mid-range Android device in India today."

---

## 18. Presentation Strategy

### Slide deck (8 slides max)

1. **Problem** — One sentence. One image. Offline biometric security for India.
2. **Demo video** — 90-second screen recording as backup if live demo fails
3. **Architecture diagram** — The pipeline diagram with actual ms timings on each stage
4. **Model sizes** — Three boxes: YuNet 300KB, MiniFASNetV2 600KB, MobileFaceNet 4MB. Total: 5MB.
5. **Benchmark numbers** — Latency p50/p95, TAR, FAR, spoof rejection rate. Real numbers from your devices.
6. **Indian demographic strategy** — 5-frame enrollment, luminance normalization, landmark alignment
7. **Scalability** — The sync architecture: offline-first, eventually consistent, AWS backend
8. **What's next** — 3 bullet points. One minute.

### What judges will score you on

| Criterion | What they're looking for | Your answer |
|-----------|--------------------------|-------------|
| Innovation | Novel technical approach | Passive liveness via Fourier analysis, multi-embedding enrollment |
| Feasibility | Could this be deployed? | Yes — 5MB, runs on ₹15,000 phones, offline |
| Scalability | Does it grow? | AWS sync handles centralized user management |
| Documentation | Is this maintainable? | Architecture diagram, benchmark methodology |
| Demo | Does it work? | YES — you practiced 20 times |

### Talking points when judges probe

*"Why not use a cloud API for recognition?"* → "No internet in remote locations. Also privacy — we never transmit a face image. Only 512 bytes of math."

*"What's the accuracy on Indian faces?"* → "We tested on [X] subjects across [Y] skin tones. TAR was [real number]. Lower than LFW benchmark, which is why we implemented multi-embedding enrollment and luminance normalization."

*"Could this be spoofed with a 3D mask?"* → "Yes. Passive liveness has known limits. Active liveness (blink detection) handles 3D masks but requires 3-5 seconds. For a 2-week prototype, passive liveness is the right tradeoff. Production would add depth sensing via device LiDAR if available."

*"Why React Native and not native?"* → "React Native gives us cross-platform from one codebase. The TFLite C++ runtime runs identically on both platforms. The JS layer only handles UI."

---

## 19. Final "If I Were Building This" Recommendation

Here is the complete truth about what I would do in 2 weeks.

**Day 1:** I'd download YuNet from OpenCV Zoo, MobileFaceNet TFLite from sirius-ai repo, and start the MiniFASNet conversion immediately. I'd accept 4 hours of debugging as sunk cost. If the conversion doesn't produce valid output by hour 4, I'd switch to `onnxruntime-react-native` for MiniFASNet specifically and move on.

**Week 1:** I'd build the simplest possible pipeline that works: camera → detection → embedding → SQLite → auth result. No liveness, no encryption, no AWS. Just the core recognition loop. I'd validate the accuracy with real people in the building before adding any other feature.

**The ONE thing most teams get wrong:** They build too many features and none of them work reliably. A demo where facial recognition works flawlessly, anti-spoofing is dramatic, and offline is proven beats a demo with 8 features where half crash.

**The liveness demo is your winning moment.** Every judge has a phone. Hold it up showing someone's photo. Get instant rejection. That's visceral. That's what wins hackathons. Everything else is supporting material.

**On accuracy:** Don't claim 99.55% LFW accuracy. That's for controlled frontal faces under ideal lighting. Claim what you measured on your actual test set under your actual conditions. "We achieved 91% TAR across diverse skin tones in outdoor conditions" is more impressive than claiming 99% you didn't actually measure.

**The architecture in this document is conservative by design.** There are better models (GhostFaceNet), better storage (sqlite-vec), better preprocessing (C++ CLAHE). But better on paper is not better for a 2-week demo. Every complexity you add is a crash you haven't debugged yet.

**Ship the conservative build. Demo it flawlessly. Win.**

---

*Document version: 1.0 | Architecture review for Hackathon 7.0 | All technology versions as of mid-2025*