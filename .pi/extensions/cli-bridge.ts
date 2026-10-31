/**
 * CLI Bridge Provider
 * =============================================================================
 * Registra proveedores en pi que, en lugar de llamar a una API, ejecutan
 * binarios de CLI en modo no-interactivo (print / headless). Así la inferencia
 * se cobra contra la SUSCRIPCIÓN de cada CLI y no por token.
 *
 * Proveedores que agrega:
 *   - claude-cli/<modelo>     -> `claude -p --model <id>`        (Claude Pro/Max)
 *   - antigravity/<modelo>    -> `agy --print --model <id>`      (Google Antigravity)
 *
 * Antigravity (agy) da acceso por suscripción a modelos Gemini Y Claude.
 * (El antiguo puente `gemini-cli` quedó obsoleto: Google descontinuó el tier
 *  gratuito de Gemini Code Assist y migró a Antigravity.)
 *
 * IMPORTANTE (limitaciones del puente):
 *   - Cada CLI es su propio agente con sus propias herramientas. Este puente
 *     solo transporta TEXTO: envía la conversación como prompt y devuelve la
 *     respuesta de texto del CLI. NO expone las herramientas de pi (bash/read/
 *     edit) al modelo.
 *   - El coste se reporta como 0 (lo cubre tu suscripción del CLI).
 *   - Solo entrada de texto (sin imágenes a través del puente).
 *   - `agy` recibe el prompt inline como argumento: conversaciones MUY largas
 *     pueden topar con el límite de longitud de línea de comandos de Windows.
 *
 * Config por variables de entorno (opcional):
 *   CLAUDE_CLI_BIN   binario claude (def: "claude")
 *   AGY_CLI_BIN      binario agy    (def: "agy")
 *   CLAUDE_CLI_ARGS  flags extra para claude
 *   AGY_CLI_ARGS     flags extra para agy (ej: "--mode plan")
 *   CLI_BRIDGE_INCLUDE_SYSTEM   "1" para inyectar el system prompt de pi (def "0")
 *
 * Ubicación: ~/.pi/agent/extensions/cli-bridge.ts  (auto-descubierto)
 * Recarga en caliente con /reload tras editar.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	collapseSystemMessages,
	createAssistantMessageEventStream,
	getCurrentSystemPrompt,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const IS_WIN = process.platform === "win32";

// ---------------------------------------------------------------------------
// Construcción del prompt de texto a partir del transcript de pi.
// ---------------------------------------------------------------------------

function messageToText(msg: Message): string | null {
	const flatten = (content: Message["content"]): string => {
		if (typeof content === "string") return content;
		return content
			.map((c) => {
				if (c.type === "text") return c.text;
				if (c.type === "image") return "[imagen omitida]";
				return "";
			})
			.filter(Boolean)
			.join("\n");
	};

	switch (msg.role) {
		case "user": {
			const t = flatten(msg.content).trim();
			return t ? `## Usuario:\n${t}` : null;
		}
		case "assistant": {
			const parts: string[] = [];
			for (const block of msg.content) {
				if (block.type === "text" && block.text.trim()) parts.push(block.text);
				else if (block.type === "toolCall")
					parts.push(`[llamó a la herramienta ${block.name}(${JSON.stringify(block.arguments)})]`);
			}
			const t = parts.join("\n").trim();
			return t ? `## Asistente:\n${t}` : null;
		}
		case "toolResult": {
			const t = flatten(msg.content).trim();
			return t ? `## Resultado de herramienta (${msg.toolCallId}):\n${t}` : null;
		}
		default:
			return null;
	}
}

function buildPrompt(context: TranscriptContext): { system: string; prompt: string } {
	const transcript = collapseSystemMessages(context);
	const system = getCurrentSystemPrompt(transcript.messages) ?? "";
	const body = transcript.messages
		.map(messageToText)
		.filter((x): x is string => x !== null)
		.join("\n\n");
	return { system, prompt: body };
}

// ---------------------------------------------------------------------------
// Ejecución del CLI y streaming de stdout como texto hacia pi.
// ---------------------------------------------------------------------------

function parseExtraArgs(envValue: string | undefined): string[] {
	if (!envValue) return [];
	return envValue.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((s) => s.replace(/^["']|["']$/g, "")) ?? [];
}

type CliKind = "claude" | "agy";

interface CliCommand {
	bin: string;
	args: string[];
	promptMode: "stdin" | "arg"; // cómo pasar el prompt al proceso
	useShell: boolean; // shell:true resuelve shims pero rompe args con espacios/saltos
}

function defaultAgyBin(): string {
	if (process.env.AGY_CLI_BIN) return process.env.AGY_CLI_BIN;
	const local = process.env.LOCALAPPDATA;
	if (IS_WIN && local) return `${local}\\agy\\bin\\agy.exe`;
	return "agy";
}

/**
 * Resuelve un binario sin ejecutarlo. Si no se encuentra, el proveedor se
 * DESCARTA (p. ej. `agy` no existe en Linux/UBI; `claude` solo si está instalado).
 */
