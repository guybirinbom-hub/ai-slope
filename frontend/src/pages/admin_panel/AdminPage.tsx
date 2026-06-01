import { Stack } from '@mantine/core';
import { setPageTitle } from '@utils/document-change';
import EditContent from './EditContent';
import GenerateEmbeddings from './GenerateEmbeddings';
import ImportLegacyContent from './ImportLegacyContent';
import UploadContent from './UploadContent';
import BackgroundFixer from './BackgroundFixer';
import TraitMerger from './TraitMerger';
import ContentUpdateRetrigger from './ContentUpdateRetrigger';
import ContentCleaning from './ContentCleaning';

export function Component() {
  setPageTitle(`Admin Panel`);

  return (
    <div className='wg4 wg4-screen wg4-page-root' style={{ minHeight: '100%', padding: 24 }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <h2
          style={{
            fontFamily: 'var(--wg4-font-serif)',
            fontStyle: 'italic',
            fontSize: 30,
            fontWeight: 500,
            margin: '0 0 4px',
            letterSpacing: '-.01em',
            color: 'var(--wg4-ink)',
          }}
        >
          Admin panel
        </h2>
        <p className='muted' style={{ margin: '0 0 20px', fontSize: 13 }}>
          Content maintenance tooling.
        </p>
        <Stack>
          <GenerateEmbeddings />
          <UploadContent />
          <EditContent />
          <ImportLegacyContent />
          <BackgroundFixer />
          <ContentUpdateRetrigger />
          <TraitMerger />
          <ContentCleaning />
        </Stack>
      </div>
    </div>
  );
}
