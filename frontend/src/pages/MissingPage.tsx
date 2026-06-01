import { setPageTitle } from '@utils/document-change';
import { useNavigate } from 'react-router-dom';

export function Component() {
  setPageTitle(`Error 404`);

  const navigate = useNavigate();

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
        <div className='big'>404</div>
        <div className='ttl'>This page wandered off the map.</div>
        <p>
          You may have mistyped the address, or the page has been moved to another URL.
        </p>
        <button
          className='btn'
          onClick={() => {
            navigate('/');
          }}
        >
          Go to home page
        </button>
      </div>
    </div>
  );
}
