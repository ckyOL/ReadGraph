// 阅读画像大数据聚合 Worker（reading-profile §1/§5）。
//
// Comlink 包装：主线程通过 `Comlink.wrap(worker)` 拿到 `StatsWorkerApi`，
// 调用 `api.compute(input, opts)` 在 Worker 内跑纯函数 `computeProfileStats`。
// 纯函数契约不变——不在 `computeProfileStats` 内放时钟/存储读/外部状态；
// 仅把同步重算下放到 Worker，避免大数据下阻塞主线程。
import * as Comlink from 'comlink'

import { computeProfileStats } from '@/lib/profile-stats'
import type {
  ProfileStatsInput,
  ProfileStatsOptions,
  ProfileStatsResult,
} from '@/lib/profile-stats'

const statsWorkerApi = {
  /** 纯函数代理：入参实体 + opts，返回聚合结果（与主线程直调深等价）。 */
  compute(input: ProfileStatsInput, opts: ProfileStatsOptions): ProfileStatsResult {
    return computeProfileStats(input, opts)
  },
}

export type StatsWorkerApi = typeof statsWorkerApi

// 仅在 Worker 上下文暴露；非 Worker 环境（如被测试误 import）下不注册消息监听。
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  Comlink.expose(statsWorkerApi)
}
