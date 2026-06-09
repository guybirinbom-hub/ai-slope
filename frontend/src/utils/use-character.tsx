import { characterState, characterOperationResultsState } from '@atoms/characterAtoms';
import { getCachedPublicUser } from '@auth/user-manager';
import { applyConditions } from '@conditions/condition-handler';
import {
  getAllCustomModes,
  getModeToggleKey,
  type CustomMode,
} from '@modes/custom-modes';
import { addVariableBonus } from '@variables/variable-manager';
import { defineDefaultSources } from '@content/content-store';
import { saveCustomization } from '@content/customization-cache';
import { applyEquipmentPenalties } from '@items/inv-utils';
import { useDebouncedCallback, useDebouncedValue, useDidUpdate, usePrevious } from '@mantine/hooks';
import { hideNotification, showNotification } from '@mantine/notifications';
import { executeOperations } from '@operations/operations.main';
import { confirmHealth } from '@pages/character_sheet/entity-handler';
import { makeRequest } from '@requests/request-manager';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Character, ContentPackage, OperationCharacterResultPackage } from '@schemas/content';
import { saveCalculatedStats } from '@variables/calculated-stats';
import { setVariable } from '@variables/variable-manager';
import { isEqual, isArray, cloneDeep } from 'lodash-es';
import { useEffect, useRef, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';
import { convertToSetEntity } from './type-fixing';
import { IconRefresh, IconAlertCircle } from '@tabler/icons-react';
import { hashData } from './numbers';
import { getDeepDiff } from './objects';
import { addExtraItems, checkBulkLimit } from '@items/inv-handlers';
import { getFinalHealthValue, getHealthValueParts } from '@variables/variable-helpers';
import { supabase } from '../main';

interface CharStateOptionsGeneric {
  type: string;
  data?: Record<string, any>;
}

interface CharStateOptionsExecuteOps extends CharStateOptionsGeneric {
  type: 'EXECUTE_OPS';
  data: {
    content: ContentPackage;
    context: 'CHARACTER-SHEET' | 'CHARACTER-BUILDER';
    onFinishLoading: () => void;
  };
}

interface CharStateOptionsSimple extends CharStateOptionsGeneric {
  type: 'SIMPLE';
  data?: {};
}

type CharStateOptions = CharStateOptionsExecuteOps | CharStateOptionsSimple;

/**
 * Custom hook to manage character state, including fetching from the database, executing operations, and auto-saving.
 * @param characterId - The ID of the character to manage
 * @param options - Options to control the behavior of the hook, such as whether to execute operations and what content/context to use for those operations
 * @returns - An object containing the character state, a setter for the character, a loading state, and any results from executed operations
 */
export default function useCharacter(
  characterId: number,
  options: CharStateOptions
): {
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  //
  isLoading: boolean;
  results: OperationCharacterResultPackage | null;
} {
  const [character, setCharacter] = useAtom(characterState);
  const setCharacterOperationResults = useSetAtom(characterOperationResultsState);
  const queryClient = useQueryClient();
  useAutoSave(character, characterId);

  const handleFetchedCharacter = (resultCharacter: Character | null | undefined) => {
    if (resultCharacter) {
      // Don't update if they're the same
      if (isEqual(character, resultCharacter)) {
        return;
      }

      if (character && resultCharacter) {
        const diff = getDeepDiff(character, resultCharacter);
        // If we can't detect a diff, don't update
        if (Object.keys(diff).length === 0) {
          return;
        }

        console.log('Doing extra update bc of discrepancies', diff);
      }

      // Update character
      setCharacter(resultCharacter);

      // Make sure we sync the enabled content sources
      defineDefaultSources('PAGE', resultCharacter.content_sources?.enabled ?? []);

      // Cache character customization for fast loading
      saveCustomization({
        background_image_url:
          (resultCharacter.details?.background_image_url || getCachedPublicUser()?.background_image_url) ?? undefined,
        sheet_theme: (resultCharacter.details?.sheet_theme || getCachedPublicUser()?.site_theme) ?? undefined,
      });
    } else {
      // Character not found, probably due to unauthorized access
      window.location.href = '/sheet-unauthorized';
    }
  };

  // Fetch character from db
  useEffect(() => {
    (async () => {
      // Before fetching the character, check if there's an autosaved version in localStorage and save it to the database if it exists
      const key = `autosave-character-${characterId}`;
      const pending = localStorage.getItem(key);
      if (pending) {
        const { token, body } = JSON.parse(pending);
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-character`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        localStorage.removeItem(key);
      }

      // Check React Query's cache first — CharacterSheetPage seeds
      // the character into the cache as part of its content fetch, so
      // on the typical "open sheet" path we skip a redundant network
      // round-trip and bind the cached value directly. Falls back to
      // a fresh fetch if the cache is empty (other entry points like
      // direct URL load, or post-import where the cache wasn't seeded).
      const cached =
        queryClient.getQueryData<Character>(['find-character', characterId]) ??
        queryClient.getQueryData<Character>(['find-character', String(characterId)]);
      const dbCharacter = cached ?? (await makeRequest<Character>('find-character', { id: characterId }));
      handleFetchedCharacter(dbCharacter);
    })();
  }, []);

  // Execute operations
  const [operationResults, setOperationResults] = useState<OperationCharacterResultPackage>();
  const executingOperations = useRef<number | null>(null);

  // Debounce the character state before the operation recompile fires.
  // Was 800ms — far too laggy for discrete actions (adjusting a
  // condition, ticking a hero point, toggling Equip), which made the
  // sheet feel sluggish since stat updates couldn't appear until the
  // window elapsed. 250ms is short enough to feel instant on user
  // input but still batches rapid keystrokes in text fields.
  const [debouncedCharacter] = useDebouncedValue(character, 250);
  const prevDebouncedCharacter = usePrevious(debouncedCharacter);
  const setCharacterDebounced = useDebouncedCallback(setCharacter, 250);

  const getUpdateHash = (c: Character | null | undefined) => {
    return hashData(
      c
        ? cloneDeep({
            id: c.id,
            campaign_id: c.campaign_id,
            user_id: c.user_id,
            level: c.level,
            inventory: c.inventory,
            spells: c.spells,
            operation_data: c.operation_data,
            details: {
              conditions: c.details?.conditions,
              ancestry: c.details?.ancestry,
              background: c.details?.background,
              class: c.details?.class,
              class_2: c.details?.class_2,
            },
            custom_operations: c.custom_operations,
            options: c.options,
            variants: c.variants,
            content_sources: c.content_sources,
            companions: c.companions, // Might not be needed
            meta_data: {
              active_modes: c.meta_data?.active_modes,
              given_item_ids: c.meta_data?.given_item_ids,
              reset_hp: c.meta_data?.reset_hp,
            },
          })
        : {}
    );
  };

  useEffect(() => {
    if (options.type !== 'EXECUTE_OPS') return;
    if (!debouncedCharacter) return;

    const prevOpsHash = getUpdateHash(prevDebouncedCharacter);
    const opsHash = getUpdateHash(debouncedCharacter);
    if (prevOpsHash === opsHash || executingOperations.current === opsHash) return;

    console.log('> Executing ops #', opsHash);
    executingOperations.current = opsHash;
    executeOperations<OperationCharacterResultPackage>({
      type: 'CHARACTER',
      data: {
        character: debouncedCharacter,
        content: options.data.content,
        context: options.data.context,
      },
    }).then((results) => handleOperationResults(results));
  }, [debouncedCharacter]);

  const handleOperationResults = (results: OperationCharacterResultPackage) => {
    if (options.type !== 'EXECUTE_OPS') return;
    if (!debouncedCharacter) return;
    if (executingOperations.current !== getUpdateHash(debouncedCharacter)) {
      // Old execution, ignore
      console.log('... Ignoring outdated ops #', getUpdateHash(debouncedCharacter));
      return;
    }

    // Final execution pipeline:
    console.log('... Finished executing ops #', getUpdateHash(debouncedCharacter));

    if (debouncedCharacter.variants?.proficiency_without_level) {
      setVariable('CHARACTER', 'PROF_WITHOUT_LEVEL', true);
    }

    // Add the extra items to the inventory from variables
    addExtraItems(
      'CHARACTER',
      options.data.content.items,
      debouncedCharacter,
      convertToSetEntity(setCharacterDebounced)
    );

    // Check bulk limits
    checkBulkLimit(
      'CHARACTER',
      debouncedCharacter,
      convertToSetEntity(setCharacterDebounced),
      debouncedCharacter.options?.ignore_bulk_limit !== true
    );

    // Apply armor/shield penalties
    applyEquipmentPenalties('CHARACTER', debouncedCharacter);

    // Apply conditions after everything else
    applyConditions('CHARACTER', debouncedCharacter.details?.conditions ?? []);

    // Apply user-created custom modes that are currently active. The
    // mode list is the union of (a) global modes saved in localStorage
    // and (b) character-scoped modes on character.meta_data.custom_modes.
    // "Active" comes from the same ACTIVE_MODES list the built-in modes
    // use, so toggling either kind of mode lives in the same UI.
    {
      const activeKeys = new Set(debouncedCharacter.meta_data?.active_modes ?? []);
      const allModes = getAllCustomModes(
        (debouncedCharacter.meta_data as { custom_modes?: CustomMode[] } | undefined)
          ?.custom_modes
      );
      for (const mode of allModes) {
        if (!activeKeys.has(getModeToggleKey(mode))) continue;
        for (const effect of mode.effects) {
          if (!effect.variable) continue;
          const bonusType =
            effect.type && effect.type !== 'untyped' ? effect.type : undefined;
          addVariableBonus(
            'CHARACTER',
            effect.variable,
            effect.value || 0,
            bonusType,
            effect.text ?? '',
            `Mode: ${mode.name}`
          );
        }
      }
    }

    if (debouncedCharacter.meta_data?.reset_hp !== false) {
      // To reset hp, we need to confirm health

      const handleRestHP = () => {
        const { classHp } = getHealthValueParts('CHARACTER');
        const maxHealth = getFinalHealthValue('CHARACTER');
        // Don't clear reset_hp until the character has class HP - otherwise ancestry-only HP
        // gets locked in before the class is selected, resulting in a too-low starting HP.
        confirmHealth(`${maxHealth}`, maxHealth, debouncedCharacter, convertToSetEntity(setCharacterDebounced), classHp === 0);
      };

      // We run it twice for it to break out of the debouncing lock (not a perfect solution, but works)
      handleRestHP();
      setTimeout(() => {
        handleRestHP();
      }, 1000);
    } else {
      // Because of the drained condition, let's confirm health
      const maxHealth = getFinalHealthValue('CHARACTER');
      confirmHealth(
        `${debouncedCharacter.hp_current}`,
        maxHealth,
        debouncedCharacter,
        convertToSetEntity(setCharacterDebounced)
      );
    }

    // Save calculated stats
    saveCalculatedStats('CHARACTER', debouncedCharacter, convertToSetEntity(setCharacterDebounced));

    setOperationResults(results);
    // Expose the live results so other surfaces (the Custom Operations editor's
    // "Inject Option") can read the character's current select menus.
    setCharacterOperationResults(results);
    executingOperations.current = null;

    setTimeout(() => {
      options.data.onFinishLoading?.();
    }, 100);
  };

  // Update character in db when state changed
  useDidUpdate(() => {
    if (!debouncedCharacter) return;
    mutateCharacter({
      name: debouncedCharacter.name,
      level: debouncedCharacter.level,
      experience: debouncedCharacter.experience,
      hp_current: debouncedCharacter.hp_current,
      hp_temp: debouncedCharacter.hp_temp,
      hero_points: debouncedCharacter.hero_points,
      stamina_current: debouncedCharacter.stamina_current,
      resolve_current: debouncedCharacter.resolve_current,
      inventory: debouncedCharacter.inventory,
      notes: debouncedCharacter.notes,
      details: debouncedCharacter.details,
      roll_history: debouncedCharacter.roll_history,
      custom_operations: debouncedCharacter.custom_operations,
      meta_data: debouncedCharacter.meta_data,
      options: debouncedCharacter.options,
      variants: debouncedCharacter.variants,
      content_sources: debouncedCharacter.content_sources,
      operation_data: debouncedCharacter.operation_data,
      spells: debouncedCharacter.spells,
      companions: debouncedCharacter.companions,
      campaign_id: debouncedCharacter.campaign_id,
    });
  }, [debouncedCharacter]);
  // We dedup the autosave error toast with a stable id. Without this, every
  // debounced save during an outage (e.g. typing in the notes tab) pops a
  // fresh red toast on every keystroke window. The mutation already retries
  // on the next change, so a single transient failure shouldn't be alarming.
  // On the next successful save we hide the toast so the user knows it
  // self-recovered — matching what they actually see ("it still works").
  const AUTOSAVE_ERROR_ID = 'autosave-character-error';
  const { mutate: mutateCharacter } = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const resData = await makeRequest('update-character', {
        id: characterId,
        ...data,
      });
      // update-character returns the saved row. The local backend port returns
      // it as a SINGLE object ({ status, data: row } via upsertResponseWrapper);
      // the original Deno function returned an array. Accept BOTH shapes —
      // otherwise `c` in onSuccess is always null, the cache-sync below never
      // runs, and the roster cards keep a stale snapshot (hero points / HP not
      // matching the sheet, with no edit ever fixing it).
      if (!resData) return null;
      return (isArray(resData) ? resData[0] : resData) as Character;
    },
    onSuccess: (c) => {
      hideNotification(AUTOSAVE_ERROR_ID);
      if (c) {
        console.log('> Fetched updated character: #', getUpdateHash(character), 'vs.', getUpdateHash(c));
        // CRITICAL: seed the React Query cache with the just-saved
        // character. The mount-time fetch in this hook reads from
        // `queryClient.getQueryData(['find-character', id])` BEFORE a
        // network call — and the cache has staleTime: 60_000 in the
        // CharacterSheetPage useQuery, so without this update the
        // user's class change (or any autosaved field) wouldn't show
        // when they revisit the sheet within 60s; the stale cached
        // version would clobber the freshly-saved atom. Seeding both
        // the numeric and string-keyed entries matches the lookup
        // logic that checks both.
        queryClient.setQueryData(['find-character', characterId], c);
        queryClient.setQueryData(['find-character', String(characterId)], c);
        // Keep the roster's LIST cache (['find-character'], no id) in sync too,
        // so the Characters page reflects edits made on the sheet — hero
        // points, HP, level, name, etc. — without needing a manual refresh.
        // Without this, the list query keeps its pre-edit snapshot and shows
        // stale values (e.g. hero-point pips that don't match the sheet).
        queryClient.setQueryData<Character[] | undefined>(['find-character'], (list) =>
          Array.isArray(list)
            ? list.map((ch) => (`${ch.id}` === `${characterId}` ? { ...ch, ...c } : ch))
            : list
        );
      }
    },
    onError: () => {
      // Mantine dedups by id: while one toast is showing, repeats are no-ops.
      // autoClose:false keeps it visible until the next successful save
      // hides it explicitly (above) — so it accurately reflects "saves are
      // currently failing" rather than flashing for one keystroke.
      showNotification({
        id: AUTOSAVE_ERROR_ID,
        icon: <IconAlertCircle />,
        title: 'Failed to save character',
        message: 'Your changes could not be saved. Please check your connection and try again.',
        color: 'red',
        autoClose: false,
      });
    },
  });

  // Poll remote character updates - only if the character hasn't been updated recently
  const [lDebouncedCharacter] = useDebouncedValue(character, 5000);
  const notRecentlyUpdated = !!(
    !executingOperations &&
    lDebouncedCharacter &&
    isEqual(lDebouncedCharacter, character) &&
    isEqual(debouncedCharacter, character)
  );
  useQuery({
    queryKey: [`find-character-polling-updates-${characterId}`],
    queryFn: async () => {
      const polledCharacter = await makeRequest<Character>('find-character', {
        id: characterId,
      });

      if (notRecentlyUpdated && Object.keys(getDeepDiff(character, polledCharacter)).length > 0) {
        showNotification({
          icon: <IconRefresh />,
          title: `Updating character...`,
          message: `Received a remote update`,
          autoClose: 1500,
        });
        setCharacter(polledCharacter);
      }
      return polledCharacter;
    },
    refetchInterval: 1000,
    enabled: false, // notRecentlyUpdated, Fix polling on char item update
  });

  const isFinished =
    // There must be a character
    !!character &&
    // It must be the requested one
    character.id === characterId &&
    // There must be some operation results if ops were executed
    (options.type === 'EXECUTE_OPS' ? !!operationResults : true);

  return {
    character,
    setCharacter,
    isLoading: !isFinished,
    results: operationResults ?? null,
  };
}

/**
 * Custom hook to auto-save character data to localStorage when the page is closed or hidden, and to sync the auth token with Supabase session
 * @param character - The character data to auto-save
 * @param characterId - The ID of the character, used for namespacing the localStorage key
 * @returns void
 */
function useAutoSave(character: Character | null, characterId: number) {
  const characterRef = useRef(character);
  const tokenRef = useRef<string>(import.meta.env.VITE_SUPABASE_KEY);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) tokenRef.current = session.access_token;
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) tokenRef.current = session.access_token;
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const saveImmediately = () => {
      const c = characterRef.current;
      if (!c) return;
      // localStorage.setItem is synchronous — guaranteed to complete even on tab close
      localStorage.setItem(
        `autosave-character-${characterId}`,
        JSON.stringify({
          token: tokenRef.current,
          body: {
            id: characterId,
            name: c.name,
            level: c.level,
            experience: c.experience,
            hp_current: c.hp_current,
            hp_temp: c.hp_temp,
            hero_points: c.hero_points,
            stamina_current: c.stamina_current,
            resolve_current: c.resolve_current,
            inventory: c.inventory,
            notes: c.notes,
            details: c.details,
            roll_history: c.roll_history,
            custom_operations: c.custom_operations,
            meta_data: c.meta_data,
            options: c.options,
            variants: c.variants,
            content_sources: c.content_sources,
            operation_data: c.operation_data,
            spells: c.spells,
            companions: c.companions,
            campaign_id: c.campaign_id,
          },
        })
      );
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveImmediately();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', saveImmediately);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', saveImmediately);
      // Also save on SPA navigation (unmount), since pagehide won't fire for in-app routing
      saveImmediately();
    };
  }, []);
}
