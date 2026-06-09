import { AbilityBlockType, ContentType, Creature } from '@schemas/content';
import { DrawerType } from '@schemas/index';
import { atom } from 'jotai';

const userIconState = atom(null as string | null);

const _internal_drawerHistoryState = atom([] as { type: DrawerType; data: any }[]);

type DrawerStateValue = {
  type: DrawerType;
  data: any;
  extra?: { addToHistory?: boolean; history?: { type: DrawerType; data: any }[] };
} | null;

const _internal_drawerState = atom(null as DrawerStateValue);

// Two drawer requests target the same thing when they share a type and record —
// by id when present, otherwise by a value compare. Used to avoid stacking a
// duplicate of the drawer that's already open: clicking the same description
// link repeatedly should be a no-op, not pile identical copies into history.
function isSameDrawerTarget(a: DrawerStateValue, b: DrawerStateValue): boolean {
  if (!a || !b || a.type !== b.type) return false;
  const ai = a.data?.id;
  const bi = b.data?.id;
  if (ai != null || bi != null) return ai === bi;
  try {
    return JSON.stringify(a.data) === JSON.stringify(b.data);
  } catch {
    return a.data === b.data;
  }
}

const drawerState = atom(
  (get) => {
    const drawer = get(_internal_drawerState);
    const history = get(_internal_drawerHistoryState);

    if (drawer) {
      return {
        ...drawer,
        extra: {
          history,
        },
      } as typeof drawer;
    } else {
      return null;
    }
  },
  (get, set, newValue: DrawerStateValue) => {
    const drawer = get(_internal_drawerState);
    const history = get(_internal_drawerHistoryState);

    // If new value is null, reset everything
    if (!newValue) {
      set(_internal_drawerHistoryState, []);
      set(_internal_drawerState, null);
      return;
    }

    // Already showing this exact drawer? Do nothing — don't stack a duplicate
    // into the back-history that the user then has to dismiss one at a time.
    if (isSameDrawerTarget(drawer, newValue)) {
      return;
    }

    // Add new value to history or replace history
    if (newValue.extra?.addToHistory && drawer) {
      // Add new value to history
      set(_internal_drawerHistoryState, [...history, { type: drawer.type, data: drawer.data }]);
    } else if (newValue.extra?.history) {
      // Set history to new value's history
      set(_internal_drawerHistoryState, newValue.extra.history);
    }
    set(_internal_drawerState, newValue);
  }
);

const feedbackState = atom(
  null as {
    type: ContentType | AbilityBlockType;
    data: { id?: number; contentSourceId?: number };
  } | null
);

const creatureDrawerState = atom(
  null as {
    data: {
      id?: number;
      creature?: Creature;
      STORE_ID?: string;
      showOperations?: boolean;
      updateCreature?: (creature: Creature) => void;
      readOnly?: boolean;
    };
  } | null
);

export { userIconState, drawerState, feedbackState, creatureDrawerState };
