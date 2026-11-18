import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { consumeLoginFragment } from './api.ts'

consumeLoginFragment()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Cache only versioned static assets; personal API responses remain network-only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then((registration) => {
    window.addEventListener('focus', () => void registration.update())
  }).catch(() => {})
}
