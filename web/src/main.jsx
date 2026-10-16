import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { UiProvider } from './components/ui.jsx';

createRoot(document.getElementById('root')).render(
  <UiProvider>
    <App />
  </UiProvider>
);
