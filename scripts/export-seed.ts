// Exports the compiled seed (family data) to data/private/family-dataset.json.
import { writeFileSync } from 'node:fs';
import { seedDataset } from '../data/private/seed/seed-family';
writeFileSync('data/private/family-dataset.json', JSON.stringify(seedDataset(), null, 2));
console.log('wrote data/private/family-dataset.json');
