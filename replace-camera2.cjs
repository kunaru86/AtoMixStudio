const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const tso1 = code.indexOf(`if (vjState.isCameraActive) {`);
const tso2 = code.indexOf(`} catch (e) {`, tso1);

const newLogic = `if (vjState.isCameraActive) {
                          const stream = cameraVideoRef.current?.srcObject as MediaStream;
                          stream?.getTracks().forEach(t => t.stop());
                          updateVjSetting('isCameraActive', false);
                        } else {
                          try {
                            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                            if (cameraVideoRef.current) {
                              cameraVideoRef.current.srcObject = stream;
                              cameraVideoRef.current.play();
                            }
                            updateVjSetting('isCameraActive', true);

                            if (!(window as any).faceLandmarker && !(window as any).isLandmarkersInitializing) {
                              (window as any).isLandmarkersInitializing = true;
                              const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
                              (window as any).faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                                baseOptions: {
                                  modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                                  delegate: "GPU"
                                },
                                outputFaceBlendshapes: false,
                                runningMode: "VIDEO",
                                numFaces: 1
                              });
                              (window as any).handLandmarker = await HandLandmarker.createFromOptions(vision, {
                                baseOptions: {
                                  modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                                  delegate: "GPU"
                                },
                                runningMode: "VIDEO",
                                numHands: 2
                              });
                              (window as any).isLandmarkersInitializing = false;
                            }
                            `;

code = code.substring(0, tso1) + newLogic + code.substring(tso2);
fs.writeFileSync('src/App.tsx', code);
