// Vendored from geronimi73/re-use-demo at commit 0d54dca074597b111a8e8c78f6067a6fa0231f75.
// MIT License. See resources/licenses/reuse-webgpu-engine-LICENSE.txt.

// Checks that this browser and GPU can run the model, before anything is downloaded.

// Workgroup memory the largest kernel needs (GEMM tiles)
export const NEEDED_WORKGROUP_STORAGE = 32768;

export const GPU_ERRORS = {
  "no-api": "Your browser does not support WebGPU. Try a recent Chrome, Edge or Safari.",
  "no-adapter": "WebGPU is turned off for this device's GPU, so this demo can't run here. Try a laptop or desktop with a recent Chrome, Edge or Safari.",
  "limits": "This device's GPU is too limited for this model. Try a laptop or desktop with a recent Chrome, Edge or Safari.",
};

export async function findAdapter() {
  if (typeof navigator === "undefined" || !navigator.gpu) return { reason: "no-api" };
  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    adapter ??= await navigator.gpu.requestAdapter();
  } catch { /* treated as no adapter */ }
  if (!adapter) return { reason: "no-adapter" };
  if (adapter.limits.maxComputeWorkgroupStorageSize < NEEDED_WORKGROUP_STORAGE) return { reason: "limits" };
  return { adapter };
}
