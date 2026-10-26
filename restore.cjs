const fs = require('fs');
let text = fs.readFileSync('src/App.tsx', 'utf-8');
const searchStr = "import React, { useState, useEffect, useRef, useCallback } from 'react';";
const idx = text.indexOf(searchStr, 100); 

if (idx > 0) {
  let restored = text.substring(idx);
  // Also put back the mediapipe imports if we need them, we can add them manualy.
  fs.writeFileSync('src/App.tsx', restored);
  console.log("Restored correctly!");
} else {
  console.log("Not found.");
}
