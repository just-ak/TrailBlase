import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container missing from index.html');
}

// StrictMode is kept on deliberately: it double-invokes effects in development,
// which is exactly the condition that would expose a duplicated Leaflet map
// instance. See useLeafletMap.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
