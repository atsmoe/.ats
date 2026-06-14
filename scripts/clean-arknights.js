const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'src', '_data', 'arknights.json');

const data = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));

// Keep only "遥远的未来" era, and only "终末地" event within it
const farFuture = data.eras?.find(e => e.title === '遥远的未来');
const zhongmodi = farFuture?.events?.find(e => e.title === '明日方舟：终末地');

if (zhongmodi) {
  data.eras = [{ title: '遥远的未来', events: [zhongmodi] }];
} else {
  data.eras = [];
}

// Place eras into mainline branch (no more fallback)
const mainlineBranch = data.subEntities[0].timeline.branches[0];
mainlineBranch.eras = data.eras;

// Delete fallback fields
delete data.eras;
delete data.crossWorldRefs;
delete data.references;

fs.writeFileSync(INPUT, JSON.stringify(data, null, 2) + '\n', 'utf-8');
console.log('[clean] Removed old events, kept only 终末地 in mainline. IF branches preserved.');
console.log('[clean] Deleted crossWorldRefs and references.');
