import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AI_MODEL_LIST_STORAGE_KEY,
  clearAiModelList,
  readAiModelList,
  writeAiModelList,
} from '@/lib/ai-model-list'

let savedLS: Storage | undefined

function installStorage(store: Map<string, string>): void {
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    length: store.size,
  } as unknown as Storage
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = mock
}
function removeStorage(): void {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage
}

beforeEach(() => {
  savedLS = (globalThis as unknown as { localStorage?: Storage }).localStorage
  removeStorage()
})
afterEach(() => {
  const g = globalThis as unknown as { localStorage?: Storage }
  if (savedLS === undefined) delete g.localStorage
  else g.localStorage = savedLS
})

describe('writeAiModelList', () => {
  it('stores the list under the readgraph:ai-model-list key', () => {
    const store = new Map<string, string>()
    installStorage(store)
    writeAiModelList(['gpt-4o', 'gpt-4o-mini'])
    expect(store.get(AI_MODEL_LIST_STORAGE_KEY)).toBe('["gpt-4o","gpt-4o-mini"]')
  })
})

describe('readAiModelList', () => {
  it('returns [] when nothing is stored', () => {
    installStorage(new Map())
    expect(readAiModelList()).toEqual([])
  })

  it('round-trips a stored list', () => {
    installStorage(new Map([[AI_MODEL_LIST_STORAGE_KEY, '["gpt-4o","claude-3.5"]']]))
    expect(readAiModelList()).toEqual(['gpt-4o', 'claude-3.5'])
  })

  it('returns [] on corrupt JSON', () => {
    installStorage(new Map([[AI_MODEL_LIST_STORAGE_KEY, '{not json']]))
    expect(readAiModelList()).toEqual([])
  })

  it('returns [] when stored value is not an array', () => {
    installStorage(new Map([[AI_MODEL_LIST_STORAGE_KEY, '"gpt-4o"']]))
    expect(readAiModelList()).toEqual([])
  })

  it('filters out non-string elements, keeps valid strings', () => {
    installStorage(new Map([[AI_MODEL_LIST_STORAGE_KEY, '["gpt-4o",7,{"id":"x"},null]']]))
    expect(readAiModelList()).toEqual(['gpt-4o'])
  })
})

describe('clearAiModelList', () => {
  it('removes only the model-list key', () => {
    const store = new Map<string, string>([
      [AI_MODEL_LIST_STORAGE_KEY, '["gpt-4o"]'],
      ['readgraph:preferences', '{"theme":"dark"}'],
    ])
    installStorage(store)
    clearAiModelList()
    expect(store.get(AI_MODEL_LIST_STORAGE_KEY)).toBeUndefined()
    expect(store.get('readgraph:preferences')).toBe('{"theme":"dark"}')
  })
})
