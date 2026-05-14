import { hideNotification, showNotification } from '@mantine/notifications';
import { makeRequest } from '@requests/request-manager';
import { Character } from '@schemas/content';

export default async function importFromJSON(file: File) {
  showNotification({
    id: `importing-${file.name}`,
    title: `Importing character`,
    message: 'Please wait...',
    autoClose: false,
    withCloseButton: false,
    loading: true,
  });

  const contents = await getFileContents(file);
  let character = null;
  try {
    const obj = JSON.parse(contents);
    character = await importObject(obj);
    if (character) {
      hideNotification(`importing-${file.name}`);
      showNotification({
        title: 'Success',
        message: `Imported "${character.name}"`,
        icon: null,
        autoClose: 3000,
      });
    } else {
      throw new Error();
    }
  } catch (e) {
    hideNotification(`importing-${file.name}`);
    showNotification({
      title: 'Import failed',
      message: 'Invalid JSON file',
      color: 'red',
      icon: null,
      autoClose: false,
    });
  }
  return character;
}

async function importObject(obj: Record<string, any>): Promise<Character | null> {
  const version = obj.version;
  if (version === 4) {
    return await importV4(obj);
  } else {
    return null;
  }
}

async function importV4(obj: Record<string, any>): Promise<Character | null> {
  const fileCharacter: Character = obj.character;

  const character = {
    ...fileCharacter,
    id: undefined, // remove ID so it creates a new character
    // The source character may reference a campaign / user that
    // doesn't exist in this database. Both columns have FK
    // constraints, so leaving the original ids in would make
    // `create-character` fail with `violates foreign key
    // constraint "public_character_campaign_id_fkey"` (or the
    // analogous user_id one). Null them out — the backend assigns
    // `user_id` from the authed session, and a fresh import isn't
    // tied to any campaign until the player picks one.
    campaign_id: null,
    user_id: null,
  };

  return await makeRequest<Character>('create-character', character);
}

// Utils
export async function getFileContents(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function fileReadCompleted() {
      resolve(reader.result as string);
    };
    reader.readAsText(file);
  });
}
