import {
  upsertAbilityBlock,
  upsertClass,
  upsertContentSource,
  upsertItem,
  upsertSpell,
  upsertTrait,
} from '@content/content-creation';
import { defineDefaultSources, fetchContentAll, fetchContentSources } from '@content/content-store';
import { toMarkdown } from '@content/content-utils';
import { getFileContents } from '@import/json/import-from-json';
import { showNotification, hideNotification } from '@mantine/notifications';
import {
  AbilityBlock,
  ActionCost,
  Availability,
  Class,
  ContentSource,
  Item,
  ItemGroup,
  Rarity,
  Size,
  Spell,
  Trait,
} from '@schemas/content';

export async function importFromCustomPack(file: File) {
  showNotification({
    id: `importing-${file.name}`,
    title: `Importing custom pack "${file.name}"`,
    message: 'Please wait...',
    autoClose: false,
    withCloseButton: false,
    loading: true,
  });

  const contents = await getFileContents(file);
  let content = null;
  try {
    content = JSON.parse(contents);
  } catch (e) {
    hideNotification(`importing-${file.name}`);
    showNotification({
      title: 'Import failed',
      message: 'Invalid JSON file',
      color: 'red',
      icon: null,
      autoClose: false,
    });
    return;
  }

  const result = await processCustomPack(content);

  hideNotification(`importing-${file.name}`);

  return result;
}

