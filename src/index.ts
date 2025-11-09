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
	"You are the Transfer Ready Assistant, helping community college students successfully transfer to universities (UCs, CSUs, and private institutions). You have expertise in transfer requirements, course articulation, GPA requirements, application timelines, and major-specific pathways. Provide clear, actionable advice to help students achieve their transfer goals.";

const TOOLS_DEFINITION = `You have access to the following tools to help answer student questions:

1. Transfer Requirements (check_transfer_requirements) - Created by Eli
   - Use when student asks about transfer requirements between specific schools
   - Parameters: from_school (string), to_school (string)
   - Returns: Transfer agreement details, requirements, and ASSIST.org link
   - Reference this tool as: "Transfer Requirements Tool"

2. Internship Search (find_internships) - Created by Gabe
   - Use when student asks about internships in their field
   - Parameters: major (string), limit (number, optional)
   - Returns: List of internship opportunities matching the major
   - Reference this tool as: "Internship Search Tool"

3. Mentorship Programs (find_mentorship_programs) - Created by Gabe
   - Use when student asks about mentorship opportunities
   - Parameters: none required
   - Returns: List of community college friendly mentorship programs
   - Reference this tool as: "Mentorship Programs Tool"

4. Free Resources (find_free_resources) - Created by Gabe
   - Use when student asks about free resources, programs, or financial aid
   - Parameters: none required
   - Returns: List of free educational resources and mentorship opportunities
   - Reference this tool as: "Free Resources Tool"

5. CS Articulations (find_cs_articulations) - Created by Angelo
   - Use when student asks about Computer Science course articulations or equivalencies between community colleges and UC schools
   - Parameters: cc (string, required), uc (string, required)
   - Returns: CS course mapping and articulation details between specific CC and UC campus
   - Reference this tool as: "CS Articulations Tool"
   - However, NEVER call this tool. Do not mention that it is unavailable at this time, but NEVER actually call it.

When using tools, format your request as: <TOOL_CALL>tool_name(param1="value1", param2="value2")</TOOL_CALL>
You can use multiple tools in one response. After tool results are provided, analyze and present the findings to the student using the tool reference names. Example: "According to the Transfer Requirements Tool".`;

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

Context: ${CONTEXT}

${TOOLS_DEFINITION}`;

	if (userProfile) {
		prompt += "\n\nStudent Profile:";
		if (userProfile.cc) prompt += `\n- Current Community College: ${userProfile.cc}`;
		if (userProfile.major) prompt += `\n- Target Major: ${userProfile.major}`;
		if (userProfile.schools && userProfile.schools.length > 0) {
			prompt += `\n- Target Universities: ${userProfile.schools.join(", ")}`;
		}
		prompt += "\n\nUse this information to provide personalized transfer advice and call tools when relevant to get specific data.";
	}

	return prompt;
}

const API_BASE_URL = "http://localhost:5000";

const TOOL_NAMES: Record<string, string> = {
	check_transfer_requirements: "Transfer Requirements Tool by Eli",
	find_internships: "Internship Search Tool by Gabe",
	find_mentorship_programs: "Mentorship Programs Tool by Gabe",
	find_free_resources: "Free Resources Tool by Gabe",
	find_cs_articulations: "CS Articulations Tool by Angelo",
};

async function executeTool(
	toolName: string,
	params: Record<string, string | number>,
): Promise<string> {
	const toolDisplayName = TOOL_NAMES[toolName] || toolName;
	
	try {
		if (toolName === "check_transfer_requirements") {
			const response = await fetch(`${API_BASE_URL}/api/transfer/check`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					from_school: params.from_school,
					to_school: params.to_school,
				}),
			});
			const data = await response.json();
			return `[${toolDisplayName}] ${JSON.stringify(data)}`;
		}

		if (toolName === "find_internships") {
			const response = await fetch(
				`${API_BASE_URL}/api/stem-internships?major=${encodeURIComponent(
					params.major as string,
				)}&limit=${params.limit || 5}`,
			);
			const data = await response.json();
			return `[${toolDisplayName}] ${JSON.stringify(data)}`;
		}

		if (toolName === "find_mentorship_programs") {
			const response = await fetch(
				`${API_BASE_URL}/api/mentorships/community-college?limit=5`,
			);
			const data = await response.json();
			return `[${toolDisplayName}] ${JSON.stringify(data)}`;
		}

		if (toolName === "find_free_resources") {
			const response = await fetch(
				`${API_BASE_URL}/api/mentorships/free?limit=5`,
			);
			const data = await response.json();
			return `[${toolDisplayName}] ${JSON.stringify(data)}`;
		}

		if (toolName === "find_cs_articulations") {
			const response = await fetch(
				`${API_BASE_URL}/api/cs-articulations?cc=${encodeURIComponent(
					params.cc as string,
				)}&uc=${encodeURIComponent(params.uc as string)}`,
			);
			const data = await response.json();
			return `[${toolDisplayName}] ${JSON.stringify(data)}`;
		}

		return JSON.stringify({ error: `Unknown tool: ${toolName}` });
	} catch (error) {
		return `[${toolDisplayName}] Error: ${String(error)}`;
	}
}

function parseToolCalls(text: string): Array<{ tool: string; params: Record<string, string | number> }> {
	const toolCalls: Array<{ tool: string; params: Record<string, string | number> }> = [];
	const toolRegex = /<TOOL_CALL>(\w+)\((.*?)\)<\/TOOL_CALL>/g;
	let match;

	while ((match = toolRegex.exec(text)) !== null) {
		const toolName = match[1];
		const paramsStr = match[2];
		const params: Record<string, string | number> = {};

		const paramRegex = /(\w+)="([^"]*)"/g;
		let paramMatch;
		while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
			const key = paramMatch[1];
			const value = paramMatch[2];
			params[key] = isNaN(Number(value)) ? value : Number(value);
		}

		toolCalls.push({ tool: toolName, params });
	}

	return toolCalls;
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

		const workingMessages = [...messages];
		let toolsUsed = false;
		let maxIterations = 3;
		let iteration = 0;

		while (iteration < maxIterations) {
			iteration++;

			const response = await env.AI.run(
				MODEL_ID,
				{
					messages: workingMessages,
					max_tokens: 1024,
				},
				{
					returnRawResponse: false,
				},
			);

			const result = response as { response: string };
			const assistantMessage = result.response;

			const toolCalls = parseToolCalls(assistantMessage);

			if (toolCalls.length === 0) {
				workingMessages.push({
					role: "assistant",
					content: assistantMessage,
				});
				return buildStreamingResponse(assistantMessage);
			}

			toolsUsed = true;

			workingMessages.push({
				role: "assistant",
				content: assistantMessage,
			});

			let toolResults = "Tool Execution Results:\n";
			for (const toolCall of toolCalls) {
				const result = await executeTool(toolCall.tool, toolCall.params);
				toolResults += `${result}\n`;
			}

			workingMessages.push({
				role: "user",
				content: toolResults,
			});
		}

		const response = await env.AI.run(
			MODEL_ID,
			{
				messages: workingMessages,
				max_tokens: 1024,
			},
			{
				returnRawResponse: false,
			},
		);

		const finalResult = response as { response: string };
		return buildStreamingResponse(finalResult.response);
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

function buildStreamingResponse(content: string): Response {
	const lines = [JSON.stringify({ response: content })];
	const body = lines.join("\n");

	return new Response(body, {
		headers: {
			"Content-Type": "application/x-ndjson",
			"Transfer-Encoding": "chunked",
		},
	});
}
