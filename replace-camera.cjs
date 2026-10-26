const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const tso1 = code.indexOf(`} else if (layer.type === 'camera' && cameraVideoRef.current && cameraVideoRef.current.readyState >= 2 && segmentationCanvasRef.current) {`);
const tso2 = code.indexOf(`} else if (layer.type === 'video' && mediaVideoRef.current && mediaVideoRef.current.readyState >= 2) {`, tso1);

const cameraLogic = `
        } else if (layer.type === 'camera' && cameraVideoRef.current && cameraVideoRef.current.readyState >= 2 && segmentationCanvasRef.current) {
          const video = cameraVideoRef.current;
          const segCanvas = segmentationCanvasRef.current;
          segCanvas.width = video.videoWidth;
          segCanvas.height = video.videoHeight;
          const segCtx = segCanvas.getContext('2d');
          if (segCtx) {
            segCtx.fillStyle = 'black';
            segCtx.fillRect(0, 0, segCanvas.width, segCanvas.height);

            const startTimeMs = performance.now();
            let faceResult = (window as any).faceResult;
            let handResult = (window as any).handResult;
            
            if (video.currentTime !== (window as any).lastVideoTime) {
              (window as any).lastVideoTime = video.currentTime;
              if ((window as any).faceLandmarker) faceResult = (window as any).faceLandmarker.detectForVideo(video, startTimeMs);
              if ((window as any).handLandmarker) handResult = (window as any).handLandmarker.detectForVideo(video, startTimeMs);
              (window as any).faceResult = faceResult;
              (window as any).handResult = handResult;
            }

            const drawingUtils = new DrawingUtils(segCtx);
            segCtx.save();
            // Mirror
            segCtx.translate(segCanvas.width, 0);
            segCtx.scale(-1, 1);

            if (faceResult?.faceLandmarks) {
              for (const landmarks of faceResult.faceLandmarks) {
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: activeColor, lineWidth: 1 });
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: activeColor, lineWidth: 1.5 });
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: activeColor, lineWidth: 1.5 });
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: activeColor, lineWidth: 1.5 });
              }
            }

            if (handResult?.landmarks) {
              for (const landmarks of handResult.landmarks) {
                drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: activeColor, lineWidth: 2 });
                drawingUtils.drawLandmarks(landmarks, { color: activeColor, lineWidth: 1, radius: 2 });
              }
            }
            segCtx.restore();

            ctx.save();
            ctx.globalAlpha = activeOpacity;
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.translate(canvas.width/2 + offsetX, canvas.height/2 + offsetY);
            ctx.rotate((layer.rotation || 0) * Math.PI / 180);
            ctx.scale(layer.scale, layer.scale);
            
            const scale = Math.max(canvas.width / segCanvas.width, canvas.height / segCanvas.height);
            const w = segCanvas.width * scale;
            const h = segCanvas.height * scale;
            ctx.drawImage(segCanvas, -w/2, -h/2, w, h);
            
            ctx.restore();
          }
`;

code = code.substring(0, tso1) + cameraLogic + code.substring(tso2);

code = `import { FilesetResolver, FaceLandmarker, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";\n` + code;

fs.writeFileSync('src/App.tsx', code);
