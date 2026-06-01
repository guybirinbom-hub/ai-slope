import { setPageTitle } from '@utils/document-change';
import { useEffect } from 'react';

export function Component() {
  setPageTitle(`Redirecting...`);

  useEffect(() => {
    window.location.href = window.location.href.replace(/^https?:\/\//, 'https://legacy.');
  }, []);

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
