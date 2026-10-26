const fs = require('fs');
let text = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = text.split('\n');

const res = [];
let skipStart = 0;
// We added lines 1, 2 = imports
// We added function CameraUIPreview between 4 and 20 roughly
// let's just find where it is duplicated
for(let i=0; i<lines.length; i++) {
  if (lines[i].includes('import { FilesetResolver, FaceLandmarker, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";')) {
     if (res.length > 5) {
       res.push(lines[i]);
     } 
  } else if (lines[i].startsWith('function CameraUIPreview')) {
     // keep only if we haven't seen it
     const already = res.some(l => l.startsWith('function CameraUIPreview'));
     if (already) {
        while(i < lines.length && !lines[i].startsWith('}')) {
          i++;
        }
     } else {
        res.push(lines[i]);
     }
  } else {
     res.push(lines[i]);
  }
}
fs.writeFileSync('src/App.tsx', res.join('\n'));
