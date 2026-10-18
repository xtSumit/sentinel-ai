import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress expected Vite HMR WebSocket rejections in AI Studio preview runtime
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason?.message || '';
    const stack = event.reason?.stack || '';
    if (msg.includes('WebSocket') || stack.includes('@vite/client')) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
