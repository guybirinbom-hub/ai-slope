import { makeFinder } from './_make-finder.mjs';
export default makeFinder('creature', [
  ['id', 'id'],
  ['name', 'name', { ignoreCase: true }],
  ['content_sources', 'content_source_id'],
  ['level', 'level'],
]);
