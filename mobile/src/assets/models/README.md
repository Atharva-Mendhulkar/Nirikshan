# Model Assets

Replace the placeholder files in this directory before enabling real model mode.

- `yunet_detector.tflite`: face detector, validated bbox + 5 landmark decoding.
- `minifasnet_v2.tflite`: liveness model, validated input shape and class order.
- `mobilefacenet_arcface.tflite`: recognition model, validated 128-dim embedding output.

Run `npm run model:gate` from `mobile/` to see the current asset status. Run
`npm run model:gate:strict` in CI or before a device demo.
