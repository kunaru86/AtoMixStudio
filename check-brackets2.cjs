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
   if (l.includes('function VJPanel')) console.log('VJPanel start open count:', open);
   if (l.includes('function Slider')) console.log('Slider start open count:', open);
}
console.log('Final open count:', open);
