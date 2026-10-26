const fs = require('fs');
let text = fs.readFileSync('src/App.tsx', 'utf-8');
const searchStr = "import React, { useState, useEffect, useRef, useCallback } from 'react';";
let idx = text.indexOf(searchStr); // first one
idx = text.indexOf(searchStr, idx + 100); // second one

if (idx > 0) {
  let restored = text.substring(idx);
  
  // Also prepend mediapipe import
  restored = `import { FilesetResolver, FaceLandmarker, HandLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";\n` + restored;
  
  fs.writeFileSync('src/App.tsx', restored);
  console.log("Restored correctly!");
} else {
  console.log("Not found.");
}
