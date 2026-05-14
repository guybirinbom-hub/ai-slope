import { PublicUser } from '@schemas/content';

// Local fork: this is a single-user PC install, no monetization, every
// access tier is unlocked.
export function hasPatreonAccess(_user: PublicUser | null, _accessLevel: 0 | 1 | 2 | 3 | 4): boolean {
  return true;
}