function binExists(bin: string): boolean {
	// Ruta absoluta o relativa con separador: comprobar directamente (+ .exe en Windows).
	if (bin.includes("/") || bin.includes("\\")) {
		if (existsSync(bin)) return true;
		return IS_WIN && existsSync(`${bin}.exe`);
	}
	// Nombre suelto: recorrer PATH.
	const exts = IS_WIN ? ["", ".exe", ".cmd", ".bat"] : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const ext of exts) {
			if (existsSync(join(dir, bin + ext))) return true;
		}
	}
	return false;
}

function buildCommand(kind: CliKind, model: Model<Api>, system: string, fullPrompt: string): CliCommand {
	const includeSystem = process.env.CLI_BRIDGE_INCLUDE_SYSTEM === "1";

	if (kind === "claude") {
		const bin = process.env.CLAUDE_CLI_BIN || "claude";
		const args = ["-p", "--output-format", "text", "--model", model.id];
		if (includeSystem && system) args.push("--append-system-prompt", system);
		args.push(...parseExtraArgs(process.env.CLAUDE_CLI_ARGS));
		// Args simples (el prompt va por stdin) -> shell OK para resolver el shim.
		return { bin, args, promptMode: "stdin", useShell: IS_WIN };
	}

	// agy (Antigravity): el prompt va inline como argumento `-p=<prompt>`.
	// SIN shell para que el prompt multilínea pase como un solo argumento.
	const bin = defaultAgyBin();
	const args = ["--output-format", "text", "--model", model.id];
	args.push(...parseExtraArgs(process.env.AGY_CLI_ARGS));
	args.push(`-p=${fullPrompt}`);
	return { bin, args, promptMode: "arg", useShell: false };
}

function streamViaCli(kind: CliKind) {
	return function stream(
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream {
		const out = createAssistantMessageEventStream();
		const { system, prompt } = buildPrompt(context);

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "pending",
			timestamp: Date.now(),
		};

		(async () => {
			const includeSystem = process.env.CLI_BRIDGE_INCLUDE_SYSTEM === "1";
			// Para CLIs sin flag de system (agy), se antepone al prompt.
			const fullPrompt =
				kind === "agy" && includeSystem && system ? `${system}\n\n${prompt}` : prompt;

			const { bin, args, promptMode, useShell } = buildCommand(kind, model, system, fullPrompt);

			let child: ReturnType<typeof spawn>;
			try {
				child = spawn(bin, args, {
					stdio: ["pipe", "pipe", "pipe"],
					shell: useShell,
				});
			} catch (e) {
				output.stopReason = "error";
				output.errorMessage = `No se pudo ejecutar '${bin}': ${e instanceof Error ? e.message : String(e)}`;
				out.push({ type: "error", reason: "error", error: output });
				out.end();
				return;
			}

			const onAbort = () => child.kill("SIGTERM");
			options?.signal?.addEventListener("abort", onAbort, { once: true });

			output.content.push({ type: "text", text: "" });
			const textIdx = 0;
			out.push({ type: "start", partial: output });
			out.push({ type: "text_start", contentIndex: textIdx, partial: output });

			let stderrBuf = "";
			let started = false;
			const emitDelta = (chunk: string) => {
				started = true;
				const block = output.content[textIdx];
				if (block && block.type === "text") {
					block.text += chunk;
					out.push({ type: "text_delta", contentIndex: textIdx, delta: chunk, partial: output });
				}
			};

			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (d: string) => emitDelta(d));
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (d: string) => {
				stderrBuf += d;
			});

			if (promptMode === "stdin") {
				try {
					child.stdin?.write(fullPrompt);
					child.stdin?.end();
				} catch {
					/* ignorar */
				}
			} else {
				try {
					child.stdin?.end();
				} catch {
					/* ignorar */
				}
			}

			const exitCode: number = await new Promise((resolve) => {
				child.on("error", (e) => {
					if (!stderrBuf) stderrBuf = e.message;
					resolve(-1);
				});
				child.on("close", (code) => resolve(code ?? 0));
			});

			options?.signal?.removeEventListener("abort", onAbort);

			const block = output.content[textIdx];
			const finalText = block && block.type === "text" ? block.text : "";

			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = "Cancelado por el usuario";
				out.push({ type: "error", reason: "aborted", error: output });
				out.end();
				return;
			}

			if (exitCode !== 0 || (!started && !finalText)) {
				output.stopReason = "error";
				output.errorMessage =
					stderrBuf.trim() ||
					`El CLI '${bin}' terminó con código ${exitCode} sin salida. ` +
						`¿Está autenticado? Probá ejecutarlo manualmente.`;
				out.push({ type: "error", reason: "error", error: output });
				out.end();
				return;
			}

			out.push({ type: "text_end", contentIndex: textIdx, content: finalText, partial: output });
			output.stopReason = "stop";
			out.push({ type: "done", reason: "stop", message: output });
			out.end();
		})();

		return out;
	};
}

