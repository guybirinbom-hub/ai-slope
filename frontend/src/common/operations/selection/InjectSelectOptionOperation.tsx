import { fetchContentAll, getDefaultSources } from '@content/content-store';
import { OperationWrapper } from '../Operations';
import { Select, Stack } from '@mantine/core';
import { useDidUpdate } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { AbilityBlock, ContentSource, Item } from '@schemas/content';
import { useState } from 'react';
import { uniqBy } from 'lodash-es';
import { InjectedSelectOption, Operation, OperationSelect, OperationSelectOptionCustom } from '@schemas/operations';
import { SelectionPredefinedCustomOption } from './SelectionOperation';

interface WrappedOperationSelect extends OperationSelect {
  _sourceName: string;
}

export function InjectSelectOptionOperation(props: {
  value: string;
  onSelect: (value: string) => void;
  onRemove: () => void;
}) {
  const [option, setOption] = useState<InjectedSelectOption | null>(props.value ? JSON.parse(props.value) : null);

  const { data, isFetching } = useQuery({
    queryKey: [`get-all-selection-options`],
    queryFn: async () => {
      // Only PREDEFINED/CUSTOM `select` operations can be injected into, so we
      // keep ONLY those out of each content record (tagged with its source
      // name). The previous version built one array of EVERY operation on
      // EVERY ability block + content source + item, then de-duped it with
      // uniqWith(isEqual) — a deep-equality compare that is O(n²). Across the
      // full content library that intermediate array is tens of thousands of
      // entries, so the editor spiked CPU + memory the instant it mounted and
      // the renderer got OOM-killed on lower-spec machines (fine on a big
      // desktop, crash on a laptop). Filtering per-record keeps the working
      // set tiny, and uniqBy(id) is a cheap O(n) final de-dupe.
      const isInjectableSelect = (op: Operation): op is OperationSelect =>
        op.type === 'select' && op.data.modeType === 'PREDEFINED' && op.data.optionType === 'CUSTOM';

      const operations: WrappedOperationSelect[] = [];
      const collectFrom = (records: { operations?: Operation[] | null; name: string }[]) => {
        for (const rec of records) {
          for (const op of rec.operations ?? []) {
            if (isInjectableSelect(op)) operations.push({ ...op, _sourceName: rec.name });
          }
        }
      };

      collectFrom(await fetchContentAll<AbilityBlock>('ability-block', getDefaultSources('PAGE')));
      collectFrom(await fetchContentAll<ContentSource>('content-source', getDefaultSources('PAGE')));
      collectFrom(await fetchContentAll<Item>('item', getDefaultSources('PAGE')));

      return uniqBy(operations, 'id');
    },
  });

  useDidUpdate(() => {
    props.onSelect(JSON.stringify(option));
  }, [option]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Inject Select Option'>
      <Stack w='100%'>
        <Select
          size='xs'
          placeholder='Selection to Inject Into'
          w={220}
          data={data?.map((op) => ({
            value: op.id,
            label: `${op._sourceName} - ${op.data.title ?? 'Select an Option'}`,
          }))}
          value={option?.opId}
          onChange={(value) => {
            if (!value) return;
            setOption({
              opId: value,
              option: {
                id: crypto.randomUUID(),
                type: 'CUSTOM',
                title: '',
                description: '',
                operations: [],
              } satisfies OperationSelectOptionCustom,
            });
          }}
        />
        {option?.opId && (
          <SelectionPredefinedCustomOption
            option={option?.option}
            onChange={(newOption) => {
              setOption((prev) => ({ ...prev!, option: newOption }));
            }}
          />
        )}
      </Stack>
    </OperationWrapper>
  );
}
