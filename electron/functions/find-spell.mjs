import { makeFinder } from './_make-finder.mjs';
export default makeFinder('spell', [
  ['id', 'id'],
  ['name', 'name', { ignoreCase: true }],
  ['content_sources', 'content_source_id'],
  ['traits', 'traits', { arrayContains: true, arrayType: 'bigint' }],
]);
