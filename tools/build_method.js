// Render docs/method.src.html → web/method.html with all TeX pre-rendered to MathML (no runtime JS).
// npm install katex@0.16.11   then   node tools/build_method.js
const fs = require('fs'), path = require('path');
let katex; try { katex = require('katex'); } catch { katex = require('/tmp/katex/node_modules/katex'); }
const src = fs.readFileSync(path.join(__dirname, '../docs/method.src.html'), 'utf8');
let n = 0;
const r = (tex, display) => { n++; return katex.renderToString(tex, { output: 'mathml', displayMode: display, throwOnError: true, strict: 'ignore' }); };
const out = src.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => r(t, true)).replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => r(t, false));
fs.writeFileSync(path.join(__dirname, '../web/method.html'), out);
console.log('rendered', n, 'expressions');
