import { makeRequest } from '@requests/request-manager';
import { setPageTitle } from '@utils/document-change';
import { useEffect, useRef } from 'react';
import { useLoaderData, useLocation, useSearchParams } from 'react-router-dom';

export function Component() {
  setPageTitle(`Redirecting...`);

  const { gmUserId } = useLoaderData() as {
    gmUserId: string;
  };
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const handling = useRef(false);

  useEffect(() => {
    const codeValue = searchParams.get('code');
    if (!codeValue) return;
    setTimeout(async () => {
      if (handling.current) return;
      handling.current = true;
      const responseContent = await makeRequest('gm-add-to-group', {
        gm_user_id: gmUserId,
        access_code: codeValue,
      });
      if (responseContent) {
        window.location.href = '/account';
      }
    }, 100);
  }, [location]);

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
