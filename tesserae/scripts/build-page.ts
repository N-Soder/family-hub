// Regenerates tesserae/pages/wall.json from layout.json + paint code.
// Run after editing the painter or layout; a unit test fails if it drifts.
import fs from 'node:fs';
import { buildWallCanvas } from '../../src/lib/server/tesserae/page';
fs.writeFileSync('tesserae/pages/wall.json', JSON.stringify(buildWallCanvas(), null, 2) + '\n');
console.log('wrote tesserae/pages/wall.json');
