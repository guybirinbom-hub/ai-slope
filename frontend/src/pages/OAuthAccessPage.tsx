import { useState } from 'react';
import { setPageTitle } from '@utils/document-change';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { makeRequest } from '@requests/request-manager';
import { Character, PublicUser } from '@schemas/content';
import { useQuery } from '@tanstack/react-query';
import { DisplayIcon } from '@common/IconDisplay';
import { IconCheck, IconDots } from '@tabler/icons-react';
import { uniqWith } from 'lodash-es';

export function Component() {
  setPageTitle('Access Character');

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const characterId = searchParams.get('character_id');
  const userId = searchParams.get('user_id');
  const clientId = searchParams.get('client_id');

  const [loadingAuth, setLoadingAuth] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: [`find-oauth-data`, characterId, userId, clientId],
    queryFn: async () => {
      const character = await makeRequest<Character>('find-character', {
        id: characterId,
      });

      const clientUser = await makeRequest<PublicUser>('get-user', {
        _id: userId,
      });
      const client = clientUser?.api?.clients?.find((c) => c.id === clientId);

      return {
        character,
        client,
      };
    },
    enabled: !!characterId && !!userId && !!clientId,
    refetchOnWindowFocus: false,
  });

  if (!data || isFetching) {
    return (
      <div
        className='wg4 wg4-screen wg4-page-root'
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100dvh',
        }}
      >
        <div className='wg4-bars'>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div className='muted' style={{ fontStyle: 'italic' }}>
          Taking you there…
        </div>
      </div>
    );
  }

  const getOAuthSection = () => {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 }}>
          <DisplayIcon strValue={data?.client?.image_url} radius={500} />
          <IconDots style={{ color: 'var(--ink-4)' }} stroke={1.5} />
          <DisplayIcon strValue={data?.character?.details?.image_url ?? 'icon|||avatar|||#868e96'} radius={500} />
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 24, marginBottom: 4 }}>
          {data?.client?.name}
        </div>
        <p className='muted' style={{ margin: '0 0 4px' }}>
          wants to access your character
        </p>
        <p style={{ fontWeight: 'bold', fontStyle: 'italic', margin: '0 0 16px' }}>{data?.character?.name}</p>
        <div className='statbox' style={{ textAlign: 'left', marginBottom: 20 }}>
          <div className='k' style={{ marginBottom: 6 }}>
            This will allow the external service to
          </div>
          <div className='v' style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconCheck size={16} style={{ color: 'var(--accent)', flex: '0 0 auto' }} />
            Access your character information
          </div>
          <div className='v' style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconCheck size={16} style={{ color: 'var(--accent)', flex: '0 0 auto' }} />
            Edit your character's stats
          </div>
          <div className='v' style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconCheck size={16} style={{ color: 'var(--accent)', flex: '0 0 auto' }} />
            Manage your character's inventory
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            className='btn ghost'
            onClick={() => {
              navigate('/characters');
            }}
          >
            Cancel
          </button>
          <button
            className='btn'
            disabled={loadingAuth}
            onClick={async () => {
              setLoadingAuth(true);
              await makeRequest('update-character', {
                id: characterId,
                details: {
                  ...(data.character?.details ?? {}),
                  api_clients: {
                    ...(data.character?.details?.api_clients ?? {}),
                    client_access: uniqWith(
                      [
                        ...(data.character?.details?.api_clients?.client_access ?? []),
                        {
                          publicUserId: userId ?? '',
                          clientId: clientId ?? '',
                          addedAt: new Date().getTime(),
                        },
                      ],
                      (a, b) => a.clientId === b.clientId && a.publicUserId === b.publicUserId
                    ),
                  },
                },
              });
              // Drop any pending autosave for this character. If the user was on the
              // builder before getting the OAuth link, useAutoSave saved their
              // pre-grant character to localStorage on the way out. Without this,
              // useCharacter would replay that stale snapshot on the next load and
              // overwrite the grant we just persisted.
              if (characterId) {
                localStorage.removeItem(`autosave-character-${characterId}`);
              }
              navigate(`/builder/${characterId}`);
            }}
          >
            Authorize
          </button>
        </div>
      </>
    );
  };

  const getCharacterNotFoundSection = () => {
    return (
      <>
        <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 24, marginBottom: 8 }}>
          Not Found
        </div>
        <p className='muted' style={{ margin: '0 0 4px' }}>
          Could not find the requested character (ID# {characterId}).
        </p>
        <p className='muted' style={{ margin: 0 }}>
          This account must be the owner of the character to authorize access.
        </p>
      </>
    );
  };

  return (
    <div
      className='wg4 wg4-screen wg4-page-root'
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
      }}
    >
      <div className='card' style={{ width: 380, maxWidth: '90%', padding: 30, textAlign: 'center' }}>
        {data?.character ? getOAuthSection() : getCharacterNotFoundSection()}
      </div>
    </div>
  );
}
