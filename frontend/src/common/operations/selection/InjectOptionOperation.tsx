import { OperationWrapper } from '../Operations';
import { Group, Select, Stack } from '@mantine/core';
import { AbilityBlockType, ContentType, OperationCharacterResultPackage } from '@schemas/content';
import { OperationResult } from '@schemas/operations';
import { useAtomValue } from 'jotai';
import { characterOperationResultsState } from '@atoms/characterAtoms';
import { SelectContentButton } from '@common/select/SelectContent';
import { convertToContentType } from '@content/content-utils';
import useRefresh from '@utils/use-refresh';
import { useMemo } from 'react';

// Walk the builder's executed-operation results and collect every select menu
// the character currently has (operation id + human title). This is the
// character's OWN live list — small and relevant — so there's no scanning of
// the whole content library (and no repeat of the Inject-Select-Option crash).
function gatherCharacterSelects(pkg: OperationCharacterResultPackage | null): { value: string; label: string }[] {
  const found: { id: string; title: string }[] = [];
  if (!pkg) return [];

  const walk = (results: (OperationResult | null)[] | undefined) => {
    if (!results) return;
    for (const r of results) {
      if (!r) continue;
      if (r.selection?.id) {
        found.push({ id: r.selection.id, title: r.selection.title || 'Untitled selection' });
      }
      // Selecting an option can spawn nested selects — walk those too.
      if (r.result?.results) walk(r.result.results);
    }
  };

  walk(pkg.characterResults);
  walk(pkg.classResults);
  walk(pkg.class2Results);
  walk(pkg.ancestryResults);
  walk(pkg.backgroundResults);
  for (const w of pkg.contentSourceResults) walk(w.baseResults);
  for (const w of pkg.classFeatureResults) walk(w.baseResults);
  for (const w of pkg.ancestrySectionResults) walk(w.baseResults);
  for (const w of pkg.itemResults) walk(w.baseResults);

  // De-dupe by operation id (keep the first title seen).
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const s of found) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ value: s.id, label: s.title });
  }
  return out;
}

export function InjectOptionOperation(props: {
  selectId: string;
  type: ContentType | AbilityBlockType;
  id: number;
  onChange: (selectId: string, type: ContentType | AbilityBlockType, id: number) => void;
  onRemove: () => void;
}) {
  const results = useAtomValue(characterOperationResultsState);
  const [displaySelect, refreshSelect] = useRefresh();

  const selectData = useMemo(() => {
    const opts = gatherCharacterSelects(results);
    // Keep a previously-chosen select visible even before the first recompute
    // populates the live list, so editing an existing operation never looks empty.
    if (props.selectId && !opts.some((o) => o.value === props.selectId)) {
      opts.unshift({ value: props.selectId, label: '(unresolved selection)' });
    }
    return opts;
  }, [results, props.selectId]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Inject Option'>
      <Stack w='100%'>
        <Select
          size='xs'
          searchable
          w={320}
          placeholder={
            selectData.length > 0 ? 'Selection to inject into' : 'No select menus on this character yet'
          }
          nothingFoundMessage='No matching select menus'
          data={selectData}
          value={props.selectId || null}
          onChange={(value) => {
            props.onChange(value ?? '', props.type, props.id);
          }}
        />
        <Group>
          <Select
            size='xs'
            placeholder='Content Type'
            w={140}
            data={
              [
                { value: 'feat', label: 'Feat' },
                { value: 'action', label: 'Action' },
                { value: 'spell', label: 'Spell' },
                { value: 'item', label: 'Item' },
                { value: 'trait', label: 'Trait' },
                { value: 'class-feature', label: 'Class Feature' },
                { value: 'physical-feature', label: 'Physical Feature' },
                { value: 'mode', label: 'Mode' },
                { value: 'sense', label: 'Sense' },
                { value: 'heritage', label: 'Heritage' },
                { value: 'language', label: 'Language' },
              ] satisfies { value: ContentType | AbilityBlockType; label: string }[]
            }
            value={props.type}
            onChange={(value) => {
              if (!value) return;
              // Reset the picked content id when the type changes.
              props.onChange(props.selectId, value as ContentType | AbilityBlockType, -1);
              refreshSelect();
            }}
          />
          {displaySelect && (
            <SelectContentButton
              type={convertToContentType(props.type)}
              onClick={(option) => {
                props.onChange(props.selectId, props.type, option.id);
              }}
              selectedId={props.id}
              options={{
                abilityBlockType:
                  convertToContentType(props.type) === 'ability-block' ? (props.type as AbilityBlockType) : undefined,
                showButton: false,
              }}
            />
          )}
        </Group>
      </Stack>
    </OperationWrapper>
  );
}
