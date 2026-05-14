# ComfyUI Workflow Inspector

A small browser-only tool for inspecting ComfyUI and hosted ComfyUI workflow JSON
before turning it into a production API workflow.

It runs locally in the browser. Workflow JSON is not uploaded anywhere.

## What It Finds

- ComfyUI UI exports and prompt API JSON.
- Output-like nodes such as video combine, save image, save audio, and preview nodes.
- Preview-only branches that may not create final downloadable assets.
- Duration, frame, FPS, seed, prompt, and model-related fields.
- A compact repair brief you can paste into a developer handoff.
- A workflow diff page for comparing two JSON files before migrating nodes,
  prompts, timing values, or output paths.
- A RunningHub output retrieval planner for node ids, `/history/{prompt_id}`
  lookup paths, `/view` downloads, and preview-node risks.
- A hosted API parameter mapper for prompt, seed, size, timing, media upload,
  and model fields that should become runtime inputs.
- A custom node dependency scanner for package groups, unknown node classes,
  model files, media references, and host setup risks.
- A ComfyUI API smoke test builder for `/prompt`, `/history/{prompt_id}`,
  `/view`, websocket progress, curl commands, and handoff evidence.
- A workflow repair brief builder that combines workflow JSON, optional failure
  logs, dependencies, parameter mapping, output retrieval, and smoke-test scope.
- A hosted workflow setup quote builder for setup tier, complexity score,
  dependency scope, runtime inputs, final output evidence, and a checkout brief.

## Use It

Open `index.html` directly, or serve the folder with any static file server.

```bash
npm test
npm run check
```

Public hosted version:

<https://mv.786668.xyz/comfyui-workflow-inspector.html?source=github>

GitHub Pages:

<https://william08190.github.io/comfyui-workflow-inspector/>

Workflow diff:

<https://william08190.github.io/comfyui-workflow-inspector/diff.html>

Output retrieval planner:

<https://william08190.github.io/comfyui-workflow-inspector/runninghub.html>

Parameter mapper:

<https://william08190.github.io/comfyui-workflow-inspector/params.html>

Dependency scanner:

<https://william08190.github.io/comfyui-workflow-inspector/dependencies.html>

API smoke test builder:

<https://william08190.github.io/comfyui-workflow-inspector/api.html>

Workflow repair brief builder:

<https://william08190.github.io/comfyui-workflow-inspector/repair.html>

Setup quote builder:

<https://william08190.github.io/comfyui-workflow-inspector/quote.html>

Private setup and workflow repair request:

<https://mv.786668.xyz/service-checkout.html?package=workflow-setup-starter&source=github-inspector>

## Why This Exists

Hosted ComfyUI deployments often fail for practical reasons that are easy to
miss in a visual graph:

- The app reads from a preview node instead of the final output node.
- Duration or FPS is hardcoded in the wrong node.
- Runtime parameters are not connected to cloud workflow inputs.
- Prompt, seed, size, duration, or reference media fields are not exposed as
  hosted API parameters.
- Custom node packs, model files, or media references are missing on the hosted
  ComfyUI machine.
- The workflow queues successfully, but no one records prompt_id, selected
  output node id, history response, download URL, or artifact evidence.
- The workflow has several output-like nodes and the API caller picks the wrong
  artifact.
- The hosted platform returns a task result, but the caller does not map it back
  to the final ComfyUI node id before downloading.
- The user has an error log but no clean, checkout-ready repair brief that
  describes custom nodes, model files, runtime inputs, retrieval evidence, and
  target platform scope.
- The client needs a quick setup tier and quote-ready scope before paying a
  workflow setup deposit.

This tool gives you a quick diagnostic before you pay for hosting, API wiring,
or workflow repair.