// ---------------------------------------------------------------------------
// Helper para definir modelos de texto con coste 0.
// ---------------------------------------------------------------------------

function textModel(id: string, name: string, contextWindow: number) {
	return {
		id,
		name,
		reasoning: false,
		input: ["text"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 8192,
	};
}

// ---------------------------------------------------------------------------
// Registro de proveedores.
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Interruptor de deshabilitación: con CLI_BRIDGE_DISABLE=1 (o true) el puente no
	// registra ningún proveedor. Se usa en CI/Docker, donde el binario `claude` NO
	// acepta el token OAuth de suscripción (solo ~/.claude o una ANTHROPIC_API_KEY
	// real); ahí se usa el proveedor NATIVO `anthropic`. El código queda intacto para
	// el host, donde el puente sí aprovecha las suscripciones.
	const disable = process.env.CLI_BRIDGE_DISABLE;
	if (disable === "1" || disable === "true") return;

	// ---- Claude CLI (suscripción Claude Pro/Max; en CI usa ANTHROPIC_API_KEY) ----
	// Solo se registra si el binario `claude` está disponible.
	if (binExists(process.env.CLAUDE_CLI_BIN || "claude")) {
		pi.registerProvider("claude-cli", {
			name: "Claude CLI (suscripción)",
			api: "cli-bridge-claude",
			baseUrl: "http://cli-bridge.local", // no se usa; la validación lo exige
			apiKey: "cli-managed",
			models: [
				textModel("sonnet", "Claude Sonnet (CLI)", 200000),
				textModel("opus", "Claude Opus (CLI)", 200000),
				textModel("haiku", "Claude Haiku (CLI)", 200000),
			],
			streamSimple: streamViaCli("claude"),
		});
	}

	// ---- Antigravity (agy): Gemini y Claude por suscripción ----
	// `agy` es binario Windows; se DESCARTA automáticamente donde no exista (Linux/UBI).
	if (binExists(defaultAgyBin())) {
		pi.registerProvider("antigravity", {
			name: "Antigravity (suscripción)",
			api: "cli-bridge-agy",
			baseUrl: "http://cli-bridge.local",
			apiKey: "cli-managed",
			models: [
				textModel("gemini-3.8-flash-high", "Gemini 3.8 Flash High (AGY)", 1000000),
				textModel("gemini-3.8-flash-medium", "Gemini 3.8 Flash Medium (AGY)", 1000000),
				textModel("gemini-3.8-flash-low", "Gemini 3.8 Flash Low (AGY)", 1000000),
				textModel("claude-sonnet-4-6", "Claude Sonnet 4.6 (AGY)", 200000),
				textModel("claude-opus-4-6-thinking", "Claude Opus 4.6 Thinking (AGY)", 200000),
				textModel("gpt-oss-120b-medium", "GPT-OSS 120B Medium (AGY)", 128000),
			],
			streamSimple: streamViaCli("agy"),
		});
	}
}
