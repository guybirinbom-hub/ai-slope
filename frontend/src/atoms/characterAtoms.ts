import { Character, OperationCharacterResultPackage } from '@schemas/content';
import { atom } from 'jotai';

// The character builder's most recent operation-execution results. Set by
// useCharacter on each recompute so other surfaces (e.g. the Custom Operations
// editor's "Inject Option") can read the character's LIVE list of select menus
// without re-running operations. Null until the first execution completes.
export const characterOperationResultsState = atom<OperationCharacterResultPackage | null>(null);

const _internal_characterState = atom(loadCharacter() as Character | null);

const characterState = atom(
  (get) => {
    const character = get(_internal_characterState);

    if (character) {
      // If the character isn't matching the URL id, don't return it
      const matchingCharacterInURL = !!window.location.href.match(new RegExp(`/${character?.id}($|/|\\?)`));
      if (!matchingCharacterInURL) {
        return null;
      }
    }

    character && saveCharacter(character);
    return character;
  },
  (_get, set, newValue: Character | null | ((prev: Character | null) => Character | null)) => {
    const resolved = typeof newValue === 'function' ? newValue(_get(_internal_characterState)) : newValue;
    if (resolved) {
      saveCharacter(resolved);
    } else {
      deleteCharacter();
    }
    set(_internal_characterState, resolved);
  }
);

function saveCharacter(character: Character) {
  //localStorage.setItem('character', JSON.stringify(character));
}

function deleteCharacter() {
  localStorage.removeItem('character');
}

function loadCharacter() {
  // const character = localStorage.getItem('character');
  // if (character) {
  //   return JSON.parse(character) as Character;
  // }
  return null;
}

export { characterState };
