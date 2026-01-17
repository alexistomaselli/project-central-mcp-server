
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

const server = new Server(
  {
    name: "project-management-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

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
        name: "update_issue",
        description: "Update any property of an existing issue (title, description, priority, status, assignees)",
        inputSchema: {
          type: "object",
          properties: {
            issue_id: { type: "string", description: "The UUID of the issue" },
            title: { type: "string", description: "New title" },
            description: { type: "string", description: "New description" },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
            status: { type: "string", enum: ["todo", "in_progress", "review", "done"] },
            assignees: { type: "array", items: { type: "string" }, description: "List of usernames assigned" }
          },
          required: ["issue_id"],
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
      },
      {
        name: "list_issues",
        description: "List issues across all projects or filtered by status, priority or project name",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Filter by project name (optional)" },
            status: { type: "string", enum: ["todo", "in_progress", "review", "done"], description: "Filter by status" },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Filter by priority" }
          }
        }
      },
      {
        name: "add_issue_comment",
        description: "Add a comment to a specific issue",
        inputSchema: {
          type: "object",
          properties: {
            issue_id: { type: "string", description: "The UUID of the issue" },
            author_name: { type: "string", description: "Name of the comment author" },
            content: { type: "string", description: "The content of the comment" }
          },
          required: ["issue_id", "author_name", "content"]
        }
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "add_project": {
        if (!args) throw new Error("Arguments are required for add_project");
        const { data, error } = await supabase
          .from("projects")
          .insert([{
            name: args.name as string,
            description: args.description as string,
            repository_url: args.repository_url as string
          }])
          .select()
          .single();

        if (error) throw error;

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
        if (!args) throw new Error("Arguments are required for add_issue");
        const { data: proj, error: pErr } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", `%${args.project_name as string}%`)
          .limit(1)
          .single();

        if (pErr || !proj) throw new Error(`Project matching "${args.project_name as string}" not found.`);

        const { data: issue, error: iErr } = await supabase
          .from("issues")
          .insert([{
            project_id: proj.id,
            title: args.title as string,
            description: args.description as string,
            priority: (args.priority as string) || "medium"
          }])
          .select()
          .single();

        if (iErr) throw iErr;

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
        if (!args) throw new Error("Arguments are required for update_issue_status");
        const { data: issue, error: iErr } = await supabase
          .from("issues")
          .update({ status: args.status as string })
          .eq("id", args.issue_id as string)
          .select("id, title, project_id")
          .single();

        if (iErr) throw iErr;

        await supabase.from("activities").insert([{
          project_id: issue.project_id,
          issue_id: issue.id,
          action: "status_updated",
          details: { title: issue.title, new_status: args.status as string }
        }]);

        return {
          content: [{ type: "text", text: `✅ Status of issue "${issue.title}" updated to ${args.status as string}.` }],
        };
      }

      case "update_issue": {
        if (!args) throw new Error("Arguments are required for update_issue");
        const updates: any = {};
        if (args.title) updates.title = args.title;
        if (args.description) updates.description = args.description;
        if (args.priority) updates.priority = args.priority;
        if (args.status) updates.status = args.status;
        if (args.assignees) updates.assigned_to = args.assignees;

        const { data: issue, error: iErr } = await supabase
          .from("issues")
          .update(updates)
          .eq("id", args.issue_id as string)
          .select("id, title, project_id")
          .single();

        if (iErr) throw iErr;

        await supabase.from("activities").insert([{
          project_id: issue.project_id,
          issue_id: issue.id,
          action: "issue_updated",
          details: { title: issue.title, updated_fields: Object.keys(updates) }
        }]);

        return {
          content: [{ type: "text", text: `✅ Issue "${issue.title}" has been updated successfully.` }],
        };
      }

      case "list_all_projects": {
        const { data, error } = await supabase
          .from("projects")
          .select("name, status, progress, repository_url")
          .order("updated_at", { ascending: false });

        if (error) throw error;

        const list = data.map(p => {
          const repo = p.repository_url ? ` (${p.repository_url})` : '';
          return `- **${p.name}**: Status: ${p.status}, Progress: ${p.progress}%${repo}`;
        }).join("\n");

        return {
          content: [{ type: "text", text: list || "You don't have any projects yet. Use 'add_project' to start one!" }],
        };
      }

      case "get_project_details": {
        if (!args) throw new Error("Arguments are required for get_project_details");
        const { data: proj, error: pErr } = await supabase
          .from("projects")
          .select("*, issues(*), activities(*)")
          .ilike("name", `%${args.project_name as string}%`)
          .order('created_at', { foreignTable: 'activities', ascending: false })
          .limit(5, { foreignTable: 'activities' })
          .single();

        if (pErr || !proj) throw new Error(`Project "${args.project_name as string}" not found.`);

        const issuesList = proj.issues.map((i: any) => `  - [${i.status.toUpperCase()}] ${i.title} (${i.priority})`).join("\n");
        const activityList = proj.activities.map((a: any) => `  - ${a.action}: ${JSON.stringify(a.details)}`).join("\n");

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

      case "list_issues": {
        let query = supabase.from("issues").select("*, projects(name)");

        if (args?.status) query = query.eq("status", args.status);
        if (args?.priority) query = query.eq("priority", args.priority);
        if (args?.project_name) {
          const { data: proj } = await supabase.from("projects").select("id").ilike("name", `%${args.project_name}%`).single();
          if (proj) query = query.eq("project_id", proj.id);
        }

        const { data: issues, error } = await query.order("created_at", { ascending: false });
        if (error) throw error;

        const list = (issues || []).map(i => `- [${(i.projects as any)?.name}] **${i.title}** | Status: ${i.status.toUpperCase()} | Priority: ${i.priority.toUpperCase()} (ID: ${i.id})`).join("\n");

        return {
          content: [{ type: "text", text: list || "No se encontraron tareas con esos filtros." }],
        };
      }

      case "add_issue_comment": {
        if (!args) throw new Error("Arguments are required for add_issue_comment");
        const { data: comm, error: cErr } = await supabase
          .from("comments")
          .insert([{
            issue_id: args.issue_id as string,
            author_name: (args.author_name as string) || "Assistant",
            content: args.content as string
          }])
          .select()
          .single();

        if (cErr) throw cErr;

        // Log activity too
        const { data: issue } = await supabase
          .from("issues")
          .select("project_id, title")
          .eq("id", args.issue_id as string)
          .single();

        if (issue) {
          await supabase.from("activities").insert([{
            project_id: issue.project_id,
            issue_id: comm.issue_id,
            action: "commented",
            details: { title: issue.title, comment: (args.content as string).slice(0, 50) }
          }]);
        }

        return {
          content: [{ type: "text", text: `💬 Comment added to issue "${issue?.title || comm.issue_id}".` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `❌ Error: ${error.message}` }],
      isError: true,
    };
  }
});

