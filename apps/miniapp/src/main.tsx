import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app.js';
import { CustomEmojiLibraryProvider } from './components/custom-emoji-library.js';
import { initializeTelegram, trackViewportHeight } from './telegram.js';
import './styles.css';

initializeTelegram();
trackViewportHeight();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CustomEmojiLibraryProvider>
        <App />
      </CustomEmojiLibraryProvider>
    </QueryClientProvider>
  </StrictMode>,
);
