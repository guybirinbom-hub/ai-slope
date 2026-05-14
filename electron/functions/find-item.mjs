import { makeFinder } from './_make-finder.mjs';
export default makeFinder('item', [
  ['id', 'id'],
  ['name', 'name', { ignoreCase: true }],
  ['content_sources', 'content_source_id'],
]);
