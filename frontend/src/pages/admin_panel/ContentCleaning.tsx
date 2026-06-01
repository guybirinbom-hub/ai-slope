// import { runItemAgent } from '@ai/agent/manager';
import { Center, Group, Title, Textarea, Button, Stack } from '@mantine/core';

const ENABLED = true;

export default function ContentCleaning() {
  if (!ENABLED) null;

  return (
    <>
      <div className='card' style={{ padding: 12 }}>
        <Center p='sm'>
          <Stack>
            <Group>
              <Title order={3}>Content Cleaning</Title>
              <Button
                size='compact-sm'
                onClick={async () => {
                  window.location.href = '/content-cleaning-source';
                }}
              >
                Open
              </Button>
            </Group>
          </Stack>
        </Center>
      </div>
    </>
  );
}
