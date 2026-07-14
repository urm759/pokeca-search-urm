const fs = require('fs');
const path = require('path');

const root = process.cwd();
const filePath = path.join(root, 'site', 'data.js');

const text = fs.readFileSync(filePath, 'utf8');
const next = text.replace(
  /https:\/\/toreca-souba\.com\/cards\/([^"\\\n]+)"/g,
  'https://pokeca-chart.com/gr/$1/"',
);

fs.writeFileSync(filePath, next, 'utf8');
console.log('updated site/data.js URLs');
