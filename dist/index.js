import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}
const supabase = createClient(supabaseUrl, supabaseKey);
const server = new Server({
    name: "project-management-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// --- Tool Handlers ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "add_project",
                description: "Add a new software project to the central management system",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Project name" },
                        description: { type: "string", description: "Project description" },
                        repository_url: { type: "string", description: "GitHub/GitLab repository URL" },
                    },
                    required: ["name"],
                },
            },
            {
                name: "add_issue",
                description: "Create a new issue, bug or task for a specific project",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_name: { type: "string", description: "Exact or partial name of the project" },
                        title: { type: "string", description: "Issue title" },
                        description: { type: "string", description: "Detailed description of the issue" },
                        priority: {
                            type: "string",
                            enum: ["low", "medium", "high", "urgent"],
                            default: "medium"
                        },
                    },
                    required: ["project_name", "title"],
                },
            },
            {
                name: "update_issue_status",
                description: "Update the status of an existing issue",
                inputSchema: {
                    type: "object",
                    properties: {
                        issue_id: { type: "string", description: "The UUID of the issue" },
                        status: {
                            type: "string",
                            enum: ["todo", "in_progress", "review", "done"]
                        },
                    },
                    required: ["issue_id", "status"],
                },
            },
            {
                name: "list_all_projects",
                description: "List all software projects currently being managed",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "get_project_details",
                description: "Get comprehensive details of a project, including its issues and recent activity",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_name: { type: "string", description: "Name of the project" },
                    },
                    required: ["project_name"],
                },
            }
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "add_project": {
                if (!args)
                    throw new Error("Arguments are required for add_project");
                const { data, error } = await supabase
                    .from("projects")
                    .insert([{
                        name: args.name,
                        description: args.description,
                        repository_url: args.repository_url
                    }])
                    .select()
                    .single();
                if (error)
                    throw error;
                await supabase.from("activities").insert([{
                        project_id: data.id,
                        action: "project_created",
                        details: { name: data.name }
                    }]);
                return {
                    content: [{ type: "text", text: `🚀 Project "${data.name}" added to Central Management (ID: ${data.id}).` }],
                };
            }
            case "add_issue": {
                if (!args)
                    throw new Error("Arguments are required for add_issue");
                const { data: proj, error: pErr } = await supabase
                    .from("projects")
                    .select("id, name")
                    .ilike("name", `%${args.project_name}%`)
                    .limit(1)
                    .single();
                if (pErr || !proj)
                    throw new Error(`Project matching "${args.project_name}" not found.`);
                const { data: issue, error: iErr } = await supabase
                    .from("issues")
                    .insert([{
                        project_id: proj.id,
                        title: args.title,
                        description: args.description,
                        priority: args.priority || "medium"
                    }])
                    .select()
                    .single();
                if (iErr)
                    throw iErr;
                await supabase.from("activities").insert([{
                        project_id: proj.id,
                        issue_id: issue.id,
                        action: "issue_created",
                        details: { title: issue.title }
                    }]);
                return {
                    content: [{ type: "text", text: `✅ Issue "${issue.title}" (ID: ${issue.id}) created for ${proj.name}.` }],
                };
            }
            case "update_issue_status": {
                if (!args)
                    throw new Error("Arguments are required for update_issue_status");
                const { data: issue, error: iErr } = await supabase
                    .from("issues")
                    .update({ status: args.status })
                    .eq("id", args.issue_id)
                    .select("id, title, project_id")
                    .single();
                if (iErr)
                    throw iErr;
                await supabase.from("activities").insert([{
                        project_id: issue.project_id,
                        issue_id: issue.id,
                        action: "status_updated",
                        details: { title: issue.title, new_status: args.status }
                    }]);
                return {
                    content: [{ type: "text", text: `Status of issue "${issue.title}" updated to ${args.status}.` }],
                };
            }
            case "list_all_projects": {
                const { data, error } = await supabase
                    .from("projects")
                    .select("name, status, progress, repository_url")
                    .order("updated_at", { ascending: false });
                if (error)
                    throw error;
                const list = data.map(p => {
                    const repo = p.repository_url ? ` (${p.repository_url})` : '';
                    return `- **${p.name}**: Status: ${p.status}, Progress: ${p.progress}%${repo}`;
                }).join("\n");
                return {
                    content: [{ type: "text", text: list || "You don't have any projects yet. Use 'add_project' to start one!" }],
                };
            }
            case "get_project_details": {
                if (!args)
                    throw new Error("Arguments are required for get_project_details");
                const { data: proj, error: pErr } = await supabase
                    .from("projects")
                    .select("*, issues(*), activities(*)")
                    .ilike("name", `%${args.project_name}%`)
                    .order('created_at', { foreignTable: 'activities', ascending: false })
                    .limit(5, { foreignTable: 'activities' })
                    .single();
                if (pErr || !proj)
                    throw new Error(`Project "${args.project_name}" not found.`);
                const issuesList = proj.issues.map((i) => `  - [${i.status.toUpperCase()}] ${i.title} (${i.priority})`).join("\n");
                const activityList = proj.activities.map((a) => `  - ${a.action}: ${JSON.stringify(a.details)}`).join("\n");
                const summary = `
# ${proj.name}
Status: ${proj.status} | Progress: ${proj.progress}%
Repo: ${proj.repository_url || 'N/A'}

## Active Issues:
${issuesList || "  No issues found."}

## Recent Activity:
${activityList || "  No activity logged yet."}
        `;
                return {
                    content: [{ type: "text", text: summary }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `❌ Error: ${error.message}` }],
            isError: true,
        };
    }
});
// --- Express / SSE Setup ---
const app = express();
app.use(cors());
let transport = null;
app.get("/sse", async (req, res) => {
    console.log("New SSE connection established");
    transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
});
app.post("/messages", async (req, res) => {
    console.log("Received post message");
    if (transport) {
        await transport.handlePostMessage(req, res);
    }
    else {
        res.status(400).send("No active SSE transport");
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MCP Project Central Server running on http://0.0.0.0:${PORT}`);
    console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
    console.log(`Message endpoint: http://0.0.0.0:${PORT}/messages`);
});
