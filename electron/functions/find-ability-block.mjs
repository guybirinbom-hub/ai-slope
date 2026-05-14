import { makeFinder } from './_make-finder.mjs';
export default makeFinder('ability_block', [
  ['id', 'id'],
  ['type', 'type'],
  ['name', 'name', { ignoreCase: true }],
  ['content_sources', 'content_source_id'],
  ['traits', 'traits', { arrayContains: true, arrayType: 'bigint' }],
  ['prerequisites', 'prerequisites', { arrayContains: true, arrayType: 'text' }],
]);
