// Helper: unwrap the latest preview_eval result file and write the
// HTML inside it to a named file in design-snapshots/. Run as:
//   node design-snapshots/extract.js <output-name>
// e.g. `node design-snapshots/extract.js 02-settings.html`
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = 'C:/Users/r2g2/.claude/projects/C--wonderers-guide/9b079e31-b10d-4968-b5aa-a7e2a9547810/tool-results';
const OUT_DIR = path.dirname(process.argv[1]);

const outName = process.argv[2];
if (!outName) {
  console.error('usage: node extract.js <output-name.html>');
  process.exit(1);
}

const files = fs.readdirSync(RESULTS_DIR)
  .filter((f) => f.startsWith('mcp-Claude_Preview-preview_eval-') && f.endsWith('.txt'))
  .map((f) => ({ f, t: fs.statSync(path.join(RESULTS_DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

if (!files.length) {
  console.error('no eval results found in', RESULTS_DIR);
  process.exit(1);
}

const src = path.join(RESULTS_DIR, files[0].f);
const wrapper = JSON.parse(fs.readFileSync(src, 'utf8'));
const html = JSON.parse(wrapper[0].text);
const dst = path.join(OUT_DIR, outName);
fs.writeFileSync(dst, html);
console.log('wrote', dst, '(' + html.length + ' chars from ' + path.basename(src) + ')');
