import { SelectIcon } from '@common/IconDisplay';
import { ItemMultiSelect, ItemSelect } from '@common/ItemSelect';
import TraitsInput from '@common/TraitsInput';
import { OperationSection } from '@common/operations/Operations';
import RichTextInput from '@common/rich_text_input/RichTextInput';
import { SelectContentButton, selectContent } from '@common/select/SelectContent';
import { DISCORD_URL } from '@constants/urls';
import { fetchContentById, fetchTraits, getCachedContent } from '@content/content-store';
import { toHTML } from '@content/content-utils';
import { getFillableSpellHolder, isItemFundamentalRune } from '@items/inv-utils';
import { valueForLevel, monsterPartsCategoryFor, levelFromValue } from '@items/monster-parts';
import {
  Accordion,
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Divider,
  Group,
  HoverCard,
  LoadingOverlay,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { getArmorSpecializations } from '@specializations/armor-specializations';
import { IconCirclePlus, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { JSONContent } from '@tiptap/react';
import {
  Availability,
  Item,
  ItemMetaCategoryArmor,
  ItemMetaCategoryWeapon,
  ItemMetaGroupArmor,
  ItemMetaGroupWeapon,
  Spell,
  Trait,
} from '@schemas/content';
import { toLabel } from '@utils/strings';
import useRefresh from '@utils/use-refresh';
import { labelToVariable } from '@variables/variable-utils';
import { merge, truncate } from 'lodash-es';
import { useState } from 'react';

/**
 * Modal for creating or editing an item
 * @param props.opened - Whether the modal is opened
 * @param props.editId - The id of the item being edited
 * @param props.editItem - The item being edited (alternative to editId)
 * @param props.onComplete - Callback when the modal is completed
 * @param props.onCancel - Callback when the modal is cancelled
 * Notes:
 * - Either supply editId or editItem to be in editing mode
 * - If editId is supplied, the item with that id will be fetched
 * - If editItem is supplied, it will be used instead of fetching
 *
 * Visual chrome: rebuilt to match the approved "Edit Item" mockup
 * (D:\Inst\Edit Item.html) EXACTLY. The Mantine modal header is hidden
 * and we render a custom .codex-edit-item shell using the mockup's OWN
 * class names (.modal-head/.modal-body/.modal-foot, .field/.lbl/.input/
 * .select, .divider/.ld-trigger, .misc-section). Simple fields are
 * native HTML <input>/<select> wired to the Mantine form via the `bind`
 * helper; complex widgets (TraitsInput, RichTextInput, the Accordion,
 * the Switch, OperationSection) stay Mantine and are re-skinned through
 * wg4-edit-item.css. All form logic — useForm, useQuery hydration, the
 * onSubmit save handler — is preserved verbatim.
 */
export function CreateItemModal(props: {
  opened: boolean;
  editId?: number;
  editItem?: Item;
  zIndex?: number;
  onComplete: (item: Item) => void;
  onCancel: () => void;
  onNameBlur?: (name: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const editing = (props.editId !== undefined && props.editId !== -1) || props.editItem !== undefined;

  const [displayDescription, refreshDisplayDescription] = useRefresh();

  const [openedAdditional, { toggle: toggleAdditional }] = useDisclosure(false);
  const [openedOperations, { toggle: toggleOperations }] = useDisclosure(false);

  const { data, isFetching } = useQuery({
    queryKey: [`get-item-${props.editId}`, { editId: props.editId, editItem: props.editItem }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore

      const [_key, { editId, editItem }] = queryKey as [string, { editId?: number; editItem?: Item }];

      const item = editId ? await fetchContentById<Item>('item', editId) : editItem;
      if (!item) return null;

      // Remove base item if it's the same as the item being edited
      if (item.meta_data?.base_item && labelToVariable(item.name) === labelToVariable(item.meta_data.base_item)) {
        item.meta_data.base_item = undefined;
        item.meta_data.base_item_content = undefined;
      }

      const mergeData = merge(form.values, item);
      const damageData = merge(form.values.meta_data?.damage, item.meta_data?.damage);

      form.setInitialValues({
        ...mergeData,
        // @ts-ignore
        level: item.level.toString(),
        meta_data: {
          ...(mergeData.meta_data ?? {
            bulk: {},
            foundry: {},
          }),
          damage: damageData,
        },
      });
      form.reset();
      setTraits(await fetchTraits(item.traits ?? undefined));
      setArmorCategory(item.meta_data?.category as ItemMetaCategoryArmor);
      setArmorGroup(item.meta_data?.group as ItemMetaGroupArmor);
      setWeaponCategory(item.meta_data?.category as ItemMetaCategoryWeapon);
      setWeaponGroup(item.meta_data?.group as ItemMetaGroupWeapon);
      setStrikingRune(item.meta_data?.runes?.striking);
      setResilientRune(item.meta_data?.runes?.resilient);
      setPotencyRune(item.meta_data?.runes?.potency);
      // Split the property-rune array into "battlezoo imbued" vs
      // "normal property runes" based on whether each entry has the
      // Imbued Property trait. This way reopening an item edited in
      // Battlezoo mode hydrates the right picker.
      const bz = item.meta_data?.battlezoo;
      const allProps = item.meta_data?.runes?.property ?? [];
      if (bz?.enabled) {
        setBzEnabled(true);
        const cat = bz.category ?? monsterPartsCategoryFor(item);
        setBzCategory(cat);
        setBzSkillVariable(bz.skill_variable);
        setBzLevel(levelFromValue(bz.refinement_value ?? 0, cat));
        setBzImbuedProperties(allProps);
        setPropertyRunes([]);
      } else {
        setBzEnabled(false);
        setBzLevel(undefined);
        setBzCategory(undefined);
        setBzSkillVariable(undefined);
        setBzImbuedProperties([]);
        setPropertyRunes(allProps);
      }
      setUpgradeSlots(item.meta_data?.starfinder?.slots);
      setBaseItem(item.meta_data?.base_item ?? undefined);
      setBaseItemContent(item.meta_data?.base_item_content);
      setMaterialType(item.meta_data?.material?.type ?? undefined);
      refreshDisplayDescription();

      return item;
    },
    enabled: editing,
    refetchOnWindowFocus: false,
  });

  const [description, setDescription] = useState<JSONContent>();
  const [traits, setTraits] = useState<Trait[]>([]);

  const [armorCategory, setArmorCategory] = useState<ItemMetaCategoryArmor | undefined>(undefined);
  const [armorGroup, setArmorGroup] = useState<ItemMetaGroupArmor | undefined>(undefined);

  const [weaponCategory, setWeaponCategory] = useState<ItemMetaCategoryWeapon | undefined>(undefined);
  const [weaponGroup, setWeaponGroup] = useState<ItemMetaGroupWeapon | undefined>(undefined);

  const [strikingRune, setStrikingRune] = useState<number | undefined>(0);
  const [resilientRune, setResilientRune] = useState<number | undefined>(0);
  const [potencyRune, setPotencyRune] = useState<number | undefined>(0);
  const [propertyRunes, setPropertyRunes] = useState<{ name: string; id: number; rune?: Item }[] | undefined>([]);

  // Battlezoo Monster Parts state — mutually exclusive with the
  // fundamental + property runes above. The user picks an item level
  // and we map it back to the minimum refinement_value that produces
  // it (via valueForLevel) for storage. Imbued properties are stored
  // in the same runes.property array as normal property runes, since
  // they slot into the same compute path; the picker below the level
  // input is just a filtered alternative entry to that array.
  const [bzEnabled, setBzEnabled] = useState<boolean>(false);
  const [bzLevel, setBzLevel] = useState<number | undefined>(undefined);
  const [bzCategory, setBzCategory] = useState<'weapon' | 'armor' | 'shield' | 'perception' | 'skill' | undefined>(undefined);
  const [bzSkillVariable, setBzSkillVariable] = useState<string | undefined>(undefined);
  const [bzImbuedProperties, setBzImbuedProperties] = useState<{ name: string; id: number; rune?: Item }[]>([]);

  // Trait id for "Imbued Property" — used to (a) filter the Battlezoo
  // imbued-property picker to only items carrying that trait, and (b)
  // filter the normal property-rune picker to EXCLUDE items with the
  // trait so Battlezoo items don't bleed into the rune dropdown. Looked
  // up lazily from the trait cache; if the Battlezoo bundle isn't
  // imported, this is undefined and the filters fall back to "no
  // Battlezoo trait → all RUNE items show in the normal picker".
  const imbuedPropertyTraitId = (() => {
    const traits = getCachedContent<Trait>('trait');
    return traits.find((t) => t.name === 'Imbued Property')?.id;
  })();

  const [upgradeSlots, setUpgradeSlots] = useState<{ name: string; id: number; upgrade?: Item }[] | undefined>([]);

  const [baseItem, setBaseItem] = useState<string | undefined>();
  const [baseItemContent, setBaseItemContent] = useState<Item | undefined>();

  const [materialType, setMaterialType] = useState<string | undefined>();

  const form = useForm<Item>({
    initialValues: {
      id: -1,
      created_at: '',
      name: '',
      price: {
        cp: undefined,
        sp: undefined,
        gp: undefined,
        pp: undefined,
      },
      bulk: null,
      level: 0,
      rarity: 'COMMON',
      availability: undefined as Availability | undefined,
      traits: [],
      description: '',
      group: 'GENERAL',
      hands: null,
      size: 'MEDIUM',
      craft_requirements: '',
      usage: '',
      meta_data: {
        image_url: '',
        base_item: '',
        category: undefined,
        damage: {
          damageType: '',
          dice: 1,
          die: '',
          extra: '',
        },
        ac_bonus: undefined,
        check_penalty: undefined,
        speed_penalty: undefined,
        dex_cap: undefined,
        strength: undefined,
        bulk: {
          capacity: undefined,
          held_or_stowed: undefined,
          ignored: undefined,
        },
        group: undefined,
        hardness: undefined,
        hp: undefined,
        hp_max: undefined,
        broken_threshold: undefined,
        is_shoddy: false,
        unselectable: false,
        quantity: 1,
        material: {
          grade: undefined,
          type: undefined,
        },
        range: undefined,
        reload: undefined,
        runes: {
          striking: undefined,
          potency: undefined,
          property: [],
        },
        starfinder: {
          capacity: undefined,
          usage: undefined,
          grade: undefined,
          slots: [],
        },
        charges: {
          current: undefined,
          max: undefined,
        },
        foundry: {},
      },
      operations: [],
      content_source_id: -1,
      version: '1.0',
    },

    validate: {
      level: (value) => (value !== undefined && !isNaN(+value) ? null : 'Invalid level'),
      rarity: (value) => (['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'].includes(value) ? null : 'Invalid rarity'),
    },
  });

  const onSubmit = async (values: typeof form.values) => {
    // Combine the form values with the controlled state values

    props.onComplete({
      ...values,
      name: values.name.trim(),
      level: values.level ? +values.level : 0,
      traits: traits.map((trait) => trait.id),
      meta_data: {
        ...values.meta_data!,
        base_item: baseItem,
        base_item_content: baseItemContent,
        material: {
          ...values.meta_data?.material,
          type: materialType,
        },
        // Mutually exclusive: in Battlezoo mode, fundamental runes
        // (potency/striking/resilient) come from the refinement level
        // at compute time via applyMonsterPartsToItem — we leave the
        // stored values cleared. Property-rune slots hold imbued
        // properties. In normal mode, fundamental + property runes
        // work as usual and battlezoo is undefined.
        runes: bzEnabled
          ? {
              striking: undefined,
              resilient: undefined,
              potency: undefined,
              property: bzImbuedProperties,
            }
          : {
              striking: strikingRune,
              resilient: resilientRune,
              potency: potencyRune,
              property: propertyRunes,
            },
        battlezoo: bzEnabled
          ? {
              enabled: true,
              refinement_value: bzLevel && bzCategory ? valueForLevel(bzLevel, bzCategory) : 0,
              category: bzCategory,
              skill_variable: bzSkillVariable,
            }
          : undefined,
        starfinder: {
          capacity: values.meta_data?.starfinder?.capacity,
          usage: values.meta_data?.starfinder?.usage,
          grade: values.meta_data?.starfinder?.grade,
          slots: upgradeSlots,
        },
        category: weaponCategory ? weaponCategory : armorCategory,
        group: weaponGroup ? weaponGroup : armorGroup,
      },
    });
    setTimeout(() => {
      onReset();
    }, 1000);
  };

  const onReset = () => {
    form.reset();
    setTraits([]);
    setDescription(undefined);
  };

  // Count the number of misc. sections that are filled out
  const miscSectionCount =
    (baseItem && baseItem.length > 0 ? 1 : 0) +
    (form.values.meta_data?.damage?.die && form.values.meta_data.damage.die.length > 0 ? 1 : 0) +
    (form.values.meta_data?.damage?.damageType && form.values.meta_data.damage.damageType.length > 0 ? 1 : 0) +
    (form.values.meta_data?.damage?.extra && form.values.meta_data.damage.extra.length > 0 ? 1 : 0) +
    ((weaponCategory || armorCategory) && (weaponCategory || armorCategory) ? 1 : 0) +
    ((weaponGroup || armorGroup) && (weaponGroup || armorGroup) ? 1 : 0) +
    (form.values.meta_data?.range && Number(form.values.meta_data.range) > 0 ? 1 : 0) +
    (form.values.meta_data?.reload && form.values.meta_data.reload.length > 0 ? 1 : 0) +
    (form.values.meta_data?.starfinder?.capacity && form.values.meta_data.starfinder.capacity.length > 0 ? 1 : 0) +
    (form.values.meta_data?.starfinder?.usage && Number(form.values.meta_data.starfinder.usage) > 0 ? 1 : 0) +
    (form.values.meta_data?.damage?.dice && Number(form.values.meta_data.damage?.dice) > 0 ? 1 : 0) +
    (form.values.meta_data?.starfinder?.slots?.length && form.values.meta_data.starfinder.slots.length > 0 ? 1 : 0) +
    (form.values.meta_data?.attack_bonus && form.values.meta_data.attack_bonus !== 0 ? 1 : 0) +
    (form.values.meta_data?.ac_bonus && Number(form.values.meta_data.ac_bonus) > 0 ? 1 : 0) +
    (form.values.meta_data?.check_penalty && Number(form.values.meta_data.check_penalty) < 0 ? 1 : 0) +
    (form.values.meta_data?.speed_penalty && Number(form.values.meta_data.speed_penalty) < 0 ? 1 : 0) +
    (form.values.meta_data?.dex_cap && Number(form.values.meta_data.dex_cap) > 0 ? 1 : 0) +
    (form.values.meta_data?.strength && Number(form.values.meta_data.strength) > 0 ? 1 : 0) +
    (form.values.meta_data?.bulk?.capacity && Number(form.values.meta_data.bulk.capacity) > 0 ? 1 : 0) +
    (form.values.meta_data?.bulk?.held_or_stowed && Number(form.values.meta_data.bulk.held_or_stowed) > 0 ? 1 : 0) +
    (form.values.meta_data?.bulk?.ignored && Number(form.values.meta_data.bulk.ignored) > 0 ? 1 : 0) +
    (strikingRune && strikingRune > 0 ? 1 : 0) +
    (resilientRune && resilientRune > 0 ? 1 : 0) +
    (potencyRune && potencyRune > 0 ? 1 : 0) +
    (propertyRunes && propertyRunes.length > 0 ? 1 : 0) +
    (materialType && materialType.length > 0 ? 1 : 0) +
    (form.values.meta_data?.material?.grade && form.values.meta_data.material.grade.length > 0 ? 1 : 0) +
    (form.values.meta_data?.hardness && Number(form.values.meta_data.hardness) > 0 ? 1 : 0) +
    (form.values.meta_data?.hp_max && Number(form.values.meta_data.hp_max) > 0 ? 1 : 0) +
    (form.values.meta_data?.broken_threshold && Number(form.values.meta_data.broken_threshold) > 0 ? 1 : 0) +
    (form.values.meta_data?.is_shoddy ? 1 : 0) +
    (form.values.meta_data?.unselectable ? 1 : 0) +
    ((form.values.meta_data?.container_default_items ?? []).length > 0 ? 1 : 0) +
    (form.values.meta_data?.quantity && form.values.meta_data.quantity > 0 ? 1 : 0) +
    (form.values.meta_data?.image_url && form.values.meta_data.image_url.length > 0 ? 1 : 0);

  // Header crumb: shows the item group + name once available. Falls
  // back to a generic "Item" label until the user types something.
  const crumbGroup = form.values.group ? toLabel(form.values.group) : 'Item';
  const crumbName = form.values.name?.trim();

  // Bind a native <input>/<select> to a Mantine form field. Mantine's
  // getInputProps returns { value, onChange, ... } where onChange reads
  // event.currentTarget.value (it accepts a raw DOM event), so we hand
  // the native change event straight through. Coerce null/undefined
  // values to '' so React keeps the input controlled.
  const bind = (key: string) => {
    const p = form.getInputProps(key);
    return {
      value: (p.value ?? '') as string | number,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => p.onChange(e),
    };
  };

  return (
    <Modal
      opened={props.opened}
      onClose={() => {
        props.onCancel();
        onReset();
      }}
      title={null}
      withCloseButton={false}
      padding={0}
      // Native Mantine size so the modal is wide even before the CSS
      // frame rule applies; the wg4-edit-item.css caps it at
      // min(1100px, 100vw - 32px) so it never overflows the viewport.
      size='1100px'
      classNames={{ content: 'codex-edit-item-content', body: 'codex-edit-item-body' }}
      closeOnClickOutside={false}
      closeOnEscape={false}
      keepMounted={false}
      zIndex={props.zIndex}
      overlayProps={{ backgroundOpacity: 0.92, blur: 2 }}
    >
      <div className='codex-edit-item'>
        <div className='modal-head'>
          <div className='title'>
            {editing ? 'Edit Item' : 'Create Item'}
            <span className='crumb'>
              <b>{crumbGroup}</b>
              {crumbName && <> · {crumbName}</>}
            </span>
          </div>
          <button
            type='button'
            className='close'
            onClick={() => {
              props.onCancel();
              onReset();
            }}
            aria-label='Close'
          >
            <svg viewBox='0 0 14 14'>
              <path d='M3 3 L11 11 M11 3 L3 11' />
            </svg>
          </button>
        </div>

        <div className='modal-body'>
          <LoadingOverlay visible={loading || isFetching} />
          <form
            id='codex-edit-item-form'
            onSubmit={form.onSubmit(onSubmit)}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            {/* Lvl · Rarity · Name */}
            <div className='row'>
              <div className='field lvl'>
                <div className='lbl'>Lvl</div>
                <input className='input num' type='number' {...bind('level')} />
              </div>
              <div className='field rarity'>
                <div className='lbl'>Rarity</div>
                <select className='select' {...bind('rarity')}>
                  <option value='COMMON'>Common</option>
                  <option value='UNCOMMON'>Uncommon</option>
                  <option value='RARE'>Rare</option>
                  <option value='UNIQUE'>Unique</option>
                </select>
              </div>
              <div className='field flex'>
                <div className='lbl'>
                  Name <span className='req'>✦</span>
                </div>
                <input
                  className='input'
                  {...bind('name')}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text/plain');
                    if (text.toUpperCase() === text) {
                      e.preventDefault();
                      form.setFieldValue('name', toLabel(text));
                    }
                  }}
                  onBlur={() => props.onNameBlur?.(form.values.name)}
                />
              </div>
            </div>

            {/* Traits — keeps the TraitsInput component, wrapped so it
                inherits the .traits-input look (the component renders its
                own chip row + add input internally). */}
            <div className='row'>
              <div className='field flex'>
                <div className='lbl'>Traits</div>
                <TraitsInput
                  value={traits.map((trait) => trait.name)}
                  onTraitChange={(traits) => setTraits(traits)}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            {/* Price (pp/gp/sp/cp) */}
            <div className='row'>
              <div className='field coin'>
                <div className='lbl'>PP</div>
                <input className='input num' type='number' min={0} {...bind('price.pp')} />
              </div>
              <div className='field coin'>
                <div className='lbl'>GP</div>
                <input className='input num' type='number' min={0} {...bind('price.gp')} />
              </div>
              <div className='field coin'>
                <div className='lbl'>SP/Credits</div>
                <input className='input num' type='number' min={0} {...bind('price.sp')} />
              </div>
              <div className='field coin'>
                <div className='lbl'>CP</div>
                <input className='input num' type='number' min={0} {...bind('price.cp')} />
              </div>
              <div className='field flex'>
                <div className='lbl'>Bulk</div>
                <input className='input num' type='number' min={0} step='0.01' {...bind('bulk')} />
              </div>
            </div>

            {/* Size · Group · Hands */}
            <div className='row'>
              <div className='field flex'>
                <div className='lbl'>Size</div>
                <select className='select' {...bind('size')}>
                  <option value='TINY'>Tiny</option>
                  <option value='SMALL'>Small</option>
                  <option value='MEDIUM'>Medium</option>
                  <option value='LARGE'>Large</option>
                  <option value='HUGE'>Huge</option>
                  <option value='GARGANTUAN'>Gargantuan</option>
                </select>
              </div>
              <div className='field flex'>
                <div className='lbl'>Group</div>
                <select className='select' {...bind('group')}>
                  <option value='GENERAL'>General</option>
                  <option value='ARMOR'>Armor</option>
                  <option value='SHIELD'>Shield</option>
                  <option value='WEAPON'>Weapon</option>
                  <option value='RUNE'>Rune</option>
                  <option value='UPGRADE'>Upgrade</option>
                  <option value='MATERIAL'>Material</option>
                </select>
              </div>
              <div className='field flex'>
                <div className='lbl'>Hands</div>
                <select className='select' {...bind('hands')}>
                  <option value=''>—</option>
                  <option value='1'>1</option>
                  <option value='1+'>1+</option>
                  <option value='2'>2</option>
                  <option value='2+'>2+</option>
                  <option value='1 or 2'>1 or 2</option>
                </select>
              </div>
            </div>

            {/* Usage */}
            <div className='field'>
              <div className='lbl'>Usage</div>
              <input className='input' placeholder='Usage' {...bind('usage')} />
            </div>

            {/* ───── Additional Fields divider ─────────────────────── */}
            <div className='divider'>
              <button
                type='button'
                className={`ld-trigger${openedAdditional ? ' on' : ''}`}
                onClick={toggleAdditional}
              >
                Additional Fields
                <span className='chev' />
              </button>
              {miscSectionCount > 0 && <span className='ld-badge'>{miscSectionCount}</span>}
              <div className='rule' />
            </div>

            {openedAdditional && (
              <div className='misc-section'>
                <Box pb={5}>
                  <ItemSelect
                    label='Base Item'
                    placeholder='(for proficiency tracking)'
                    valueName={baseItem}
                    filter={(item) => {
                      return (
                        (!item.meta_data?.base_item &&
                          labelToVariable(item.name) !== labelToVariable(form.values.name)) ||
                        // To support old incorrect items
                        labelToVariable(item.name) === labelToVariable(item.meta_data?.base_item ?? '')
                      );
                    }}
                    onChange={(item, name) => {
                      setBaseItem(name);
                      setBaseItemContent(item);
                    }}
                  />
                </Box>

                <Accordion variant='separated'>
                  <Accordion.Item value={'weapon'}>
                    <Accordion.Control>
                      <Text fz='sm'>Weapon</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={10}>
                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Num. of Dice'
                            placeholder='(+ Striking)'
                            {...form.getInputProps('meta_data.damage.dice')}
                          />
                          <Select
                            label='Damage Die'
                            clearable
                            data={[
                              { value: 'd2', label: 'd2' },
                              { value: 'd4', label: 'd4' },
                              { value: 'd6', label: 'd6' },
                              { value: 'd8', label: 'd8' },
                              { value: 'd10', label: 'd10' },
                              { value: 'd12', label: 'd12' },
                              { value: 'd20', label: 'd20' },
                            ]}
                            {...form.getInputProps('meta_data.damage.die')}
                          />
                          <TextInput
                            label='Damage Type'
                            placeholder='ex. slashing'
                            {...form.getInputProps('meta_data.damage.damageType')}
                          />
                        </Group>

                        <Group wrap='nowrap'>
                          <Select
                            label='Category'
                            clearable
                            data={
                              [
                                { value: 'simple', label: 'Simple' },
                                { value: 'martial', label: 'Martial' },
                                { value: 'advanced', label: 'Advanced' },
                                { value: 'unarmed_attack', label: 'Unarmed' },
                              ] satisfies { value: ItemMetaCategoryWeapon; label: string }[]
                            }
                            value={weaponCategory}
                            onChange={(value) => {
                              setWeaponCategory((value as ItemMetaCategoryWeapon) || undefined);
                              setArmorCategory(undefined);
                            }}
                          />

                          <Select
                            label='Group'
                            clearable
                            data={
                              [
                                { value: 'axe', label: 'Axe' },
                                { value: 'bomb', label: 'Bomb' },
                                { value: 'bow', label: 'Bow' },
                                { value: 'brawling', label: 'Brawling' },
                                { value: 'club', label: 'Club' },
                                { value: 'crossbow', label: 'Crossbow' },
                                { value: 'dart', label: 'Dart' },
                                { value: 'firearm', label: 'Firearm' },
                                { value: 'flail', label: 'Flail' },
                                { value: 'hammer', label: 'Hammer' },
                                { value: 'knife', label: 'Knife' },
                                { value: 'pick', label: 'Pick' },
                                { value: 'polearm', label: 'Polearm' },
                                { value: 'projectile', label: 'Projectile' },
                                { value: 'shield', label: 'Shield' },
                                { value: 'sling', label: 'Sling' },
                                { value: 'spear', label: 'Spear' },
                                { value: 'sword', label: 'Sword' },
                                // Starfinder weapon groups
                                { value: 'corrosive', label: 'Corrosive' },
                                { value: 'cryo', label: 'Cryo' },
                                { value: 'flame', label: 'Flame' },
                                { value: 'grenade', label: 'Grenade' },
                                { value: 'laser', label: 'Laser' },
                                { value: 'mental', label: 'Mental' },
                                { value: 'missile', label: 'Missile' },
                                { value: 'plasma', label: 'Plasma' },
                                { value: 'poison', label: 'Poison' },
                                { value: 'shock', label: 'Shock' },
                                { value: 'sniper', label: 'Sniper' },
                                { value: 'sonic', label: 'Sonic' },
                              ] satisfies { value: ItemMetaGroupWeapon; label: string }[]
                            }
                            value={weaponGroup}
                            onChange={(value) => {
                              setWeaponGroup((value as ItemMetaGroupWeapon) || undefined);
                              setArmorGroup(undefined);
                            }}
                          />
                        </Group>

                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Range'
                            placeholder='Range'
                            min={0}
                            {...form.getInputProps('meta_data.range')}
                          />

                          <TextInput
                            label='Reload'
                            placeholder='Reload'
                            {...form.getInputProps('meta_data.reload')}
                          />
                        </Group>

                        <Divider mt={10} />

                        <Group wrap='nowrap'>
                          <TextInput
                            label='Capacity'
                            placeholder='Capacity'
                            {...form.getInputProps('meta_data.starfinder.capacity')}
                          />

                          <NumberInput
                            label='Amm. Usage'
                            placeholder='Amm. Usage'
                            min={0}
                            {...form.getInputProps('meta_data.starfinder.usage')}
                          />
                        </Group>
                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Max Upgrades'
                            placeholder='Max Upgrades'
                            {...form.getInputProps('meta_data.starfinder.upgrades')}
                          />
                        </Group>

                        <Divider mt={10} />

                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Extra Attack Bonus'
                            placeholder='(as item bonus)'
                            prefix={(form.values.meta_data?.attack_bonus ?? 0) >= 0 ? '+' : undefined}
                            // suffix={(form.values.meta_data?.attack_bonus ?? 0) >= 0 ? ' item bonus' : ' item penalty'}
                            allowDecimal={false}
                            {...form.getInputProps('meta_data.attack_bonus')}
                          />
                          <TextInput
                            label='Extra Damage'
                            placeholder='ex. 1d4 fire'
                            {...form.getInputProps('meta_data.damage.extra')}
                          />
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value={'armor-shield'}>
                    <Accordion.Control>
                      <Text fz='sm'>Armor / Shield</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={10}>
                        <NumberInput
                          label='AC Bonus'
                          placeholder='AC Bonus'
                          {...form.getInputProps('meta_data.ac_bonus')}
                        />

                        <Group wrap='nowrap'>
                          <Select
                            label='Category'
                            clearable
                            data={
                              [
                                { value: 'light', label: 'Light' },
                                { value: 'medium', label: 'Medium' },
                                { value: 'heavy', label: 'Heavy' },
                                { value: 'unarmored_defense', label: 'Unarmored' },
                              ] satisfies { value: ItemMetaCategoryArmor; label: string }[]
                            }
                            value={armorCategory}
                            onChange={(value) => {
                              setArmorCategory((value as ItemMetaCategoryArmor) ?? undefined);
                              setWeaponCategory(undefined);
                            }}
                          />

                          <Select
                            label='Group'
                            clearable
                            data={getArmorSpecializations(true).map((spec) => ({
                              value: spec.name.toLowerCase(),
                              label: spec.name,
                            }))}
                            value={armorGroup}
                            onChange={(value) => {
                              setArmorGroup((value as ItemMetaGroupArmor) ?? undefined);
                              setWeaponGroup(undefined);
                            }}
                          />
                        </Group>

                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Check Penalty'
                            placeholder='Check Penalty'
                            max={0}
                            {...form.getInputProps('meta_data.check_penalty')}
                          />

                          <NumberInput
                            label='Speed Penalty'
                            placeholder='Speed Penalty'
                            max={0}
                            {...form.getInputProps('meta_data.speed_penalty')}
                          />
                        </Group>

                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Dexterity Cap'
                            placeholder='Dexterity Cap'
                            min={0}
                            {...form.getInputProps('meta_data.dex_cap')}
                          />

                          <NumberInput
                            label='Min Strength'
                            placeholder='Min Strength'
                            min={0}
                            {...form.getInputProps('meta_data.strength')}
                          />
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value={'Runes / Upgrades'}>
                    <Accordion.Control>
                      <Text fz='sm'>Runes / Upgrades</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={10}>
                        <Stack gap={10}>
                          {/* Normal fundamental + property runes. Disabled
                              when Battlezoo mode is on — the rule is mutually
                              exclusive ("an item is either built and upgraded
                              using this system OR the normal rules…"). When
                              bzEnabled is true the existing values are kept
                              in state but greyed out; toggling Battlezoo off
                              restores them. */}
                          <Group wrap='nowrap'>
                            <Select
                              label='Potency Rune'
                              clearable
                              disabled={bzEnabled}
                              data={[
                                { value: '1', label: '+1 Potency' },
                                { value: '2', label: '+2 Potency' },
                                { value: '3', label: '+3 Potency' },
                                { value: '4', label: '+4 Potency' },
                                { value: '10', label: 'Mythic P.' },
                              ]}
                              value={potencyRune !== undefined ? `${potencyRune}` : undefined}
                              onChange={(value) => {
                                setPotencyRune(value ? +value : undefined);
                              }}
                            />
                            <Select
                              label='Striking Rune'
                              clearable
                              disabled={bzEnabled}
                              data={[
                                { value: '1', label: 'Striking' },
                                { value: '2', label: 'Greater S.' },
                                { value: '3', label: 'Major S.' },
                                { value: '10', label: 'Mythic S.' },
                              ]}
                              value={strikingRune !== undefined ? `${strikingRune}` : undefined}
                              onChange={(value) => {
                                setStrikingRune(value ? +value : undefined);
                              }}
                            />

                            <Select
                              label='Resilient Rune'
                              clearable
                              disabled={bzEnabled}
                              data={[
                                { value: '1', label: 'Resilient' },
                                { value: '2', label: 'Greater R.' },
                                { value: '3', label: 'Major R.' },
                                { value: '10', label: 'Mythic R.' },
                              ]}
                              value={resilientRune !== undefined ? `${resilientRune}` : undefined}
                              onChange={(value) => {
                                setResilientRune(value ? +value : undefined);
                              }}
                            />
                          </Group>

                          <ItemMultiSelect
                            label='Property Runes'
                            placeholder='(limited to potency rune #)'
                            disabled={bzEnabled}
                            valueName={propertyRunes?.map((rune) => rune.name)}
                            filter={(item) => {
                              if (item.group !== 'RUNE') return false;
                              if (isItemFundamentalRune(item)) return false;
                              // Exclude Battlezoo imbued-property items so they
                              // never appear in the normal property-rune picker.
                              if (
                                imbuedPropertyTraitId !== undefined &&
                                (item.traits ?? []).includes(imbuedPropertyTraitId)
                              ) {
                                return false;
                              }
                              return true;
                            }}
                            onChange={(items, _names) => {
                              const cap = Math.min(potencyRune ?? 0, 4);
                              if ((items ?? []).length > cap) {
                                return;
                              }
                              setPropertyRunes(
                                items?.map((item) => ({ name: item.name, id: item.id, rune: item })) ?? []
                              );
                            }}
                          />
                        </Stack>

                        {/* ─── Battlezoo Monster Parts section ───────────
                            Mutually exclusive with the normal runes
                            above. The "Use Monster Parts" toggle is
                            disabled when normal runes are filled in.
                            When the toggle is on, the Battlezoo controls
                            (category, level, skill, imbued props) are
                            live and the rune controls above are greyed
                            out. */}
                        <Divider mt={10} mb={5} />
                        {(() => {
                          const hasRunes =
                            !!(potencyRune || strikingRune || resilientRune ||
                            (propertyRunes && propertyRunes.length > 0));
                          return (
                            <Stack gap={8}>
                              <Group justify='space-between' wrap='nowrap'>
                                <Stack gap={0}>
                                  <Text fz='sm' fw={600} c='gray.2'>Battlezoo Monster Parts</Text>
                                  <Text fz='xs' c='gray.5'>
                                    Refines and imbues this item with monster parts instead of runes (mutually exclusive).
                                  </Text>
                                </Stack>
                                <Switch
                                  checked={bzEnabled}
                                  disabled={hasRunes}
                                  onChange={(e) => setBzEnabled(e.currentTarget.checked)}
                                />
                              </Group>
                              {hasRunes && !bzEnabled && (
                                <Text fz='xs' c='yellow.6' fs='italic'>
                                  Clear the runes above to enable Monster Parts on this item.
                                </Text>
                              )}
                              {bzEnabled && (
                                <>
                                  <Group wrap='nowrap' align='end'>
                                    <Select
                                      label='Category'
                                      placeholder='Pick category'
                                      value={bzCategory ?? null}
                                      data={[
                                        { value: 'weapon', label: 'Weapon' },
                                        { value: 'armor', label: 'Armor' },
                                        { value: 'shield', label: 'Shield' },
                                        { value: 'perception', label: 'Perception Item' },
                                        { value: 'skill', label: 'Skill Item' },
                                      ]}
                                      onChange={(v) => {
                                        if (v) setBzCategory(v as typeof bzCategory);
                                      }}
                                    />
                                    <NumberInput
                                      label='Refined Item Level'
                                      placeholder='1 - 20'
                                      min={0}
                                      max={20}
                                      value={bzLevel ?? ''}
                                      onChange={(v) => setBzLevel(typeof v === 'number' ? v : undefined)}
                                    />
                                    {bzCategory === 'skill' && (
                                      <Select
                                        label='Skill'
                                        placeholder='Pick a skill'
                                        value={bzSkillVariable ?? null}
                                        data={[
                                          { value: 'SKILL_ACROBATICS', label: 'Acrobatics' },
                                          { value: 'SKILL_ARCANA', label: 'Arcana' },
                                          { value: 'SKILL_ATHLETICS', label: 'Athletics' },
                                          { value: 'SKILL_CRAFTING', label: 'Crafting' },
                                          { value: 'SKILL_DECEPTION', label: 'Deception' },
                                          { value: 'SKILL_DIPLOMACY', label: 'Diplomacy' },
                                          { value: 'SKILL_INTIMIDATION', label: 'Intimidation' },
                                          { value: 'SKILL_MEDICINE', label: 'Medicine' },
                                          { value: 'SKILL_NATURE', label: 'Nature' },
                                          { value: 'SKILL_OCCULTISM', label: 'Occultism' },
                                          { value: 'SKILL_PERFORMANCE', label: 'Performance' },
                                          { value: 'SKILL_RELIGION', label: 'Religion' },
                                          { value: 'SKILL_SOCIETY', label: 'Society' },
                                          { value: 'SKILL_STEALTH', label: 'Stealth' },
                                          { value: 'SKILL_SURVIVAL', label: 'Survival' },
                                          { value: 'SKILL_THIEVERY', label: 'Thievery' },
                                        ]}
                                        onChange={(v) => { if (v) setBzSkillVariable(v); }}
                                      />
                                    )}
                                  </Group>
                                  <ItemMultiSelect
                                    label={`Imbued Properties${bzLevel ? ` (Lvl ≤ ${bzLevel})` : ''}`}
                                    placeholder={
                                      imbuedPropertyTraitId === undefined
                                        ? 'Import the Battlezoo Bestiary bundle to enable'
                                        : bzLevel
                                          ? `(must have the Imbued Property trait, level ≤ ${bzLevel})`
                                          : 'Set the refined item level first'
                                    }
                                    valueName={bzImbuedProperties.map((p) => p.name)}
                                    // Filter: must be a Battlezoo Imbued Property item AND its level
                                    // must be ≤ the item's refined level (per rule: "An imbued
                                    // property's level can never be higher than the item's level").
                                    // Until a refinement level is set, nothing is pickable.
                                    filter={(item) => {
                                      if (item.group !== 'RUNE') return false;
                                      if (imbuedPropertyTraitId === undefined) return false;
                                      if (!(item.traits ?? []).includes(imbuedPropertyTraitId)) return false;
                                      if (!bzLevel || bzLevel < 1) return false;
                                      return (item.level ?? 0) <= bzLevel;
                                    }}
                                    onChange={(items, _names) => {
                                      setBzImbuedProperties(
                                        items?.map((it) => ({ name: it.name, id: it.id, rune: it })) ?? []
                                      );
                                    }}
                                  />
                                  <Text fz='xs' c='gray.5' fs='italic'>
                                    The refined-item-level controls how strong this item's monster-parts bonuses are. Imbued Properties stack with the refinement (and with each other via different paths).
                                  </Text>
                                </>
                              )}
                            </Stack>
                          );
                        })()}
                        <Divider mt={10} mb={5} />
                        <Stack gap={10}>
                          <Select
                            label='Grade'
                            clearable
                            data={[
                              { value: 'COMMERCIAL', label: 'Commercial' },
                              { value: 'TACTICAL', label: 'Tactical' },
                              { value: 'ADVANCED', label: 'Advanced' },
                              { value: 'SUPERIOR', label: 'Superior' },
                              { value: 'ELITE', label: 'Elite' },
                              { value: 'ULTIMATE', label: 'Ultimate' },
                              { value: 'PARAGON', label: 'Paragon' },
                            ]}
                            {...form.getInputProps('meta_data.starfinder.grade')}
                          />
                          <ItemMultiSelect
                            label='Upgrade Slots'
                            placeholder='(limited by grade)'
                            valueName={upgradeSlots?.map((slot) => slot.name)}
                            filter={(item) => {
                              return item.group === 'UPGRADE';
                            }}
                            onChange={(items, _names) => {
                              // if ((items ?? []).length > (grade ?? 0)) {
                              //   return;
                              // }
                              setUpgradeSlots(
                                items?.map((item) => ({ name: item.name, id: item.id, upgrade: item })) ?? []
                              );
                            }}
                          />
                        </Stack>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value={'container'}>
                    <Accordion.Control>
                      <Text fz='sm'>Container</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={10}>
                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Bulk Capacity'
                            placeholder='Bulk Capacity'
                            min={0}
                            {...form.getInputProps('meta_data.bulk.capacity')}
                          />

                          <NumberInput
                            label='Bulk Ignored'
                            placeholder='Bulk Ignored'
                            min={0}
                            {...form.getInputProps('meta_data.bulk.ignored')}
                          />
                        </Group>

                        <Box>
                          <Group wrap='nowrap' justify='space-between'>
                            <Text fz='sm'>Default Item Contents</Text>
                            <ActionIcon
                              variant='subtle'
                              color='gray.5'
                              radius='lg'
                              aria-label='Add Item'
                              onClick={() => {
                                selectContent<Item>(
                                  'item',
                                  (option) => {
                                    const contents = [
                                      ...(form.values.meta_data?.container_default_items ?? []),
                                      { id: option.id, name: option.name, quantity: option.meta_data?.quantity ?? 1 },
                                    ];
                                    form.setFieldValue('meta_data.container_default_items', contents);
                                  },
                                  {
                                    showButton: true,
                                  }
                                );
                              }}
                            >
                              <IconCirclePlus style={{ width: '70%', height: '70%' }} stroke={1.5} />
                            </ActionIcon>
                          </Group>
                          <Paper withBorder p='xs'>
                            <ScrollArea h={100} scrollbars='y'>
                              <Group gap={8}>
                                {(form.values.meta_data?.container_default_items ?? []).map((record, i) => (
                                  <Badge
                                    key={i}
                                    size='xs'
                                    variant='light'
                                    style={{ cursor: 'pointer' }}
                                    styles={{
                                      root: {
                                        textTransform: 'initial',
                                      },
                                    }}
                                    onClick={() => {
                                      // Bug where it closes the modal by closing the source drawer
                                      // openDrawer({
                                      //   type: 'item',
                                      //   data: { id: record.id },
                                      // });
                                    }}
                                    pr={0}
                                    rightSection={
                                      <ActionIcon
                                        variant='subtle'
                                        color='gray'
                                        size='xs'
                                        aria-label='Remove Item'
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const records =
                                            form.values.meta_data?.container_default_items?.filter(
                                              (i) => i.id !== record.id
                                            ) ?? [];
                                          form.setFieldValue('meta_data.container_default_items', records);
                                        }}
                                      >
                                        <IconX style={{ width: '70%', height: '70%' }} stroke={1.5} />
                                      </ActionIcon>
                                    }
                                  >
                                    {truncate(`${record.name}`, { length: 22 })}
                                  </Badge>
                                ))}
                              </Group>
                              {(form.values.meta_data?.container_default_items ?? []).length === 0 && (
                                <Text fz='sm' c='dimmed' ta='center' fs='italic'>
                                  No default item contents.
                                </Text>
                              )}
                            </ScrollArea>
                          </Paper>
                        </Box>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value={'hp'}>
                    <Accordion.Control>
                      <Text fz='sm'>Hit Points</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={10}>
                        <Group>
                          <NumberInput
                            label='Hardness'
                            placeholder='Hardness'
                            min={0}
                            {...form.getInputProps('meta_data.hardness')}
                          />

                          <NumberInput
                            label='Max HP'
                            placeholder='Max HP'
                            min={0}
                            {...form.getInputProps('meta_data.hp_max')}
                          />

                          <NumberInput
                            label='Broken Threshold'
                            placeholder='(typically 1/2 max HP)'
                            min={0}
                            {...form.getInputProps('meta_data.broken_threshold')}
                          />
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value={'material'}>
                    <Accordion.Control>
                      <Text fz='sm'>Material</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={10}>
                        <Group wrap='nowrap'>
                          <ItemSelect
                            label='Type'
                            placeholder='Type'
                            valueName={materialType}
                            filter={(item) => {
                              return item.group === 'MATERIAL';
                            }}
                            onChange={(_item, name) => {
                              setMaterialType(name);
                            }}
                          />

                          <Select
                            label='Grade'
                            clearable
                            data={[
                              { value: 'low', label: 'Low' },
                              { value: 'standard', label: 'Standard' },
                              { value: 'high', label: 'High' },
                            ]}
                            {...form.getInputProps('meta_data.material.grade')}
                          />
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  {/* Generic scroll / wand spell-picker. Conditional
                      on the item name matching "Magic Wand (Nth-rank
                      Spell)" or "Magic Scroll (Nth-rank Spell)" —
                      pre-baked items like "Wand of Shardstorm" don't
                      match (they already have a fixed spell). The
                      rank in the name caps the picker: a 3rd-rank
                      wand shows rank 1, 2, AND 3 spells (PF2e auto-
                      heightens lower-rank picks up to the holder's
                      rank). Cantrips, focus, and ritual spells are
                      excluded — they can't be put on scrolls/wands. */}
                  {(() => {
                    const holder = getFillableSpellHolder(form.values as Item);
                    if (!holder) return null;
                    const chosen = form.values.meta_data?.scroll_wand;
                    return (
                      <Accordion.Item value={'scroll-wand'}>
                        <Accordion.Control>
                          <Text fz='sm'>
                            {holder.kind === 'wand' ? 'Wand' : 'Scroll'} Spell
                          </Text>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap={10}>
                            <Text size='xs' c='dimmed'>
                              Choose any spell of rank {holder.maxRank} or lower.
                              The spell is cast at rank {holder.maxRank}, so lower-
                              rank picks are automatically heightened up to the
                              {holder.kind === 'wand' ? ' wand' : ' scroll'}'s rank.
                            </Text>
                            <SelectContentButton<Spell>
                              type='spell'
                              selectedId={chosen?.spell_id}
                              onClick={(spell) => {
                                form.setFieldValue('meta_data.scroll_wand', {
                                  spell_id: spell.id,
                                  spell_name: spell.name,
                                  // Always cast at the holder's rank.
                                  spell_rank: holder.maxRank,
                                  // Spell's natural rank — drives the
                                  // "Nth → Mth" upcast arrow in the
                                  // drawer description.
                                  base_rank: spell.rank,
                                });
                              }}
                              onClear={() => {
                                form.setFieldValue('meta_data.scroll_wand', undefined);
                              }}
                              options={{
                                // PF2e rules: scrolls/wands accept rank-1+
                                // spells of rank ≤ holder's rank. No
                                // cantrips (rank 0), no focus, no rituals.
                                filterFn: (spell) => {
                                  if (typeof spell.rank !== 'number') return false;
                                  if (spell.rank < 1 || spell.rank > holder.maxRank) return false;
                                  if (spell.meta_data?.focus) return false;
                                  if (spell.meta_data?.ritual) return false;
                                  return true;
                                },
                              }}
                            />
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>
                    );
                  })()}
                  <Accordion.Item value={'other'}>
                    <Accordion.Control>
                      <Text fz='sm'>Other</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={10}>
                        <Switch
                          label='Hidden'
                          labelPosition='left'
                          {...form.getInputProps('meta_data.unselectable', {
                            type: 'checkbox',
                          })}
                        />

                        <Select
                          label='Availability'
                          data={[
                            { value: 'STANDARD', label: 'Standard' },
                            { value: 'LIMITED', label: 'Limited' },
                            { value: 'RESTRICTED', label: 'Restricted' },
                          ]}
                          w={140}
                          {...form.getInputProps('availability')}
                        />

                        <Switch
                          label='Shoddy Item'
                          labelPosition='left'
                          {...form.getInputProps('meta_data.is_shoddy', {
                            type: 'checkbox',
                          })}
                        />

                        <Group wrap='nowrap'>
                          <NumberInput
                            label='Quantity'
                            placeholder='Quantity'
                            min={0}
                            {...form.getInputProps('meta_data.quantity')}
                          />

                          <NumberInput
                            label='Max Charges'
                            placeholder='Max Charges'
                            min={0}
                            {...form.getInputProps('meta_data.charges.max')}
                          />
                        </Group>

                        <NumberInput
                          label='Bulk (when held or stowed)'
                          placeholder='Bulk (when held or stowed)'
                          min={0}
                          {...form.getInputProps('meta_data.bulk.held_or_stowed')}
                        />

                        <SelectIcon
                          strValue={form.values.meta_data?.image_url ?? ''}
                          setValue={(strValue) => {
                            form.setFieldValue('meta_data.image_url', strValue);
                          }}
                        />
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </div>
            )}

            {/* Description (RichTextInput) lives in the body's main
                form flow, after the additional fields. */}
            {displayDescription && (
              <RichTextInput
                label='Description'
                required
                value={description ?? toHTML(form.values.description)}
                onChange={(text, json) => {
                  setDescription(json);
                  form.setFieldValue('description', text);
                }}
                maxHeight={500}
              />
            )}

            <TextInput
              label='Craft Requirements'
              placeholder='Craft Requirements'
              {...form.getInputProps('craft_requirements')}
            />

            {/* ───── Operations divider ─────────────────────────────── */}
            <div className='divider'>
              <button
                type='button'
                className={`ld-trigger${openedOperations ? ' on' : ''}`}
                onClick={toggleOperations}
              >
                Operations
                <span className='chev' />
              </button>
              {form.values.operations && form.values.operations.length > 0 && (
                <span className='ld-badge'>{form.values.operations.length}</span>
              )}
              <div className='rule' />
            </div>

            {openedOperations && (
              <div className='misc-section'>
                <OperationSection
                  title={
                    <HoverCard openDelay={250} width={260} shadow='md' withinPortal>
                      <HoverCard.Target>
                        <Anchor target='_blank' underline='hover' fz='sm' fs='italic'>
                          How to Use Operations
                        </Anchor>
                      </HoverCard.Target>
                      <HoverCard.Dropdown>
                        <Text size='sm'>
                          Operations are used to make changes to a character. They can give feats, spells, and more, as
                          well as change stats, skills, and other values.
                        </Text>
                        <Text size='sm'>
                          Use conditionals to apply operations only when certain conditions are met and selections
                          whenever a choice needs to be made.
                        </Text>
                        <Text size='xs' fs='italic'>
                          For more help, see{' '}
                          <Anchor href={DISCORD_URL} target='_blank' underline='hover'>
                            our Discord server
                          </Anchor>
                          .
                        </Text>
                      </HoverCard.Dropdown>
                    </HoverCard>
                  }
                  operations={form.values.operations ?? undefined}
                  onChange={(operations) => form.setValues({ ...form.values, operations })}
                />
              </div>
            )}
          </form>
        </div>

        <div className='modal-foot'>
          <div className='left'>
            {editing ? (
              <>
                Editing <b>{crumbName || 'item'}</b> · changes apply on save
              </>
            ) : (
              <>New item · fill in the fields above</>
            )}
          </div>
          <div className='actions'>
            <button
              type='button'
              className='btn'
              onClick={() => {
                props.onCancel();
                onReset();
              }}
            >
              Cancel
            </button>
            <button
              type='button'
              className='btn primary'
              onClick={() => form.onSubmit(onSubmit)()}
            >
              {editing ? 'Save Item' : 'Create Item'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
