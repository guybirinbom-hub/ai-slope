import { setPageTitle } from '@utils/document-change';
import { useNavigate } from 'react-router-dom';

export function Component() {
  setPageTitle(`Error 401`);

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
        <div className='big'>401</div>
        <div className='ttl'>This sheet isn't shared with you.</div>
        <p>
          This character sheet is private. To view it, you need one of the following:
        </p>
        <p className='muted' style={{ fontStyle: 'italic' }}>
          • Have the sheet be publicly accessible •
          <br />• Be the owner of a campaign the character is in •
          <br />• Be the owner of the character •
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