async function processCustomPack(data: Record<string, any>): Promise<ContentSource | null> {
  console.log(data);

  // The original Pathbuilder Custom Pack format ships HTML descriptions
  // (rich-text from the Pathbuilder web editor). The app's content
  // rendering pipeline expects markdown, so the importer historically
  // ran every description through `toMarkdown` (Turndown HTML→md).
  //
  // Hand-authored packs (like the Battlezoo bundle) already write
  // descriptions in markdown. Passing already-markdown text through
  // Turndown ESCAPES the `*` characters, so the final stored text reads
  // as literal "\\*\\*Type\\*\\* Weapon" and the renderer shows the
  // asterisks instead of bolding the words. The pack opts out of that
  // conversion by setting `descriptionsAreMarkdown: true`.
  const rawMd: boolean = data.descriptionsAreMarkdown === true;
  const md = (s: any): string => rawMd ? (s ?? '') : (toMarkdown(s ?? '') ?? '');

  const source = await upsertContentSource({
    id: -1,
    created_at: '',
    user_id: '',
    name: data.customPackName,
    foundry_id: null,
    url: data.customPackUrl ?? '',
    // The format originally had no source description. We now honor
    // `customPackDescription` so packs can carry their variant rules /
    // overview text along with the content.
    description: md(data.customPackDescription),
    operations: [],
    contact_info: data.customPackContactInfo ?? '',
    group: data.customPackGroup ?? '',
    require_key: false,
    keys: null,
    is_published: false,
    deprecated: false,
    artwork_url: '',
    required_content_sources: [],
    meta_data: {},
  } satisfies ContentSource);
  if (!source) return null;

  // Define default sources
  const sources = await fetchContentSources('ALL-OFFICIAL-PUBLIC');
  defineDefaultSources('PAGE', [...sources.map((s) => s.id), source.id]);

  // Importing data
  const traitMap = new Map<string, number>();

  // Custom traits — created first so feats / items / spells declared
  // later in the same pack can reference them by name. Existing trait
  // names short-circuit (we don't shadow Paizo's "Magical" with a
  // homebrew duplicate).
  if (Array.isArray(data.listCustomTraits)) {
    const existing = await fetchContentAll<Trait>('trait', 'ALL-OFFICIAL-PUBLIC');
    for (const t of data.listCustomTraits) {
      if (!t || !t.name) continue;
      const dup = existing.find((e) => e.name.toLowerCase() === String(t.name).toLowerCase());
      if (dup) {
        traitMap.set(t.name, dup.id);
        continue;
      }
      const created = await upsertTrait({
        id: -1,
        created_at: '',
        name: t.name,
        description: md(t.description),
        meta_data: t.meta_data ?? null,
        content_source_id: source.id,
      } satisfies Trait);
      if (created) traitMap.set(t.name, created.id);
    }
  }

  for (const _class of data.listCustomClasses ?? []) {
    const resultClass = await upsertClass({
      id: -1,
      created_at: '',
      name: _class.name,
      rarity: 'COMMON',
      description: md(_class.description),
      operations: [],
      skill_training_base: _class.numSkills,
      trait_id: -1,
      artwork_url: '',
      deprecated: false,
      content_source_id: source.id,
      version: '1.0',
    } satisfies Class);
    if (!resultClass) continue;

    // Add to trait map
    for (const mapKey of _class.listAdditionalFeatReferences) {
      traitMap.set(mapKey, resultClass.trait_id);
    }

    // Add class feats
    for (const fLvl of _class.classFeatLevels ?? []) {
      await upsertAbilityBlock({
        id: -1,
        created_at: '',
        operations: [
          {
            id: `2029b9c0-56fb-457a-8f95-f3ef4c8aa5a8-${fLvl}-${resultClass.id}`,
            type: 'select',
            data: {
              title: 'Select a Feat',
              modeType: 'FILTERED',
              optionType: 'ABILITY_BLOCK',
              optionsPredefined: [],
              optionsFilters: {
                id: `aafea893-4dfd-4ec6-9d6d-04ecf8845c47-${fLvl}-${resultClass.id}`,
                type: 'ABILITY_BLOCK',
                level: {
                  max: fLvl,
                },
                traits: [resultClass.name],
                abilityBlockType: 'feat',
              },
            },
          },
        ],
        name: `${resultClass.name} Feat`,
        actions: null,
        level: fLvl,
        rarity: 'COMMON',
        prerequisites: [],
        description: `You gain a ${resultClass.name.toLowerCase()} class feat.`,
        type: 'class-feature',
        traits: [resultClass.trait_id],
        frequency: null,
        cost: null,
        trigger: null,
        requirements: null,
        access: null,
        special: null,
        meta_data: null,
        version: '1.0',
        content_source_id: source.id,
      } satisfies AbilityBlock);
    }

    // Add skill feats
    for (const fLvl of _class.skillFeatLevels ?? []) {
      await upsertAbilityBlock({
        id: -1,
        created_at: '',
        operations: [
          {
            id: `08b3cdf4-d894-465f-aa0f-94af0010b7be-${fLvl}-${resultClass.id}`,
            type: 'select',
            data: {
              title: 'Select a Feat',
              modeType: 'FILTERED',
              optionType: 'ABILITY_BLOCK',
              optionsPredefined: [],
              optionsFilters: {
                id: `7c6f4e2f-607b-4890-a99b-48721106d0c2-${fLvl}-${resultClass.id}`,
                type: 'ABILITY_BLOCK',
                level: {
                  max: fLvl,
                },
                traits: ['Skill'],
                abilityBlockType: 'feat',
              },
            },
          },
        ],
        name: `Skill Feat`,
        actions: null,
        level: fLvl,
        rarity: 'COMMON',
        prerequisites: [],
        description: `You gain a skill feat. You must be trained or better in the corresponding skill to select a skill feat.`,
        type: 'class-feature',
        traits: [resultClass.trait_id],
        frequency: null,
        cost: null,
        trigger: null,
        requirements: null,
        access: null,
        special: null,
        meta_data: null,
        version: '1.0',
        content_source_id: source.id,
      } satisfies AbilityBlock);
    }

    // Add general feats
    for (const fLvl of [3, 7, 11, 15, 19]) {
      await upsertAbilityBlock({
        id: -1,
        created_at: '',
        operations: [
          {
            id: `262b4e1b-9173-49f1-b6ea-c82dd4ee3bdb-${fLvl}-${resultClass.id}`,
            type: 'select',
            data: {
              title: 'Select a Feat',
              modeType: 'FILTERED',
              optionType: 'ABILITY_BLOCK',
              optionsPredefined: [],
              optionsFilters: {
                id: `5176c508-4c33-46b2-8049-3e88647672aa-${fLvl}-${resultClass.id}`,
                type: 'ABILITY_BLOCK',
                level: {
                  max: fLvl,
                },
                traits: ['General'],
                abilityBlockType: 'feat',
              },
            },
          },
        ],
        name: `General Feat`,
        actions: null,
        level: fLvl,
        rarity: 'COMMON',
        prerequisites: [],
        description: `You gain a general feat.`,
        type: 'class-feature',
        traits: [resultClass.trait_id],
        frequency: null,
        cost: null,
        trigger: null,
        requirements: null,
        access: null,
        special: null,
        meta_data: null,
        version: '1.0',
        content_source_id: source.id,
      } satisfies AbilityBlock);
    }

    // Add skill increases
    for (const fLvl of _class.skillIncreaseLevels ?? []) {
      await upsertAbilityBlock({
        id: -1,
        created_at: '',
        operations: [
          {
            id: `df3d5887-e83c-4bb7-9a30-b6892494b45c-${fLvl}-${resultClass.id}`,
            type: 'select',
            data: {
              title: 'Select a Skill to Increase',
              modeType: 'FILTERED',
              optionType: 'ADJ_VALUE',
              optionsPredefined: [],
              optionsFilters: {
                id: `42c9565e-6f57-493b-ae7d-fcc113e878da-${fLvl}-${resultClass.id}`,
                type: 'ADJ_VALUE',
                group: 'SKILL',
                value: {
                  value: '1',
                },
              },
            },
          },
        ],
        name: `Skill Increase`,
        actions: null,
        level: fLvl,
        rarity: 'COMMON',
        prerequisites: [],
        description: `You gain a skill increase.`,
        type: 'class-feature',
        traits: [resultClass.trait_id],
        frequency: null,
        cost: null,
        trigger: null,
        requirements: null,
        access: null,
        special: null,
        meta_data: null,
        version: '1.0',
        content_source_id: source.id,
      } satisfies AbilityBlock);
    }

    // Add other class features
    for (const other of _class.listCustomSpecials ?? []) {
      await upsertAbilityBlock({
        id: -1,
        created_at: '',
        operations: [],
        name: other.name,
        actions: null,
        level: other.level ?? 1,
        rarity: 'COMMON',
        prerequisites: [],
        description: md(other.description),
        type: 'class-feature',
        traits: [resultClass.trait_id, ...(await findTraits(other.traits, traitMap))],
        frequency: null,
        cost: null,
        trigger: null,
        requirements: null,
        access: null,
        special: null,
        meta_data: null,
        version: '1.0',
        content_source_id: source.id,
      } satisfies AbilityBlock);
    }
  }

  for (const feat of data.listCustomFeats ?? []) {
    const descValues = extractFromDescription(feat.textDescription, rawMd);
    // Allow the pack to override the default ability-block type. This is
    // how a pack ships *activities* (type: 'action') alongside actual
    // feats — same import list, the entry decides what it is.
    const abType = (feat.type ?? 'feat') as AbilityBlock['type'];
    await upsertAbilityBlock({
      id: -1,
      created_at: '',
      operations: feat.operations ?? [],
      name: feat.name,
      actions: convertActions(feat.action),
      level: feat.level ?? 1,
      rarity: 'COMMON',
      prerequisites: descValues.prerequisites?.split(/[;,]/g)?.map((p) => p.trim()) ?? [],
      frequency: descValues.frequency,
      cost: descValues.cost,
      trigger: descValues.trigger,
      requirements: descValues.requirements,
      access: descValues.access,
      description: descValues.description,
      special: descValues.special,
      type: abType,
      traits: await findTraits(feat.traits, traitMap),
      meta_data: feat.meta_data ?? null,
      version: '1.0',
      content_source_id: source.id,
    } satisfies AbilityBlock);
  }

  for (const spell of data.listCustomSpells ?? []) {
    const descValues = extractFromDescription(spell.descriptionHeightened, rawMd);
    await upsertSpell({
      id: -1,
      created_at: '',
      name: spell.name,
      rank: spell.level,
      traditions: [],
      rarity: 'COMMON',
      cast: convertActions(spell.actions),
      traits: await findTraits(spell.traits, traitMap),
      defense: descValues.defense,
      cost: descValues.cost,
      trigger: descValues.trigger,
      requirements: descValues.requirements,
      range: descValues.range,
      area: descValues.area,
      targets: descValues.targets,
      duration: descValues.duration,
      description: descValues.description,
      heightened: null,
      availability: null,
      meta_data: {
        focus: spell.type === 'Focus',
      },
      content_source_id: source.id,
      version: '1.0',
    } satisfies Spell);
  }

  // Custom items. Useful for homebrew bundles that ship runes / imbued
  // properties / consumables / specific items. Fields map 1:1 to the
  // Item schema; everything is optional except `name`.
  for (const item of data.listCustomItems ?? []) {
    if (!item || !item.name) continue;
    const descValues = extractFromDescription(item.textDescription, rawMd);
    const price = (() => {
      const p = item.price;
      if (!p) return null;
      if (typeof p === 'number') return { gp: p };
      if (typeof p === 'object') return p;
      return null;
    })();
    await upsertItem({
      id: -1,
      created_at: '',
      name: item.name,
      price: price as Item['price'],
      bulk: item.bulk ?? null,
      level: item.level ?? 0,
      rarity: (item.rarity ?? 'COMMON') as Rarity,
      availability: (item.availability ?? null) as Availability | null,
      traits: await findTraits(item.traits, traitMap),
      description: descValues.description || md(item.textDescription),
      group: (item.group ?? 'GENERAL') as ItemGroup,
      hands: item.hands ?? null,
      size: (item.size ?? 'MEDIUM') as Size,
      craft_requirements: descValues.craft_requirements ?? item.craft_requirements ?? null,
      usage: item.usage ?? null,
      meta_data: item.meta_data ?? null,
      operations: item.operations ?? null,
      content_source_id: source.id,
      version: '1.0',
    } satisfies Item);
  }

  return source;
}

