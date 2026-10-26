const fs = require('fs');
const code = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = code.split('\n');

let open = 0;
for (let i=0; i<lines.length; i++) {
   const l = lines[i];
   for (let j=0; j<l.length; j++) {
      if (l[j] === '{') open++;
      if (l[j] === '}') open--;
   }
   if (i > 1000 && i % 100 === 0) console.log(i, open, l.substring(0, 30));
}
console.log('Final open count:', open);
