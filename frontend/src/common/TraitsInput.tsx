import { isTraitVisible } from '@content/content-hidden';
import { fetchContentAll, getDefaultSources } from '@content/content-store';
import { TagsInput, TagsInputProps } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Trait } from '@schemas/content';
import { isTruthy } from '@utils/type-fixing';
import { uniq } from 'lodash-es';

interface TraitsInputProps extends TagsInputProps {
  defaultTraits?: number[];
  traits?: number[];
  onTraitChange?: (traits: Trait[]) => void;
  includeCreatureTraits?: boolean;
  zIndex?: number;
  // Optional: restrict the autocomplete to traits whose IDs appear in
  // this list. Used by the content-picker filter panel so the dropdown
  // only suggests traits that actually exist on the options the user
  // is currently picking from (e.g. no Item traits when filtering Feats,
  // no Dwarf trait when filtering Elf ancestry feats). Pass undefined
  // to keep the default behaviour: every visible trait is offered.
  allowedTraitIds?: number[];
}

export default function TraitsInput(props: TraitsInputProps) {
  const { data, isFetching } = useQuery({
    queryKey: [`get-traits`],
    queryFn: async () => {
      return await fetchContentAll<Trait>('trait', getDefaultSources('INFO'));
    },
  });

  const allowedSet = props.allowedTraitIds ? new Set(props.allowedTraitIds) : null;

  const traits =
    (data &&
      data
        .filter(isTruthy)
        .filter((trait) => (allowedSet ? allowedSet.has(trait.id) : true))
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((trait) => isTraitVisible('CHARACTER', trait))) ??
    [];

  // Remove the added props so they don't get passed to TagsInput
  const passedProps = { ...props };
  delete passedProps.defaultTraits;
  delete passedProps.traits;
  delete passedProps.onTraitChange;
  delete passedProps.includeCreatureTraits;
  delete passedProps.allowedTraitIds;

  return (
    <>
      {isFetching || !data ? (
        <TagsInput
          styles={(t) => ({
            dropdown: {
              zIndex: props.zIndex ?? 1500,
            },
          })}
          {...passedProps}
          readOnly
        />
      ) : (
        <TagsInput
          styles={(t) => ({
            dropdown: {
              zIndex: props.zIndex ?? 1500,
            },
          })}
          {...passedProps}
          defaultValue={traits.filter((trait) => props.defaultTraits?.includes(trait.id)).map((trait) => trait.name)}
          value={
            props.traits
              ? traits.filter((trait) => props.traits?.includes(trait.id)).map((trait) => trait.name)
              : props.value
          }
          data={uniq(traits.map((trait) => trait.name))}
          limit={1000}
          onChange={(value) => {
            if (props.onTraitChange) {
              props.onTraitChange(
                value
                  .filter(isTruthy)
                  .map((trait) => traits.find((t) => t.name === trait)!)
                  .filter(isTruthy)
              );
            }
          }}
        />
      )}
    </>
  );
}
