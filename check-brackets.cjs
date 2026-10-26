const fs = require('fs');
const code = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = code.split('\n');

let open = 0;
for (let i=0; i<lines.length; i++) {
   const l = lines[i];
   for (let c of l) {
      if (c === '{') open++;
      if (c === '}') open--;
   }
   if (open < 0) {
      console.log(`Negative open at line ${i+1}: ${l}`);
      break;
   }
}
console.log('Final open count:', open);
