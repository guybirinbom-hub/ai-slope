import { makeCreator } from './_make-creator.mjs';
// Same shape — upsertData routes to UPDATE when id is present.
export default makeCreator('content_update');
