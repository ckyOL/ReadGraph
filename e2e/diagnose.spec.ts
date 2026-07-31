import { test, expect } from '@playwright/test'
import { buildDesensitizedFixture } from './fixtures'
const SEED_KEY = 'readgraph:e2e-seed'
test('diag', async ({ page }) => {
  const logs: string[] = []
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`PAGEERROR: ${err.message}`))
  const base = buildDesensitizedFixture()
  const bigBooks: typeof base.books = []
  const bigCats: typeof base.catalogRecords = []
  const bigCycles: typeof base.borrowCycles = []
  for (let i = 0; i < 150; i++) {
    const bid = `big-${i}`
    bigBooks.push({ ...base.books[0], id: bid, isbn13: `9789${String(i).padStart(9,'0')}`, title: `书${i}`, sourceIds: [base.sources[0].id] })
    bigCats.push({ ...base.catalogRecords[0], id: `cat-big-${i}`, bookId: bid, barcodes: [`BB${i}`] })
    bigCycles.push({ ...base.borrowCycles[0], id: `c-big-${i}`, bookId: bid, catalogRecordId: `cat-big-${i}`, barcode: `BB${i}`, borrowedAt: new Date(Date.UTC(2024,0,1)+i*86400000).toISOString(), returnedAt: new Date(Date.UTC(2024,0,8)+i*86400000).toISOString(), status: 'returned' })
    bigCycles.push({ ...base.borrowCycles[0], id: `c-big2-${i}`, bookId: bid, catalogRecordId: `cat-big-${i}`, barcode: `BB${i}`, borrowedAt: new Date(Date.UTC(2024,1,1)+i*86400000).toISOString(), returnedAt: null, status: 'borrowed' })
  }
  const payload = JSON.stringify({ sources: base.sources, books: [...base.books, ...bigBooks], catalogRecords: [...base.catalogRecords, ...bigCats], borrowCycles: [...base.borrowCycles, ...bigCycles] })
  await page.addInitScript(([k,v]) => localStorage.setItem(k,v), [SEED_KEY, payload] as const)
  await page.goto('/profile')
  await page.waitForTimeout(3000)
  const counts = await page.evaluate(async () => {
    const req = indexedDB.open('readgraph')
    return await new Promise<Record<string,number>>((resolve) => {
      req.onsuccess = () => {
        const db = req.result
        const out: Record<string,number> = {}
        const stores = Array.from(db.objectStoreNames)
        let done = 0
        for (const s of stores) {
          const tx = db.transaction(s,'readonly')
          const r = tx.objectStore(s).count()
          r.onsuccess = () => { out[s]=r.result; done++; if(done===stores.length) resolve(out) }
        }
      }
    })
  })
  console.log('IDB:', JSON.stringify(counts))
  console.log('Logs:', logs.join('\n'))
})
