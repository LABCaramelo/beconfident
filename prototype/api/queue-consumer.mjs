import { getRuntime, queue } from '../cloud/runtime.mjs';
export default queue.handleNodeCallback(async () => {
  try {
    const result = await getRuntime().bridge.drain();
    if (result.pending) throw new Error('pending_work');
  } catch {
    // SDK errors may include provider URLs; expose only a fixed error code.
    throw new Error('queue_processing_incomplete');
  }
}, { visibilityTimeoutSeconds: 180, retry: (_error, metadata) => ({ afterSeconds: Math.min(300, 10 * 2 ** Math.min(metadata.deliveryCount, 5)) }) });
