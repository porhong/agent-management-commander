import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

async function start() {
  // UI-only development runs against fixture data (T1.5.7).
  if (import.meta.env.VITE_AMC_MOCK === '1') {
    const { installMockApi } = await import('./mocks/amc-mock');
    installMockApi();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
