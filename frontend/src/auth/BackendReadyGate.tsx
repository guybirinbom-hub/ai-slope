// Gates backend-dependent routes on the backend being warmed up.
//
// During parallel-boot, the React shell renders before pg + postgrest are
// ready. Without this gate, useQuery hooks on pages like /characters and
// /homebrew fire immediately, get 503 from the gateway's not-ready guard,
// and either show an empty page or pop "Request Function returned an error"
// toasts. This wrapper holds the user at a polished waiting screen until
// the backend reports ready (typically 1-3 seconds after the window opens).
//
// Once ready, the children mount normally and React Query fires the real
// data fetches against a fully-functional gateway.

import { backendReadyState } from '@atoms/backendAtoms';
import { Box, Center, Loader, Stack, Text } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { type ReactNode } from 'react';

export default function BackendReadyGate(props: { children: ReactNode }) {
  const { ready, error } = useAtomValue(backendReadyState);

  if (ready) return <>{props.children}</>;

  return (
    <Center style={{ width: '100%', minHeight: 'calc(100dvh - 60px)' }}>
      <Stack gap='md' align='center'>
        <Loader size='lg' type='dots' />
        <Box ta='center'>
          <Text c='gray.2' fz='lg' fw={500} mb={4}>
            {error ? "Couldn't start the local backend" : 'Warming up your local database…'}
          </Text>
          <Text c='dimmed' fz='sm'>
            {error
              ? error
              : "First-time start can take 30-60s while we initialize the data. After that, it's much faster."}
          </Text>
        </Box>
      </Stack>
    </Center>
  );
}
