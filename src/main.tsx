import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { maybeSeedFromE2E } from './db/e2e-seed'

void maybeSeedFromE2E()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
