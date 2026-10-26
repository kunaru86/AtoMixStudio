const fs = require('fs');
const ts = require('typescript');

const code = fs.readFileSync('src/App.tsx', 'utf-8');
const sf = ts.createSourceFile('App.tsx', code, ts.ScriptTarget.Latest, true);

function visit(node) {
  ts.forEachChild(node, visit);
}

try {
  visit(sf);
  console.log("AST parses, looking for end of file issues...");
  let lastNode;
  const visitLast = (n) => { lastNode = n; ts.forEachChild(n, visitLast); };
  visitLast(sf);
  console.log(lastNode.getText());
} catch(e) {
  console.log(e);
}