function convertActions(actions?: number): ActionCost {
  if (actions === 1) return 'ONE-ACTION';
  if (actions === 2) return 'TWO-ACTIONS';
  if (actions === 3) return 'THREE-ACTIONS';
  if (actions === 0) return 'REACTION';
  if (actions === -1) return 'FREE-ACTION';
  return null;
}

async function findTraits(input: string | undefined, traitMap: Map<string, number>) {
  if (!input) return [];
  const traits = await fetchContentAll<Trait>('trait', 'ALL-OFFICIAL-PUBLIC');

  const output: number[] = [];
  for (const trait of input.split(/,/g)) {
    // Check trait map
    const foundId = traitMap.get(trait.trim());
    if (foundId) {
      output.push(foundId);
      continue;
    }

    // Search all traits
    const found = traits.find((t) => t.name === trait.trim());
    if (found) output.push(found.id);
  }
  return output;
}

function extractFromDescription(input?: string, rawMarkdown = false): Record<string, string> {
  // When the pack opts into `descriptionsAreMarkdown: true`, treat the
  // input as already-markdown and skip Turndown. Otherwise (Pathbuilder
  // HTML imports), convert HTML→markdown first.
  const desc = rawMarkdown ? (input ?? '') : (toMarkdown(input ?? '') ?? '');

  const pattern =
    /(\*\*(Prerequisites|Trigger|Frequency|Requirements|Range|Area|Targets|Defense|Duration|Access|Cost|Area|Craft Requirements|Special)\s*\*\*([^*\n]+))([^*]+)/gm;

  const output: Record<string, string> = {};
  let resultDesc = desc;
  let match;
  while ((match = pattern.exec(desc)) !== null) {
    const label = match[2].toLowerCase().replace(/\s/g, '_');
    const text = match[3].trim();
    output[label] = text;
    resultDesc = resultDesc.replace(match[1], '').trim();
  }

  return {
    description: resultDesc,
    ...output,
  };
}