// --- Universal Transport Setup ---

const MCP_MODE = process.env.MCP_MODE || "sse";

if (MCP_MODE === "stdio") {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Project Central Server running on stdio");
} else {
  // --- Express / SSE Setup ---
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Map to store transports by sessionId
  const transports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (req, res) => {
    console.log(`[${new Date().toISOString()}] New SSE attempt from ${req.ip}`);

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx/proxies
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial comment to flush any buffers
    res.write(': keep-alive\n\n');

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);
    console.log(`[${new Date().toISOString()}] SSE session started: ${sessionId}`);

    // Keep-alive heartbeat every 30 seconds to prevent proxy timeouts
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    await server.connect(transport);

    // Clean up when connection closes
    res.on("close", () => {
      console.log(`[${new Date().toISOString()}] SSE connection closed: ${sessionId}`);
      clearInterval(heartbeat);
      // Give a larger grace period (10s) for any late messages
      setTimeout(() => transports.delete(sessionId), 10000);
    });
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      console.error(`[${new Date().toISOString()}] Received message post without sessionId`);
      return res.status(400).send("Missing sessionId query parameter");
    }

    const transport = transports.get(sessionId);

    if (transport) {
      console.log(`[${new Date().toISOString()}] Processing message for session: ${sessionId}`);
      try {
        await transport.handlePostMessage(req, res);
      } catch (err: any) {
        console.error(`[${new Date().toISOString()}] Error handling post message: ${err.message}`);
        res.status(500).send(err.message);
      }
    } else {
      const activeSessions = Array.from(transports.keys()).join(", ");
      console.error(`[${new Date().toISOString()}] Session not found for ID: ${sessionId}. Current active sessions: ${activeSessions}`);
      res.status(400).send(`No active SSE transport for session: ${sessionId}. The session might have expired or you might be hitting a different instance of the server.`);
    }
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] MCP Project Central Server running on port ${PORT}`);
    console.log(`[${new Date().toISOString()}] SSE endpoint: /sse`);
    console.log(`[${new Date().toISOString()}] Message endpoint: /messages`);
  });
}
