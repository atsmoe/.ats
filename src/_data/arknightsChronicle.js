const fs = require('fs');
const path = require('path');

module.exports = function () {
  const source = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'arknights.json'), 'utf8'),
  );
  const branches = source.subEntities
    .flatMap(entity => entity.timeline?.branches || []);
  const mainline = branches.find(branch => branch.id === 'mainline');

  if (!mainline) {
    throw new Error('Arknights chronicle requires the canonical mainline branch');
  }

  return {
    eras: mainline.eras || [],
    records: (mainline.eras || [])
      .reduce((total, era) => total + (era.events?.length || 0), 0),
  };
};
