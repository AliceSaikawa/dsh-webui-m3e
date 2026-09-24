import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { bootDsh } from './dsh/boot.ts'

const element = document.getElementById('app')!

bootDsh().then(
  (ctx) =>
    createRoot(element).render(
      <StrictMode>
        <App ctx={ctx} />
      </StrictMode>,
    ),
  (error: unknown) => {
    console.error(error)
    element.textContent = `起動に失敗しました: ${error instanceof Error ? error.message : String(error)}`
  },
)
