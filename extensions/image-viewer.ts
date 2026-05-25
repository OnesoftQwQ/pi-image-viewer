/**
 * Image Viewer Extension
 * 
 * Allows pure-text models to "see" images by:
 * 1. Intercepting pasted/dragged images and replacing them with ID references
 * 2. Providing an ask_image tool that uses a vision-capable model
 *    (via Pi's ModelRegistry + complete()) to examine images
 * 
 * Smart behavior:
 *   - If the current model supports images natively (input includes "image"),
 *     images pass through untouched — no interception, no tool needed.
 *   - If the current model is pure-text, images are captured and replaced with
 *     [Image: ID = ...] references, and ask_image tool is provided.
 *   - Automatically picks the best available vision model from Pi's registry
 *     when interception is active.
 * 
 * Commands:
 *   /vision-model  - Interactively select which vision model to use
 *   /vision-status - Show current vision model and interception status
 * 
 * Usage:
 *   Paste an image (Ctrl+V or drag & drop), then ask the model about it.
 *   Or use read tool on an image file — the extension captures the image
 *   data and provides ID references for the tool.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { complete } from "@earendil-works/pi-ai";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoredImage {
  id: string;
  data: string;   // base64-encoded image data
  mimeType: string;
}

interface VisionModelRef {
  provider: string;
  modelId: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

const imageStore = new Map<string, StoredImage>();
let nextImageId = 0;
let visionModelRef: VisionModelRef | null = null; // null = auto-detect
let shouldIntercept = true; // set based on current model's capabilities



// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract a comparable version number from a model ID string. */
function extractVersion(modelId: string): number {
  // Match version-like patterns: qwen3.6 → 3.6, kimi-k2.5 → 2.5, mimo-v2.5 → 2.5
  const match = modelId.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  const major = parseInt(match[1], 10) || 0;
  const minor = parseInt(match[2], 10) || 0;
  return major * 1000 + minor;
}

/** Check whether a model natively supports images. */
function modelSupportsImages(model: any): boolean {
  return model?.input?.includes("image") === true;
}

/** Find a vision-capable model from the registry. */
async function findVisionModel(modelRegistry: any, ctxModel: any): Promise<any> {
  // 1. User-specified via /vision-model command
  if (visionModelRef) {
    const m = modelRegistry.find(visionModelRef.provider, visionModelRef.modelId);
    if (m) return m;
  }

  // 2. Current model if it supports images
  if (ctxModel && modelSupportsImages(ctxModel)) {
    return ctxModel;
  }

  // 3. Any vision model from the current provider (same provider = same auth)
  //    Prefer qwen* models, fall back to highest version number
  const currentProvider = ctxModel?.provider;
  if (currentProvider) {
    const sameProviderVision = modelRegistry
      .getAll()
      .filter((m: any) => m.provider === currentProvider && modelSupportsImages(m));

    if (sameProviderVision.length > 0) {
      // Sort: qwen* models first (by version descending), then others by version descending
      const sorted = sameProviderVision.sort((a: any, b: any) => {
        const aIsQwen = a.id.startsWith("qwen");
        const bIsQwen = b.id.startsWith("qwen");
        if (aIsQwen && !bIsQwen) return -1;
        if (!aIsQwen && bIsQwen) return 1;
        // Both qwen or both non-qwen: compare version numbers
        return extractVersion(b.id) - extractVersion(a.id);
      });
      return sorted[0];
    }
  }

  // 4. Any vision model with valid auth (from getAvailable)
  const available = await modelRegistry.getAvailable();
  const visionAvailable = available.filter((m: any) => modelSupportsImages(m));
  if (visionAvailable.length > 0) return visionAvailable[0];

  // 5. Any vision model at all (last resort, may fail auth)
  const anyVision = modelRegistry
    .getAll()
    .find((m: any) => modelSupportsImages(m));
  if (anyVision) return anyVision;

  return null;
}

/** User-visible label for a model. */
function modelLabel(m: any): string {
  return `${m.provider}/${m.id}`;
}

// ─── Vision call ─────────────────────────────────────────────────────────────

