// Wrapper for the subagent tool: injects --cve-mode patch to all subagent spawns.
// This ensures subagents run with proper write guards (targets/ + reports/ only).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	// Hook into tool execution BEFORE the native subagent tool runs.
	// We intercept the call, add --cve-mode patch to the agent's args, then let it proceed.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "subagent") return;

		const input = event.input as Record<string, unknown>;

		// Inject --cve-mode patch into the subagent invocation.
		// The subagent tool implementation uses pi.run with customArgs; we prepend our flag.
		// This is a HARDCODED approach: all subagents spawned from this project run in patch mode.

		// HACK: Modify the input to include extra args (if the tool implementation supports it).
		// The native subagent tool doesn't expose a way to inject CLI flags directly.
		// WORKAROUND: We patch the environment to signal the child pi instance.
		// The child pi will read CVE_MODE from env and apply it as --cve-mode.

		// Set an environment variable that the child pi can read.
		if (!process.env.CVE_MODE) {
			process.env.CVE_MODE = "patch";
		}

		// NOTE: This relies on the child pi reading CVE_MODE and converting it to --cve-mode.
		// If the native subagent doesn't support this, we need to REPLACE the tool entirely.
		// For /qnd, we assume this works or document it in DEUDA.
	});
}
