// Tracks whether the local backend (pg + postgrest) is fully warmed up
// and ready to serve data requests.
//
// The Electron main process starts the API gateway BEFORE pg in parallel-
// boot mode, so the React shell renders almost instantly while pg is still
// initializing. During that window, /rest/v1 and /functions/v1 short-circuit
// to 503 ("backend warming up"). This atom flips to true once /wg/ready
// reports ready, and BackendReadyGate watches it to decide whether to show
// the route or a warming-up loader.
//
// Where this gets written:
//   - App.tsx polls /wg/ready every 250 ms during startup and writes the
//     flipped value here.
// Where this gets read:
//   - BackendReadyGate (UI gate for backend-dependent routes)

import { atom } from 'jotai';

export type BackendReadyState = {
  ready: boolean;
  // Error string when the backend failed to start. Surfaced in the gate UI
  // so users know it's not just "still loading".
  error: string | null;
};

export const backendReadyState = atom<BackendReadyState>({
  ready: false,
  error: null,
});
