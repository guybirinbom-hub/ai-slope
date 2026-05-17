import { drawerState } from '@atoms/navAtoms';
import { SpellSelectionOption } from '@common/select/SelectContent';
import { Box, Menu, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconStarFilled, IconStarOff, IconStar } from '@tabler/icons-react';
import { StatButton } from '@pages/character_builder/CharBuilderCreation';
import { isCantrip, isRitual } from '@spells/spell-utils';
import { LivingEntity, Spell } from '@schemas/content';
import { StoreID } from '@schemas/variables';
import { useAtom } from 'jotai';

export default function SpellListEntrySection(props: {
  id: StoreID;
  entity: LivingEntity | null;
  //
  spell?: Spell;
  exhausted: boolean;
  tradition: string;
  attribute: string;
  onCastSpell: (cast: boolean) => void;
  onOpenManageSpells?: () => void;
  hasFilters: boolean;
  leftSection?: React.ReactNode;
  prefix?: React.ReactNode;
  // Signature-spell hooks. Optional so prepared/innate/focus/ritual
  // lists (which don't have the signature mechanic) can omit them
  // without renumbering anything. `canMarkSignature` gates the right-
  // click menu — only spontaneous casters should see it.
  isSignature?: boolean;
  canMarkSignature?: boolean;
  onToggleSignature?: () => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const exhausted = props.spell && isCantrip(props.spell) ? false : props.exhausted;
  // Right-click menu for signature toggle. We control opened state so we
  // can pop it on contextmenu (Mantine's Menu has no built-in right-click
  // trigger). `closeMenu` is also called from the menu item onClick so
  // the dropdown dismisses after the user picks an action.
  const [menuOpened, { open: openMenu, close: closeMenu }] = useDisclosure(false);

  if (props.spell) {
    const openCastDrawer = () => {
      if (!props.spell) return;

      if (isRitual(props.spell)) {
        openDrawer({
          type: 'spell',
          data: {
            id: props.spell.id,
            spell: props.spell,
            entity: props.entity,
          },
          extra: { addToHistory: true },
        });
        return;
      }

      openDrawer({
        type: 'cast-spell',
        data: {
          id: props.spell.id,
          spell: props.spell,
          exhausted: exhausted,
          tradition: props.tradition,
          attribute: props.attribute,
          onCastSpell: (cast: boolean) => {
            props.onCastSpell(cast);
          },
          storeId: props.id,
          entity: props.entity,
        },
        extra: { addToHistory: true },
      });
    };

    // If signature is supported on this caster type, render a star
    // adornment in front of the spell name when the spell is a signature
    // spell. Falls back to whatever the caller passed in `prefix`.
    const prefixWithStar =
      props.canMarkSignature && props.isSignature ? (
        <IconStarFilled size='0.85rem' style={{ color: 'var(--mantine-color-yellow-5)' }} />
      ) : (
        props.prefix
      );

    const row = (
      <StatButton onClick={openCastDrawer}>
        <SpellSelectionOption
          noBackground
          hideRank
          exhausted={exhausted}
          showButton={false}
          spell={props.spell}
          leftSection={props.leftSection}
          px={0}
          prefix={prefixWithStar}
        />
      </StatButton>
    );

    // No right-click menu for prepared/innate/focus/etc. — bail to the
    // plain row. Same for cantrips on spontaneous casters: cantrips auto-
    // heighten in PF2e, so signature is meaningless. Same for rituals.
    if (!props.canMarkSignature || isCantrip(props.spell) || isRitual(props.spell)) {
      return row;
    }

    return (
      <Menu
        opened={menuOpened}
        onClose={closeMenu}
        position='bottom-start'
        shadow='md'
        withinPortal
        width={200}
      >
        <Menu.Target>
          <Box
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openMenu();
            }}
          >
            {row}
          </Box>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={
              props.isSignature ? (
                <IconStarOff size='0.95rem' />
              ) : (
                <IconStar size='0.95rem' />
              )
            }
            onClick={() => {
              props.onToggleSignature?.();
              closeMenu();
            }}
          >
            {props.isSignature ? 'Remove signature' : 'Make signature spell'}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  }

  if (props.hasFilters) {
    return null;
  }

  return (
    <StatButton
      onClick={() => {
        props.onOpenManageSpells?.();
      }}
    >
      <Text fz='xs' fs='italic' c='dimmed' fw={500}>
        No Spell Prepared
      </Text>
    </StatButton>
  );
}