async function callVisionModel(
  image: StoredImage,
  prompt: string,
  ctx: any,
  signal?: AbortSignal,
): Promise<string> {
  const modelRegistry = ctx?.modelRegistry;
  if (!modelRegistry) {
    throw new Error("No model registry available.");
  }

  const model = await findVisionModel(modelRegistry, ctx?.model);
  if (!model) {
    throw new Error(
      "No vision-capable model found. " +
      "Use /vision-model to pick one, or switch to a model that supports images.",
    );
  }
  if (!modelSupportsImages(model)) {
    throw new Error(`Model "${modelLabel(model)}" does not support images.`);
  }

  // Get API key from Pi's auth storage
  const authResult = await modelRegistry.getApiKeyAndHeaders(model);
  if (!authResult.ok) {
    throw new Error(`Auth error for "${modelLabel(model)}": ${authResult.error}`);
  }

  const result = await complete(
    model,
    {
      systemPrompt:
        "You are a precise image analyst. Describe images accurately based on visual content only.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", data: image.data, mimeType: image.mimeType },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      maxTokens: 2048,
      signal,
      apiKey: authResult.apiKey,
      headers: authResult.headers,
    },
  );

  // Extract text (and thinking as fallback)
  const textParts = result.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .filter(Boolean);
  const thinkingParts = result.content
    .filter((b: any) => b.type === "thinking")
    .map((b: any) => b.thinking)
    .filter(Boolean);

  if (textParts.length === 0 && thinkingParts.length === 0) {
    const blockTypes = result.content.map((b: any) => b.type).join(", ");
    throw new Error(
      `Vision model returned no content (blocks: [${blockTypes}], stop: ${result.stopReason}).`,
    );
  }

  return textParts.length > 0 ? textParts.join("\n") : thinkingParts.join("\n");
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Initialize interception state from current model ────────────────────
  function updateInterception(model: any) {
    const nativeVision = modelSupportsImages(model);
    shouldIntercept = !nativeVision;
  }

  // Listen for model changes
  pi.on("model_select", (event) => {
    updateInterception(event.model);
  });

  // Also check when session starts (model is restored)
  pi.on("session_start", (_event, ctx) => {
    updateInterception(ctx.model);
  });

  // ── Intercept user input (only for non-vision models) ───────────────────
  pi.on("input", async (event) => {
    // If no images or current model supports images natively, let it pass
    if (!event.images || event.images.length === 0 || !shouldIntercept) {
      return { action: "continue" };
    }

    let newText = event.text;
    const capturedIds: string[] = [];

    for (const img of event.images) {
      if (img.type !== "image") continue;

      let data: string | undefined;
      let mimeType = "image/png";

      if (img.source?.type === "base64") {
        data = img.source.data;
        mimeType = img.source.mediaType || mimeType;
      } else if (typeof (img as Record<string, unknown>).data === "string") {
        data = (img as Record<string, string>).data;
        mimeType = (img as Record<string, string>).mimeType || mimeType;
      }

      if (!data) continue;

      nextImageId++;
      const imageId = `img_${nextImageId}`;
      imageStore.set(imageId, { id: imageId, data, mimeType });
      capturedIds.push(imageId);
    }

    if (capturedIds.length === 0) {
      return { action: "continue" };
    }

    const refs = capturedIds.map((id) => `[Image: ID = ${id}]`).join("\n");
    newText = newText ? `${newText}\n\n${refs}` : refs;

    return { action: "transform", text: newText, images: [] };
  });

  // ── Intercept tool results (only for non-vision models) ─────────────────
  pi.on("tool_result", async (event) => {
    if (!shouldIntercept) return;

    const imageBlocks = event.content.filter((b: any) => b.type === "image");
    if (imageBlocks.length === 0) return;

    const newContent: any[] = [];
    const capturedIds: string[] = [];

    for (const block of event.content) {
      if (block.type !== "image") {
        newContent.push(block);
        continue;
      }

      let data: string | undefined;
      let mimeType = "image/png";

      if (typeof (block as Record<string, unknown>).data === "string") {
        data = (block as Record<string, string>).data;
        mimeType = (block as Record<string, string>).mimeType || mimeType;
      } else if (block.source?.type === "base64") {
        data = block.source.data;
        mimeType = block.source.mediaType || mimeType;
      }

      if (!data) {
        newContent.push(block);
        continue;
      }

      nextImageId++;
      const imageId = `img_${nextImageId}`;
      imageStore.set(imageId, { id: imageId, data, mimeType });
      capturedIds.push(imageId);
    }

    if (capturedIds.length === 0) return;

    const refText = capturedIds.map((id) => `[Image: ID = ${id}]`).join("\n");

    let appended = false;
    for (let i = newContent.length - 1; i >= 0; i--) {
      if (newContent[i].type === "text") {
        newContent[i] = {
          ...newContent[i],
          text: newContent[i].text + `\n\n${refText}`,
        };
        appended = true;
        break;
      }
    }
    if (!appended) {
      newContent.push({ type: "text", text: refText });
    }

    return { content: newContent };
  });

  // ── Clean up on session shutdown ────────────────────────────────────────
  pi.on("session_shutdown", () => {
    imageStore.clear();
    nextImageId = 0;
  });

  // ── Command: /vision-model ──────────────────────────────────────────────
  pi.registerCommand("vision-model", {
    description: "Select which vision model to use for image analysis",
    handler: async (_args, ctx) => {
      const registry = ctx.modelRegistry;
      if (!registry) {
        ctx.ui.notify("No model registry available.", "error");
        return;
      }

      // Find vision-capable models with valid auth
      const available = await registry.getAvailable();
      const visionModels = available.filter((m: any) => modelSupportsImages(m));

      if (visionModels.length === 0) {
        ctx.ui.notify("No vision-capable models found in registry.", "error");
        return;
      }

      // Build choices: current selection first, then group by provider
      const currentLabel = visionModelRef
        ? `${visionModelRef.provider}/${visionModelRef.modelId}`
        : "(auto-detect)";

      const choices = ["(auto-detect)", ...visionModels.map((m: any) => modelLabel(m))];

      const picked = await ctx.ui.select(
        `Current vision model: ${currentLabel}. Pick one:`,
        choices,
      );

      if (!picked) return;

      if (picked === "(auto-detect)") {
        visionModelRef = null;
        ctx.ui.notify("Vision model set to auto-detect.", "info");
        return;
      }

      // Parse "provider/modelId"
      const slashIdx = picked.indexOf("/");
      if (slashIdx === -1) return;
      const provider = picked.slice(0, slashIdx);
      const modelId = picked.slice(slashIdx + 1);

      visionModelRef = { provider, modelId };
      ctx.ui.notify(`Vision model set to ${picked}.`, "info");
    },
  });

  // ── Command: /vision-status ─────────────────────────────────────────────
  pi.registerCommand("vision-status", {
    description: "Show current vision model and interception status",
    handler: async (_args, ctx) => {
      const registry = ctx.modelRegistry;
      const currentModel = ctx.model;

      let lines: string[] = [];

      // Current model info
      if (currentModel) {
        const native = modelSupportsImages(currentModel);
        lines.push(`Current model: ${modelLabel(currentModel)}`);
        lines.push(`  Native image support: ${native ? "✅ yes" : "❌ no"}`);
        lines.push(`  Image interception: ${shouldIntercept ? "🔄 active (images → ask_image tool)" : "✅ inactive (images pass through)"}`);
      }

      // Vision model info
      if (visionModelRef) {
        lines.push(`User-selected vision model: ${visionModelRef.provider}/${visionModelRef.modelId}`);
      } else {
        lines.push(`Vision model: auto-detect`);
      }

      // Resolve what would be used
      if (registry) {
        const found = await findVisionModel(registry, currentModel);
        if (found) {
          lines.push(`Resolved vision model: ${modelLabel(found)}`);
        } else {
          lines.push(`Resolved vision model: (none available)`);
        }
      }

      // Stored images
      lines.push(`Stored images: ${imageStore.size}`);

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Tool: ask_image ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "ask_image",
    label: "Ask About Image",
    description: `Ask a specific question about an attached image.

Provide the image_id (e.g. "img_1") and your question. The vision model answers based on the image content.

Use this when you need to extract specific information: "What error message is shown?", "What are the values in the table?", "Read the code in the screenshot.", "What color is the button?"`,
    promptSnippet: "Examine an attached image by asking a question about it",
    promptGuidelines: [
      "When the user references an image (screenshot, diagram, photo, UI mockup, chart), ALWAYS use ask_image to examine it.",
      "When the user says 'this image' or 'the screenshot' without an ID, look for [Image: ID = ...] markers in recent messages.",
      "After reading an image file with the read tool, the image is replaced with a reference like [Image: ID = img_X]. Use ask_image on that ID to examine the image content.",
      "There is no separate describe_image tool. Use ask_image for everything.",
      "WORKFLOW — First, call ask_image with 'Describe this image briefly.' to get a short overview. Then call ask_image again with 'Describe this image in detail.' or specific targeted questions for any details the user needs (code content, error messages, values, etc.).",
    ],
    parameters: Type.Object({
      image_id: Type.String({
        description:
          "The image ID to ask about (e.g. 'img_1'). Found in the conversation as [Image: ID = img_1].",
      }),
      question: Type.String({
        description:
          "Your specific question about the image content. Be precise about what information you need.",
      }),
    }),
    async execute(
      _toolCallId,
      params: { image_id: string; question: string },
      signal,
      onUpdate,
      ctx,
    ) {
      const image = imageStore.get(params.image_id);
      if (!image) {
        const available = [...imageStore.keys()];
        return {
          content: [
            {
              type: "text" as const,
              text: `Image "${params.image_id}" not found.${
                available.length > 0
                  ? ` Available IDs: ${available.join(", ")}`
                  : " No images are currently stored. The user needs to paste or drag an image first."
              }`,
            },
          ],
          details: { error: true },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Querying vision model about ${params.image_id}...` }],
      });

      try {
        const answer = await callVisionModel(image, params.question, ctx, signal);

        onUpdate?.({
          content: [{ type: "text", text: `✓ Answer received for ${params.image_id}` }],
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Question about ${params.image_id}: "${params.question}"\n\nAnswer: ${answer}`,
            },
          ],
          details: { imageId: params.image_id, question: params.question },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onUpdate?.({
          content: [{ type: "text", text: `✗ Query failed for ${params.image_id}` }],
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${msg}`,
            },
          ],
          details: { error: true, message: msg },
        };
      }
    },
  });
}
