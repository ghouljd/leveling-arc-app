import React from 'react';
import {createRoot} from 'react-dom/client';
import {AuthGate} from './AuthGate';
import {App} from './App';
import {startPWA} from './pwa';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><React.Suspense fallback={<main><p role="status">Abriendo sección…</p></main>}><App/></React.Suspense></AuthGate></React.StrictMode>);
void startPWA();
