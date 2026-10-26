const fs = require("fs");
const path = require("path");
const AppPath = path.join(__dirname, "src", "App.tsx");

let content = fs.readFileSync(AppPath, "utf-8");
content = content.replace(/text-\[8px\]/g, "text-fluid-xs");
content = content.replace(/text-\[9px\]/g, "text-fluid-xs");
content = content.replace(/text-\[10px\]/g, "text-fluid-sm");
content = content.replace(/text-\[11px\]/g, "text-fluid-sm");
content = content.replace(/text-xs/g, "text-fluid-sm");
content = content.replace(/text-\[12px\]/g, "text-fluid-base");
content = content.replace(/text-sm/g, "text-fluid-base");
content = content.replace(/text-lg/g, "text-fluid-lg");
content = content.replace(/text-xl/g, "text-fluid-xl");
content = content.replace(/text-2xl/g, "text-fluid-2xl");

// Replace hardcoded sizes in style={{}}
content = content.replace(/w-\[340px\]/g, "w-[var(--w-panel)]");
content = content.replace(/min-w-\[340px\]/g, "min-w-[var(--w-panel)]");

// For VJPanel
content = content.replace(/width:\s*340/g, 'width: "var(--w-panel)"');
content = content.replace(/width:\s*0/g, 'width: "0px"'); // to let framer motion calculate

fs.writeFileSync(AppPath, content);
console.log("Updated classes in App.tsx");
