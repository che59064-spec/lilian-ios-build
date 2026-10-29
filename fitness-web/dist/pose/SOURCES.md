# 动作校对本地资源

- Runtime: `@mediapipe/tasks-vision` 0.10.32, Apache-2.0, copied from the pinned npm package by `tools/prepare_pose_assets.mjs`. The classic-worker file wraps the self-contained CJS exports in a `Vision` namespace; inference code is unchanged.
- Model: Google MediaPipe Pose Landmarker Lite, float16/v1, 5,777,746 bytes.
- Original model: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- Model guide: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- Project and license: https://github.com/google-ai-edge/mediapipe ; see LICENSE.txt.

The runtime, WASM and model are bundled with the app. Camera frames and landmarks stay in device memory; there are no inference CDN requests, video uploads or recordings. `worker.js` runs inference in a classic worker where OffscreenCanvas is supported; the compatibility path runs at a lower frame rate on the main thread. This is projected-pose/reference comparison, not a validated classifier of correct exercise technique.

Version selection: 1.1.1 was rejected during network QA because the SDK emitted requests to Google's statistics endpoint. The pinned 0.10.32 runtime is checked for that endpoint during asset preparation; runtime network QA covers both inference paths. Reassess SDK telemetry before upgrading.
