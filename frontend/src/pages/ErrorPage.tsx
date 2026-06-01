import { setPageTitle } from '@utils/document-change';
import { IconBrandGithub } from '@tabler/icons-react';
import { useRouteError } from 'react-router-dom';

export function ErrorPage() {
  setPageTitle(`Error 500`);

  const error = useRouteError() as any;
  console.error(error);

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
      <div className='hero'>
        <div className='big'>500</div>
        <div className='ttl'>We just rolled a Nat 1...</div>
        <p>
          Our servers could not handle your request. Please submit an issue on our GitHub repository and refresh the
          page.
        </p>
        <div
          className='card'
          style={{
            maxWidth: 440,
            margin: '0 auto 18px',
            padding: '12px 14px',
            maxHeight: 120,
            overflowY: 'auto',
            textAlign: 'left',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error?.stack || String(error)}
        </div>
        <a
          className='btn'
          href='https://github.com/wanderers-guide/wanderers-guide/issues'
          target='_blank'
          rel='noreferrer'
        >
          <IconBrandGithub size='1.1rem' />
          GitHub Issues
        </a>
      </div>
    </div>
  );
}
