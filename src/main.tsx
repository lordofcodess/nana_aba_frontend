import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './AuthContext.tsx'
import Maintenance from './Maintenance.tsx'
import './Maintenance.css'

// While true, every visitor sees the maintenance notice instead of the app.
const MAINTENANCE_MODE = true

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {MAINTENANCE_MODE ? (
      <Maintenance />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
)
