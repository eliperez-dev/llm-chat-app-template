/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const CONTEXT =
	"You are the BetterTransfer Assistant, helping community college students successfully transfer to universities (UCs, CSUs, and private institutions). You have expertise in transfer requirements, course articulation, GPA requirements, application timelines, and major-specific pathways. Provide clear, actionable advice to help students achieve their transfer goals.";

function buildSystemPrompt(userProfile?: { cc?: string; schools?: string[]; major?: string }): string {
	let prompt = `You are the BetterTransfer Assistant - a friendly and knowledgeable guide for community college to university transfers. 

Your role is to help students with:
- Course requirements and articulation agreements
- Transfer eligibility and timeline planning
- GPA and prerequisite requirements
- Major-specific transfer pathways
- School selection and comparison
- Application strategies and deadlines

Be encouraging, specific, and provide actionable steps. Keep responses concise but comprehensive.

Context: ${CONTEXT}`;

	if (userProfile) {
		prompt += "\n\nStudent Profile:";
		if (userProfile.cc) prompt += `\n- Current Community College: ${userProfile.cc}`;
		if (userProfile.major) prompt += `\n- Target Major: ${userProfile.major}`;
		if (userProfile.schools && userProfile.schools.length > 0) {
			prompt += `\n- Target Universities: ${userProfile.schools.join(", ")}`;
		}
		prompt += "\n\nUse this information to provide personalized transfer advice.";
	}

	return prompt;
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [], userProfile } = (await request.json()) as {
			messages: ChatMessage[];
			userProfile?: { cc?: string; schools?: string[]; major?: string };
		};

		const systemPrompt = buildSystemPrompt(userProfile);

		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: systemPrompt });
		}

		const response = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
			},
			{
				returnRawResponse: true,
			},
		);

		return response as Response;
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
