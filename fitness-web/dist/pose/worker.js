/* MediaPipe's WASM loader uses importScripts: keep this a classic worker. */
importScripts('./vision_bundle.js');
let detector;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const files = await Vision.FilesetResolver.forVisionTasks(new URL('./wasm', self.location.href).href);
      detector = await Vision.PoseLandmarker.createFromOptions(files, {
        canvas: new OffscreenCanvas(640, 480),
        baseOptions: { modelAssetPath: new URL('./pose_landmarker_lite.task', self.location.href).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 2,
        minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
        outputSegmentationMasks: false,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  } else if (data.type === 'frame') {
    try {
      const result = detector.detectForVideo(data.frame, data.timestamp);
      self.postMessage({ type: 'result', landmarks: result.landmarks, timestamp: data.timestamp });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { data.frame.close(); }
  }
};
